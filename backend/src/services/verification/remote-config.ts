// Layer B gating — env-driven. Default deployment has no DART_SERVICES_URL → Layer B dormant.

export interface RemoteConfig {
  baseUrl: string;
  analyzePath: string;
  timeoutMs: number;
  coldStartTimeoutMs: number;
}

export function loadRemoteConfig(): RemoteConfig | null {
  const url = process.env.DART_SERVICES_URL;
  if (!url) return null;
  return {
    baseUrl: url.replace(/\/$/, ''),
    analyzePath: process.env.DART_ANALYZE_PATH ?? '/api/v3/analyze',
    timeoutMs: parseInt(process.env.DART_TIMEOUT_MS ?? '8000', 10),
    coldStartTimeoutMs: parseInt(process.env.DART_COLD_START_MS ?? '20000', 10),
  };
}
