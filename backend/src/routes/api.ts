import { Router, Request, Response } from 'express';
import { Orchestrator } from '../services/agents/orchestrator';
import { ClosedLoopOrchestrator } from '../services/agents/closed-loop-orchestrator';
import { AppStateManager } from '../services/appstate-manager';
import { CodeGenerator } from '../services/code-generator';
import { StaticValidator } from '../services/verification/static-validator';
import { diffAppState } from '../services/appstate-differ';
import { explainChanges } from '../services/change-explainer';
import { AppStateSchema } from '../models/appstate';
import { randomUUID } from 'crypto';
import { getVerifyMode, runShadow, shadowStats } from '../services/verification/shadow-verifier';
import { widgetRegistry } from '../services/widget-registry/registry-manager';
import type { PipelineEvent } from '../services/pipeline-events';
import { resolveLang } from '../services/agents/pipeline-labels';
import { recordLoopResult, getLoopStats } from '../services/verification/loop-telemetry';

const router = Router();
const stateManager = new AppStateManager();
const codeGenerator = new CodeGenerator();
const importValidator = new StaticValidator();

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다');
  return apiKey;
}

function getOrchestrator(): Orchestrator {
  return new Orchestrator(getApiKey());
}

function getClosedLoopOrchestrator(lang?: unknown): ClosedLoopOrchestrator {
  return new ClosedLoopOrchestrator(getApiKey(), undefined, resolveLang(lang));
}

/**
 * POST /api/generate
 * Takes a natural language prompt and optional sessionId.
 * Returns the generated AppState and Flutter code.
 */
router.post('/generate', async (req: Request, res: Response) => {
  const requestId = randomUUID();
  try {
    const { prompt, sessionId: incomingSessionId, lang } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt는 필수이며 문자열이어야 합니다' });
      return;
    }

    const sessionId = incomingSessionId || randomUUID();
    const currentState = stateManager.getState(sessionId);
    const mode = getVerifyMode();

    // Phase 3: enforce mode uses closed-loop orchestrator.
    if (mode === 'enforce') {
      const loopOrch = getClosedLoopOrchestrator(lang);
      const result = await loopOrch.run(prompt, currentState ?? undefined);
      recordLoopResult(result);

      const changeReport = diffAppState(currentState, result.appState);
      const changelog = explainChanges(changeReport, result.appState.appName);

      // §4.3: degrade-prior means the prior state is already stored — do not overwrite.
      if (result.outcome !== 'degrade-prior') {
        stateManager.setState(sessionId, result.appState);
      }

      res.json({
        sessionId,
        appState: result.appState,
        code: result.code,
        changelog,
        degraded: result.degraded,
        degradeReason: result.degradeReason,
        fidelity: result.fidelity,
        finalState: result.finalState,
        attempts: result.attempts.map(a => ({
          attempt: a.attempt,
          source: a.source,
          ok: a.verify.ok,
          errorCodes: a.verify.errorCodes,
          durationMs: a.verify.durationMs,
          ...(a.critic && {
            critic: {
              called: a.critic.called,
              fidelityScore: a.critic.fidelityScore,
              recommendation: a.critic.recommendation,
              reloop: a.critic.reloop,
              durationMs: a.critic.durationMs,
            },
          }),
          ...(a.repair && {
            repair: {
              unrepairable: a.repair.unrepairable,
              patchesApplied: a.repair.patchesApplied,
              patchesDropped: a.repair.patchesDropped,
            },
          }),
        })),
      });
      return;
    }

    // shadow / off — use original orchestrator.
    const orchestrator = getOrchestrator();
    const { appState: newState } = await orchestrator.process(prompt, currentState);

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

    // Phase 2 shadow mode — fire-and-forget after response is sent.
    if (mode === 'shadow') {
      runShadow(newState, code, 'live', sessionId, requestId);
    }
  } catch (err: any) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || '서버 내부 오류가 발생했습니다' });
  }
});

/**
 * POST /api/generate/stream
 * Server-Sent Events endpoint. Streams PipelineEvent JSON lines as the
 * ClosedLoopOrchestrator runs, then sends a final `result` event.
 * Falls back to enforce-mode behavior regardless of VERIFY_MODE
 * (callers that need non-SSE output use POST /api/generate instead).
 */
