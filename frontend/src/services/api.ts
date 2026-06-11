import type { AppState } from '../types/appstate';
import type { PipelineEvent } from './pipeline-events';

// Re-export the shared event contract so consumers can import from one place
export type { PipelineEvent } from './pipeline-events';

const BASE_URL = '/api';

export interface Changelog {
  summary: string;
  changes: string[];
  usageTips: string[];
}

export interface LoopAttempt {
  attempt: number;
  source: 'initial' | 'repair';
  ok: boolean;
  errorCodes: string[];
  durationMs: number;
  critic?: {
    called: boolean;
    fidelityScore: number;
    recommendation: 'pass' | 'warn' | 'reloop';
    reloop: boolean;
    durationMs: number;
  };
  repair?: {
    unrepairable: boolean;
    patchesApplied: number;
    patchesDropped: number;
  };
}

export interface LoopInfo {
  degraded: boolean;
  degradeReason?: string;
  fidelity?: number;
  finalState?: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'DEGRADED';
  attempts: LoopAttempt[];
}

export interface GenerateResponse {
  sessionId: string;
  appState: AppState;
  code: string;
  changelog: Changelog;
  // closed-loop fields — only present when VERIFY_MODE=enforce
  degraded?: boolean;
  degradeReason?: string;
  fidelity?: number;
  finalState?: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'DEGRADED';
  attempts?: LoopAttempt[];
}

export async function generateFromPrompt(
  prompt: string,
  sessionId?: string,
  lang?: string,
): Promise<GenerateResponse> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, sessionId, lang }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function getState(
  sessionId: string
): Promise<{ appState: AppState; code: string }> {
  const res = await fetch(`${BASE_URL}/state/${sessionId}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Phase 2 SSE client.
 * Streams PipelineEvent objects via POST /api/generate/stream.
 * Each parsed event is forwarded to onEvent immediately.
 * Resolves with the final GenerateResponse when the stream closes.
 */
export async function generateStream(
  prompt: string,
  sessionId: string | undefined,
  onEvent: (e: PipelineEvent) => void,
  lang?: string,
): Promise<GenerateResponse> {
  const res = await fetch(`${BASE_URL}/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ prompt, sessionId, lang }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: GenerateResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      if (parsed.type === 'result') {
        finalResult = parsed.payload as GenerateResponse;
      } else if (parsed.type === 'error') {
        throw new Error(parsed.message || 'Stream error');
      } else {
        // PipelineEvent — forward to reducer
        onEvent(parsed as PipelineEvent);
      }
    }
  }

  if (!finalResult) throw new Error('SSE stream ended without a result event');
  return finalResult;
}
