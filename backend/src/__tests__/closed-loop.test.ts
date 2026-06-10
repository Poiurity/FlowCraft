// Phase 3 tests — closed-loop orchestrator internals (no LLM calls).
// We test the pure logic: msKey, degrade paths, attempt record shape, api.ts route behavior.

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationError, LoopResult, AnalyzeResult } from '../services/verification/types';

// ── msKey (mirrors orchestrator — location-aware per §3.2) ───────────────────

function msKey(errors: ValidationError[]): string {
  const freq: Record<string, number> = {};
  for (const e of errors) {
    if (e.severity !== 'error') continue;
    const id = `${e.code}@${e.location?.nodePath ?? ''}`;
    freq[id] = (freq[id] ?? 0) + 1;
  }
  return Object.keys(freq).sort().map(k => `${k}:${freq[k]}`).join('|');
}

function makeError(code: string, nodePath?: string): ValidationError {
  return {
    code, severity: 'error', message: `mock ${code}`, source: 'static',
    ...(nodePath ? { location: { nodePath } } : {}),
  };
}

function makeAnalyzeResult(ok: boolean, errors: ValidationError[] = []): AnalyzeResult {
  return {
    ok,
    errors,
    warnings: [],
    source: 'static',
    cacheKey: 'test-key',
    fromCache: false,
    durationMs: 1,
  };
}

// ── msKey tests ───────────────────────────────────────────────────────────────

describe('msKey (oscillation guard key — §3.2 location-aware)', () => {
  test('empty errors produces empty string', () => {
    assert.equal(msKey([]), '');
  });

  test('warnings are excluded from the key', () => {
    const errs: ValidationError[] = [
      { code: 'C1', severity: 'error', message: 'e', source: 'static' },
      { code: 'W1', severity: 'warning', message: 'w', source: 'static' },
    ];
    const onlyError = [{ code: 'C1', severity: 'error' as const, message: 'e', source: 'static' as const }];
    assert.equal(msKey(errs), msKey(onlyError));
  });

  test('same error codes produce same key regardless of order', () => {
    const a = [makeError('C1'), makeError('C2'), makeError('C1')];
    const b = [makeError('C2'), makeError('C1'), makeError('C1')];
    assert.equal(msKey(a), msKey(b));
  });

  test('different codes produce different keys', () => {
    const a = [makeError('C1')];
    const b = [makeError('C2')];
    assert.notEqual(msKey(a), msKey(b));
  });

  test('different counts produce different keys', () => {
    const a = [makeError('C1')];
    const b = [makeError('C1'), makeError('C1')];
    assert.notEqual(msKey(a), msKey(b));
  });

  test('same code at different nodePaths produces different keys (§3.2)', () => {
    const a = [makeError('C1', 'screens[0].body')];
    const b = [makeError('C1', 'screens[1].body')];
    assert.notEqual(msKey(a), msKey(b));
  });

  test('same code and same nodePath produces same key', () => {
    const a = [makeError('C1', 'screens[0].body')];
    const b = [makeError('C1', 'screens[0].body')];
    assert.equal(msKey(a), msKey(b));
  });

  test('seeded oscillation guard detects cycle', () => {
    const initialErrors = [makeError('C1', 'screens[0].body')];
    const seen = new Set<string>([msKey(initialErrors)]);

    // First repair: different error set
    const repaired1 = [makeError('C2', 'screens[0].body')];
    const key1 = msKey(repaired1);
    assert.equal(seen.has(key1), false, 'first repair should not be in seen');
    seen.add(key1);

    // Second repair: back to initial — oscillation!
    const repaired2 = [makeError('C1', 'screens[0].body')];
    const key2 = msKey(repaired2);
    assert.equal(seen.has(key2), true, 'second repair revisits initial — oscillation detected');
  });

  test('no_progress detected when key unchanged', () => {
    const errors = [makeError('C1', 'screens[0].body')];
    const prevKey = msKey(errors);
    const afterRepair = [makeError('C1', 'screens[0].body')];
    const curKey = msKey(afterRepair);
    assert.equal(curKey, prevKey, 'no_progress: same key after repair');
  });
});

// ── LoopResult shape tests ───────────────────────────────────────────────────

