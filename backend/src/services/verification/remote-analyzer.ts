// Layer B — RemoteAnalyzer (dormant until DART_SERVICES_URL is set).
// Calls self-hosted dart-services POST /api/v3/analyze with the rendered main.dart.

import type { AppState } from '../../models/appstate';
import type { Verifier, VerifyContext, AnalyzeResult, ValidationError } from './types';
import { loadRemoteConfig, type RemoteConfig } from './remote-config';

interface DartIssue {
  kind: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  correction?: string;
  line?: number;
  column?: number;
  charStart?: number;
  charLength?: number;
}

export class RemoteAnalyzer implements Verifier {
  private config: RemoteConfig | null;
  private healthy: boolean | null = null;
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;
  private readonly BREAKER_THRESHOLD = 3;
  private readonly BREAKER_COOLDOWN_MS = 60_000;

  constructor(config?: RemoteConfig | null, private fetcher = fetch) {
    this.config = config ?? loadRemoteConfig();
  }

  isAvailable(): boolean {
    if (!this.config) return false;
    if (Date.now() < this.breakerOpenUntil) return false;
    return true;
  }

  async verify(appState: AppState, code: string, ctx: VerifyContext): Promise<AnalyzeResult> {
    const t0 = Date.now();
    const cacheKey = ctx.requestId ?? '';

    if (!this.isAvailable()) {
      return this.degraded(cacheKey, t0);
    }

    const url = this.config!.baseUrl + this.config!.analyzePath;
    const timeout = this.config!.timeoutMs;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: code }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        this.recordFailure();
        return this.degraded(cacheKey, t0);
      }

      this.consecutiveFailures = 0;
      const body = await res.json() as { issues?: DartIssue[] };
      const issues: DartIssue[] = body.issues ?? [];

      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      for (const issue of issues) {
        const severity = issue.kind === 'error' ? 'error' : 'warning';
        const ve: ValidationError = {
          code: `B-${issue.code}`,
          severity,
          message: issue.message + (issue.correction ? ` (${issue.correction})` : ''),
          source: 'remote',
          location: {
            line: issue.line,
            column: issue.column,
          },
        };
        if (severity === 'error') errors.push(ve);
        else warnings.push(ve);
      }

      const ok = errors.length === 0;
      return { ok, errors, warnings, source: 'remote', cacheKey, fromCache: false, durationMs: Date.now() - t0 };
    } catch {
      this.recordFailure();
      return this.degraded(cacheKey, t0);
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.BREAKER_THRESHOLD) {
      this.breakerOpenUntil = Date.now() + this.BREAKER_COOLDOWN_MS;
      console.warn('[RemoteAnalyzer] Circuit breaker opened');
    }
  }

  private degraded(cacheKey: string, t0: number): AnalyzeResult {
    return { ok: true, errors: [], warnings: [], source: 'static-only-degraded', cacheKey, fromCache: false, durationMs: Date.now() - t0 };
  }
}
