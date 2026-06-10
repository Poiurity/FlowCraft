// Phase 2 — Shadow mode runner.
// Runs StaticValidator non-blocking after each live response.
// Accumulates per-code histograms for false-positive review. Never affects the response.
//
// VERIFY_MODE=shadow → log-only (this module)
// VERIFY_MODE=enforce → Phase 3 closed-loop (not yet wired)
// unset / off → skip entirely

import { StaticValidator } from './static-validator';
import { widgetRegistry } from '../widget-registry/registry-manager';
import type { AppState } from '../../models/appstate';
import type { AnalyzeResult, ValidationError } from './types';

export type VerifyMode = 'off' | 'shadow' | 'enforce';

export function getVerifyMode(): VerifyMode {
  const v = (process.env.VERIFY_MODE ?? '').toLowerCase();
  if (v === 'shadow') return 'shadow';
  if (v === 'enforce') return 'enforce';
  return 'off';
}

// ── Histogram ────────────────────────────────────────────────────────────

interface CodeBucket {
  errors: number;
  warnings: number;
}

interface PathStats {
  calls: number;
  okCount: number;
  errorCount: number;           // calls where ok=false (has at least one error)
  codeBuckets: Map<string, CodeBucket>;
  durationMsTotal: number;
}

// Ring buffer of recent results for /api/shadow-stats debug output.
const RING_SIZE = 100;

interface ShadowRecord {
  ts: number;
  path: string;                 // 'live' | 'import'
  sessionId: string;
  ok: boolean;
  errorCodes: string[];
  warningCodes: string[];
  durationMs: number;
  cacheKey: string;
}

class ShadowStats {
  private pathStats = new Map<string, PathStats>();
  private ring: ShadowRecord[] = [];
  private ringHead = 0;

  record(path: string, sessionId: string, result: AnalyzeResult): void {
    if (!this.pathStats.has(path)) {
      this.pathStats.set(path, {
        calls: 0, okCount: 0, errorCount: 0,
        codeBuckets: new Map(),
        durationMsTotal: 0,
      });
    }
    const ps = this.pathStats.get(path)!;
    ps.calls++;
    ps.durationMsTotal += result.durationMs;
    if (result.ok) ps.okCount++; else ps.errorCount++;

    for (const e of result.errors) {
      const b = ps.codeBuckets.get(e.code) ?? { errors: 0, warnings: 0 };
      b.errors++;
      ps.codeBuckets.set(e.code, b);
    }
    for (const w of result.warnings) {
      const b = ps.codeBuckets.get(w.code) ?? { errors: 0, warnings: 0 };
      b.warnings++;
      ps.codeBuckets.set(w.code, b);
    }

    // Ring buffer
    const rec: ShadowRecord = {
      ts: Date.now(),
      path,
      sessionId,
      ok: result.ok,
      errorCodes: result.errors.map(e => e.code),
      warningCodes: result.warnings.map(w => w.code),
      durationMs: result.durationMs,
      cacheKey: result.cacheKey,
    };
    if (this.ring.length < RING_SIZE) {
      this.ring.push(rec);
    } else {
      this.ring[this.ringHead] = rec;
      this.ringHead = (this.ringHead + 1) % RING_SIZE;
    }
  }

  toJSON(): Record<string, unknown> {
    const paths: Record<string, unknown> = {};
    for (const [p, ps] of this.pathStats) {
      const buckets: Record<string, CodeBucket> = {};
      for (const [code, b] of ps.codeBuckets) buckets[code] = b;
      paths[p] = {
        calls: ps.calls,
        okRate: ps.calls ? +(ps.okCount / ps.calls).toFixed(3) : null,
        errorCallRate: ps.calls ? +(ps.errorCount / ps.calls).toFixed(3) : null,
        avgDurationMs: ps.calls ? +(ps.durationMsTotal / ps.calls).toFixed(1) : null,
        codeBuckets: buckets,
      };
    }

    // Recent ring: newest first
    const recent = [...this.ring]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20);

    return { paths, recent };
  }
}

export const shadowStats = new ShadowStats();

// ── Shadow runner ─────────────────────────────────────────────────────────

const staticValidator = new StaticValidator();

// Fire-and-forget — never awaited from the route handler.
// Returns the promise anyway so tests can await it.
export function runShadow(
  appState: AppState,
  code: string,
  path: 'live' | 'import',
  sessionId: string,
  requestId: string,
): Promise<void> {
  const snap = widgetRegistry.cloneDefinitions();
  const ctx = {
    registryVersion: snap.registryVersion,
    registrySnapshot: snap,
    source: path,
    requestId,
    attempt: 0,
  } as const;

  return staticValidator.verify(appState, code, ctx)
    .then(result => {
      shadowStats.record(path, sessionId, result);

      if (!result.ok || result.warnings.length > 0) {
        const prefix = `[Shadow/${path}] session=${sessionId.slice(0, 8)} ok=${result.ok}`;
        const errorSummary = result.errors.map(formatError).join(' | ');
        const warnSummary = result.warnings.length
          ? ` warnings=[${result.warnings.map(w => w.code).join(',')}]`
          : '';
        console.log(`${prefix} errors=[${errorSummary}]${warnSummary} (${result.durationMs}ms)`);
      } else {
        console.debug(`[Shadow/${path}] session=${sessionId.slice(0, 8)} ok=true (${result.durationMs}ms)`);
      }
    })
    .catch(err => {
      console.error(`[Shadow/${path}] verifier threw:`, err);
    });
}

function formatError(e: ValidationError): string {
  const loc = e.location?.nodePath ? `@${e.location.nodePath}` : '';
  return `${e.code}${loc}`;
}