router.post('/generate/stream', async (req: Request, res: Response) => {
  const { prompt, sessionId: incomingSessionId, lang } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt는 필수이며 문자열이어야 합니다' });
    return;
  }

  const sessionId = incomingSessionId || randomUUID();
  const currentState = stateManager.getState(sessionId);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (event: PipelineEvent) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const loopOrch = new ClosedLoopOrchestrator(getApiKey(), write, resolveLang(lang));
    const result = await loopOrch.run(prompt, currentState ?? undefined);
    recordLoopResult(result);

    const changeReport = diffAppState(currentState, result.appState);
    const changelog = explainChanges(changeReport, result.appState.appName);

    if (result.outcome !== 'degrade-prior') {
      stateManager.setState(sessionId, result.appState);
    }

    // Final result event — frontend uses this to update appState + code
    const payload = {
      sessionId,
      appState: result.appState,
      code: result.code,
      changelog,
      degraded: result.degraded,
      degradeReason: result.degradeReason,
      fidelity: result.fidelity,
      finalState: result.finalState,
      attempts: result.attempts.map(a => ({
        attempt: a.attempt,
        source: a.source,
        ok: a.verify.ok,
        errorCodes: a.verify.errorCodes,
        durationMs: a.verify.durationMs,
        ...(a.critic && {
          critic: {
            called: a.critic.called,
            fidelityScore: a.critic.fidelityScore,
            recommendation: a.critic.recommendation,
            reloop: a.critic.reloop,
            durationMs: a.critic.durationMs,
          },
        }),
        ...(a.repair && {
          repair: {
            unrepairable: a.repair.unrepairable,
            patchesApplied: a.repair.patchesApplied,
            patchesDropped: a.repair.patchesDropped,
          },
        }),
      })),
    };

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'result', payload })}\n\n`);
    }
  } catch (err: any) {
    console.error('Generate stream error:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || '서버 내부 오류' })}\n\n`);
    }
  } finally {
    if (!res.writableEnded) res.end();
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
 *
 * Phase 3 — 3-channel response:
 *   400  Zod schema parse failure (malformed JSON shape)
 *   422  StaticValidator returned ok=false (VERIFY_MODE=enforce only)
 *   500  Verifier threw (infrastructure error) or unexpected server error
 */
router.post('/state', async (req: Request, res: Response) => {
  const requestId = randomUUID();
  const mode = getVerifyMode();
  try {
    const { sessionId: incomingSessionId, appState } = req.body;
    const sessionId = incomingSessionId || randomUUID();

    // 400: schema parse failure
    let validated: ReturnType<typeof AppStateSchema.parse>;
    try {
      validated = AppStateSchema.parse(appState);
    } catch (err: any) {
      res.status(400).json({ error: err.message || '유효하지 않은 AppState 스키마입니다' });
      return;
    }

    const code = codeGenerator.generate(validated);

    // 422 / 500: static validation in enforce mode
    if (mode === 'enforce') {
      let verifyResult;
      try {
        const snap = widgetRegistry.cloneDefinitions();
        verifyResult = await importValidator.verify(validated, code, {
          registryVersion: snap.registryVersion,
          registrySnapshot: snap,
          source: 'import',
          requestId,
          attempt: 0,
        });
      } catch (err: any) {
        console.error('[POST /api/state] verifier threw:', err);
        res.status(500).json({ error: 'Verification infrastructure error', detail: err.message });
        return;
      }

      if (!verifyResult.ok) {
        res.status(422).json({
          error: 'AppState validation failed',
          errors: verifyResult.errors,
          warnings: verifyResult.warnings,
        });
        return;
      }
    }

    stateManager.setState(sessionId, validated);
    res.json({ sessionId, appState: validated, code });

    // Phase 2 shadow mode — fire-and-forget (enforce mode skips shadow, already verified above).
    if (mode === 'shadow') {
      runShadow(validated, code, 'import', sessionId, requestId);
    }
  } catch (err: any) {
    console.error('State set error:', err);
    res.status(500).json({ error: err.message || '서버 내부 오류가 발생했습니다' });
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

/**
 * GET /api/shadow-stats
 * Returns accumulated shadow-mode verification histograms (debug / monitoring).
 * Only useful when VERIFY_MODE=shadow.
 */
router.get('/shadow-stats', (_req: Request, res: Response) => {
  res.json({
    mode: getVerifyMode(),
    stats: shadowStats.toJSON(),
  });
});

/**
 * GET /api/loop-stats
 * Accumulated closed-loop outcome telemetry (degrade/repair/reloop rates).
 */
router.get('/loop-stats', (_req: Request, res: Response) => {
  res.json(getLoopStats());
});

export default router;