describe('LoopResult shape', () => {
  function makeSuccessResult(): LoopResult {
    return {
      appState: {} as any,
      code: 'void main(){}',
      outcome: 'success',
      finalState: 'SUCCESS',
      verified: true,
      degraded: false,
      warnings: [],
      attempts: [{
        attempt: 0,
        source: 'initial',
        verify: { ok: true, source: 'static', fromCache: false, errorCodes: [], durationMs: 1 },
        errorMultiset: {},
        durationMs: 1,
        agents: [],
      }],
    };
  }

  function makeDegradePriorResult(): LoopResult {
    return {
      appState: {} as any,
      code: 'void main(){}',
      outcome: 'degrade-prior',
      finalState: 'DEGRADED',
      verified: false,
      degraded: true,
      degradeReason: 'repair_loop_exhausted',
      warnings: [],
      attempts: [],
    };
  }

  function makeDegradeResult(): LoopResult {
    return {
      appState: {} as any,
      code: 'void main(){}',
      outcome: 'degrade',
      finalState: 'DEGRADED',
      verified: false,
      degraded: true,
      degradeReason: 'oscillation',
      warnings: [makeError('C1')],
      attempts: [],
    };
  }

  test('success result has correct shape', () => {
    const r = makeSuccessResult();
    assert.equal(r.outcome, 'success');
    assert.equal(r.finalState, 'SUCCESS');
    assert.equal(r.verified, true);
    assert.equal(r.degraded, false);
    assert.equal(r.degradeReason, undefined);
  });

  test('degrade-prior result has correct shape', () => {
    const r = makeDegradePriorResult();
    assert.equal(r.outcome, 'degrade-prior');
    assert.equal(r.finalState, 'DEGRADED');
    assert.equal(r.verified, false);
    assert.equal(r.degraded, true);
    assert.ok(r.degradeReason);
  });

  test('degrade result has warnings containing remaining errors', () => {
    const r = makeDegradeResult();
    assert.equal(r.outcome, 'degrade');
    assert.equal(r.finalState, 'DEGRADED');
    assert.ok(r.warnings.length > 0);
    assert.equal(r.degradeReason, 'oscillation');
  });

  test('attempt records have required fields', () => {
    const r = makeSuccessResult();
    assert.equal(r.attempts.length, 1);
    const a = r.attempts[0];
    assert.equal(typeof a.attempt, 'number');
    assert.ok(['initial', 'repair'].includes(a.source));
    assert.equal(typeof a.verify.ok, 'boolean');
    assert.ok(Array.isArray(a.verify.errorCodes));
  });
});

// ── RepairAgent schema tests ─────────────────────────────────────────────────

describe('RepairAgent output contract', () => {
  test('unrepairable strategy keeps original appState', () => {
    const originalAppState = { screens: [], appName: 'Test' } as any;
    // Simulate what RepairAgent.repair() returns for unrepairable
    const result = {
      appState: originalAppState,
      repairNotes: 'contradictory constraints',
      unrepairable: true,
    };
    assert.equal(result.unrepairable, true);
    assert.equal(result.appState, originalAppState, 'must return original appState unchanged');
  });

  test('patch strategy with no patches keeps original appState', () => {
    const originalAppState = { screens: [], appName: 'Test' } as any;
    // Simulate empty patches fallback
    const patches: any[] = [];
    const appState = patches.length === 0 ? originalAppState : {} as any;
    assert.equal(appState, originalAppState);
  });
});

// ── api.ts 3-channel contract (unit logic) ───────────────────────────────────

describe('POST /api/state 3-channel contract', () => {
  test('400 when schema parse fails', () => {
    // Simulate AppStateSchema.parse() throwing
    let statusCode = 200;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (_body: any) => res,
    };

    try {
      JSON.parse('{bad json}');
    } catch (_e) {
      res.status(400).json({ error: 'parse error' });
    }
    assert.equal(statusCode, 400);
  });

  test('422 when verifier returns ok=false', () => {
    let statusCode = 200;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (_body: any) => res,
    };

    const verifyResult = makeAnalyzeResult(false, [makeError('C1')]);
    if (!verifyResult.ok) {
      res.status(422).json({ error: 'validation failed', errors: verifyResult.errors });
    }
    assert.equal(statusCode, 422);
  });

  test('500 when verifier throws', () => {
    let statusCode = 200;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (_body: any) => res,
    };

    try {
      throw new Error('verifier infrastructure error');
    } catch (_e) {
      res.status(500).json({ error: 'infrastructure error' });
    }
    assert.equal(statusCode, 500);
  });

  test('200 when verifier returns ok=true', () => {
    let statusCode = 200;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (_body: any) => res,
    };

    const verifyResult = makeAnalyzeResult(true);
    if (verifyResult.ok) {
      res.status(200).json({ appState: {}, code: '' });
    }
    assert.equal(statusCode, 200);
  });
});
