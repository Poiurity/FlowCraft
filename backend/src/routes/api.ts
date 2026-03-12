import { Router, Request, Response } from 'express';
import { Orchestrator } from '../services/agents/orchestrator';
import { AppStateManager } from '../services/appstate-manager';
import { CodeGenerator } from '../services/code-generator';
import { diffAppState } from '../services/appstate-differ';
import { explainChanges } from '../services/change-explainer';
import { AppStateSchema } from '../models/appstate';
import { randomUUID } from 'crypto';

const router = Router();
const stateManager = new AppStateManager();
const codeGenerator = new CodeGenerator();

function getOrchestrator(): Orchestrator {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다');
  return new Orchestrator(apiKey);
}

/**
 * POST /api/generate
 * Takes a natural language prompt and optional sessionId.
 * Returns the generated AppState and Flutter code.
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, sessionId: incomingSessionId } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt는 필수이며 문자열이어야 합니다' });
      return;
    }

    const sessionId = incomingSessionId || randomUUID();
    const currentState = stateManager.getState(sessionId);

    const orchestrator = getOrchestrator();
    const { appState: newState, intent } = await orchestrator.process(prompt, currentState);

    const changeReport = diffAppState(currentState, newState);
    const changelog = explainChanges(changeReport, newState.appName);

    stateManager.setState(sessionId, newState);
    const code = codeGenerator.generate(newState);

    res.json({
      sessionId,
      appState: newState,
      code,
      changelog,
    });
  } catch (err: any) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || '서버 내부 오류가 발생했습니다' });
  }
});

/**
 * GET /api/state/:sessionId
 * Returns the current AppState for a session.
 */
router.get('/state/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const state = stateManager.getState(sessionId);
  if (!state) {
    res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    return;
  }

  const code = codeGenerator.generate(state);
  res.json({ appState: state, code });
});

/**
 * POST /api/state
 * Directly set an AppState (for manual editing / import).
 */
router.post('/state', (req: Request, res: Response) => {
  try {
    const { sessionId: incomingSessionId, appState } = req.body;
    const sessionId = incomingSessionId || randomUUID();

    const validated = AppStateSchema.parse(appState);
    stateManager.setState(sessionId, validated);
    const code = codeGenerator.generate(validated);

    res.json({ sessionId, appState: validated, code });
  } catch (err: any) {
    console.error('State set error:', err);
    res.status(400).json({ error: err.message || '유효하지 않은 AppState입니다' });
  }
});

/**
 * DELETE /api/state/:sessionId
 */
router.delete('/state/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const deleted = stateManager.deleteSession(sessionId);
  res.json({ deleted });
});

export default router;
