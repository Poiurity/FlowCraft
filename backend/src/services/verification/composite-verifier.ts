// §1.4 — CompositeVerifier: Layer A always runs; Layer B runs only if A passes.

import type { AppState } from '../../models/appstate';
import type { Verifier, VerifyContext, AnalyzeResult, ValidationError } from './types';
import { VerificationCache, buildCacheKey } from './verification-cache';

export class CompositeVerifier implements Verifier {
  constructor(
    private staticV: Verifier,
    private remoteV: Verifier,
    private cache: VerificationCache,
  ) {}

  isAvailable(): boolean { return true; }

  async verify(appState: AppState, code: string, ctx: VerifyContext): Promise<AnalyzeResult> {
    const t0 = Date.now();

    // 1. Cache check (§2.6 composite key)
    const cacheKey = buildCacheKey(appState, ctx.registryVersion);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 2. Layer A always runs
    const a = await this.staticV.verify(appState, code, ctx);

    // 3. Short-circuit: run Layer B only if A passed
    if (!a.ok || !this.remoteV.isAvailable()) {
      const result = { ...a, durationMs: Date.now() - t0 };
      this.cache.set(a.cacheKey, result);
      return result;
    }

    const b = await this.remoteV.verify(appState, code, ctx);

    if (b.source === 'static-only-degraded') {
      const result = { ...a, source: 'static' as const, durationMs: Date.now() - t0 };
      // Do NOT cache degraded
      return result;
    }

    // 4. Merge A + B (dedup by severity|code|line|column|message)
    const deduped = dedup([...a.errors, ...b.errors]);
    const dedupedW = dedup([...a.warnings, ...b.warnings]);

    const merged: AnalyzeResult = {
      ok: deduped.filter(e => e.severity === 'error').length === 0,
      errors: sorted(deduped.filter(e => e.severity === 'error')),
      warnings: sorted(dedupedW.filter(w => w.severity === 'warning')),
      source: 'composite',
      cacheKey: a.cacheKey,
      fromCache: false,
      durationMs: Date.now() - t0,
    };

    this.cache.set(a.cacheKey, merged);
    return merged;
  }

}

function dedup(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter(e => {
    const key = `${e.severity}|${e.code}|${e.location?.line ?? ''}|${e.location?.column ?? ''}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sorted(errors: ValidationError[]): ValidationError[] {
  return [...errors].sort((a, b) => {
    const la = a.location?.line ?? Infinity;
    const lb = b.location?.line ?? Infinity;
    if (la !== lb) return la - lb;
    return (a.code ?? '').localeCompare(b.code ?? '');
  });
}
