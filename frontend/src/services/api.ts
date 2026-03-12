import type { AppState } from '../types/appstate';

const BASE_URL = '/api';

export interface Changelog {
  summary: string;
  changes: string[];
  usageTips: string[];
}

export interface GenerateResponse {
  sessionId: string;
  appState: AppState;
  code: string;
  changelog: Changelog;
}

export async function generateFromPrompt(
  prompt: string,
  sessionId?: string
): Promise<GenerateResponse> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, sessionId }),
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
