// Phase B tests — RemoteAnalyzer (Layer B) and CompositeVerifier (A→B) via recorded fixtures.
// No real dart-services required; HTTP is mocked via the injected fetcher parameter.
// Live integration tests that need DART_SERVICES_URL are skipped unless that env is set.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemoteAnalyzer } from '../services/verification/remote-analyzer';
import { CompositeVerifier } from '../services/verification/composite-verifier';
import { VerificationCache, buildCacheKey } from '../services/verification/verification-cache';
import { widgetRegistry } from '../services/widget-registry/registry-manager';
import type { VerifyContext, AnalyzeResult, Verifier } from '../services/verification/types';
import type { RemoteConfig } from '../services/verification/remote-config';
import type { AppState } from '../models/appstate';

// ── Recorded fixtures (mirrors __fixtures__/*.json — dart-services response shape) ──

const FIXTURE_DIR = join(__dirname, '../services/verification/__fixtures__');

const FX_CLEAN = JSON.parse(readFileSync(join(FIXTURE_DIR, 'clean-response.json'), 'utf8'));
const FX_ERRORS = JSON.parse(readFileSync(join(FIXTURE_DIR, 'error-response.json'), 'utf8'));
const FX_WARNINGS_ONLY = JSON.parse(readFileSync(join(FIXTURE_DIR, 'warning-only-response.json'), 'utf8'));

// ── Config & mock helpers ──────────────────────────────────────────────────────

const TEST_CFG: RemoteConfig = {
  baseUrl: 'http://dart-test.local',
  analyzePath: '/api/v3/analyze',
  timeoutMs: 500,
  coldStartTimeoutMs: 1000,
};

// Returns a mock fetcher that always responds with the given body/status.
// getCalls() tracks invocation count.
function makeFetcher(body: unknown, status = 200) {
  let calls = 0;
  const fn = async (_url: unknown, _opts?: unknown): Promise<Response> => {
    calls++;
    return { ok: status < 400, status, json: async () => body } as unknown as Response;
  };
  return { fn: fn as typeof fetch, getCalls: () => calls };
}

function makeThrowFetcher(err: Error = new Error('network error')) {
  let calls = 0;
  const fn = async (_url: unknown, _opts?: unknown): Promise<never> => {
    calls++;
    throw err;
  };
  return { fn: fn as typeof fetch, getCalls: () => calls };
}

function makeCtx(): VerifyContext {
  const snap = widgetRegistry.cloneDefinitions();
  return {
    registryVersion: snap.registryVersion,
    registrySnapshot: snap,
    source: 'live',
    requestId: 'test-remote',
    attempt: 0,
  };
}

function minimalState(): AppState {
  return {
    appName: 'TestApp',
    theme: { primaryColor: '#2196F3', brightness: 'light' },
    navigation: { type: 'stack', initialRoute: '/' },
    screens: [{
      id: 'home', name: 'HomeScreen', route: '/',
      body: { type: 'text', props: { content: 'Hello' } },
    }],
  };
}

// Stub Verifier for CompositeVerifier tests — no real StaticValidator/RemoteAnalyzer needed.
function makeVerifierStub(
  available: boolean,
  partial: Partial<AnalyzeResult>,
  appState?: AppState,
  ctx?: VerifyContext,
): Verifier & { calls: () => number } {
  let callCount = 0;
  const cacheKey = appState && ctx ? buildCacheKey(appState, ctx.registryVersion) : 'stub-key';
  const base: AnalyzeResult = {
    ok: true, errors: [], warnings: [],
    source: 'static', cacheKey, fromCache: false, durationMs: 1,
  };
  return {
    isAvailable: () => available,
    verify: async () => {
      callCount++;
      return { ...base, ...partial } as AnalyzeResult;
    },
    calls: () => callCount,
  };
}

// ── RemoteAnalyzer ────────────────────────────────────────────────────────────

describe('RemoteAnalyzer (Layer B — recorded fixtures)', () => {

  test('B-1: dormant when no config — isAvailable() false', () => {
    const ra = new RemoteAnalyzer(null);
    assert.equal(ra.isAvailable(), false);
  });

  test('B-2: available when config provided', () => {
    const { fn } = makeFetcher(FX_CLEAN);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    assert.equal(ra.isAvailable(), true);
  });

  test('B-3: verify returns degraded ok:true when no config', async () => {
    const ra = new RemoteAnalyzer(null);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.source, 'static-only-degraded');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('B-4: clean fixture → ok:true, source=remote, 0 errors/warnings', async () => {
    const { fn } = makeFetcher(FX_CLEAN);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), 'void main() {}', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.source, 'remote');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('B-5: error fixture → ok:false, errors prefixed B-, location preserved', async () => {
    const { fn } = makeFetcher(FX_ERRORS);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    const e = result.errors[0];
    assert.equal(e.code, 'B-undefined_identifier');
    assert.equal(e.severity, 'error');
    assert.equal(e.source, 'remote');
    assert.equal(e.location?.line, 42);
    assert.equal(e.location?.column, 5);
  });

  test('B-6: warning-only fixture → ok:true, warnings collected with B- prefix', async () => {
    const { fn } = makeFetcher(FX_WARNINGS_ONLY);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'B-unused_import');
    assert.equal(result.warnings[0].severity, 'warning');
    assert.equal(result.warnings[0].source, 'remote');
  });

  test('B-7: correction field appended to message', async () => {
    const { fn } = makeFetcher(FX_ERRORS);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    const msg = result.errors[0].message;
    assert.ok(
      msg.includes("Try importing the library that defines 'Foo'."),
      `correction not found in message: ${msg}`,
    );
  });

  test('B-8: missing issues key → treated as empty → ok:true', async () => {
    const { fn } = makeFetcher({});
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('B-9: HTTP 500 → degraded, circuit still open (1 failure < threshold of 3)', async () => {
    const { fn } = makeFetcher({}, 500);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.source, 'static-only-degraded');
    assert.equal(ra.isAvailable(), true, 'still available after 1 failure');
  });

  test('B-10: fetch throws → degraded result returned', async () => {
    const { fn } = makeThrowFetcher();
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.source, 'static-only-degraded');
  });

  test('B-11: 3 consecutive failures → circuit breaker opens, isAvailable() false', async () => {
    const { fn } = makeFetcher({}, 503);
    const ra = new RemoteAnalyzer(TEST_CFG, fn);
    await ra.verify(minimalState(), '', makeCtx());
    await ra.verify(minimalState(), '', makeCtx());
    assert.equal(ra.isAvailable(), true, 'still available after 2 failures');
    await ra.verify(minimalState(), '', makeCtx());
    assert.equal(ra.isAvailable(), false, 'circuit should open after 3rd consecutive failure');
  });

  test('B-12: circuit open → verify returns degraded without invoking fetcher', async () => {
    const fail = makeFetcher({}, 503);
    const ra = new RemoteAnalyzer(TEST_CFG, fail.fn);
    // Open the circuit with 3 failures
    await ra.verify(minimalState(), '', makeCtx());
    await ra.verify(minimalState(), '', makeCtx());
    await ra.verify(minimalState(), '', makeCtx());
    assert.equal(ra.isAvailable(), false);

    const callsBefore = fail.getCalls();
    const result = await ra.verify(minimalState(), '', makeCtx());
    assert.equal(fail.getCalls(), callsBefore, 'fetcher must NOT be called when circuit is open');
    assert.equal(result.source, 'static-only-degraded');
    assert.equal(result.ok, true);
  });

  // Live integration — skipped unless DART_SERVICES_URL is set.
  test('B-live: real dart-services round-trip', { skip: !process.env.DART_SERVICES_URL }, async () => {
    const ra = new RemoteAnalyzer();
    assert.equal(ra.isAvailable(), true, 'DART_SERVICES_URL is set → should be available');
    const code = "import 'package:flutter/material.dart';\nvoid main() { runApp(const Text('hi')); }";
    const result = await ra.verify(minimalState(), code, makeCtx());
    assert.ok(['remote', 'static-only-degraded'].includes(result.source), `unexpected source: ${result.source}`);
  });

});

// ── CompositeVerifier ─────────────────────────────────────────────────────────

describe('CompositeVerifier (A→B composite, §1.4)', () => {

  test('CV-1: Layer A fails → B not called, A result returned and cached', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, {
      ok: false,
      errors: [{ code: 'C1', severity: 'error', message: 'err', source: 'static' }],
    }, state, ctx);
    const bStub = makeVerifierStub(true, { ok: true, source: 'remote' });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const result = await cv.verify(state, '', ctx);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(bStub.calls(), 0, 'B must not be called when A fails (§1.4 short-circuit)');
    assert.equal(aStub.calls(), 1);
  });

  test('CV-2: Layer A ok + B unavailable → A result returned and cached', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    const bStub = makeVerifierStub(false, { ok: true, source: 'remote' });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const result = await cv.verify(state, '', ctx);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'static');
    assert.equal(bStub.calls(), 0, 'B must not be called when isAvailable()=false');
  });

  test('CV-3: Layer A ok + B ok (clean) → source=composite', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    const bStub = makeVerifierStub(true, { ok: true, source: 'remote' });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const result = await cv.verify(state, '', ctx);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'composite');
    assert.equal(bStub.calls(), 1);
  });

  test('CV-4: Layer A ok + B has errors → ok:false, B errors present in result', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    const bStub = makeVerifierStub(true, {
      ok: false,
      source: 'remote',
      errors: [{ code: 'B-type_error', severity: 'error', message: 'Type mismatch', source: 'remote' }],
    });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const result = await cv.verify(state, '', ctx);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'B-type_error'));
  });

  test('CV-5: Layer A ok + B degraded → ok:true, source=static, result NOT cached', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    const bStub = makeVerifierStub(true, { ok: true, source: 'static-only-degraded' });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const r1 = await cv.verify(state, '', ctx);
    assert.equal(r1.ok, true);
    assert.equal(r1.source, 'static');

    // Second call must NOT be a cache hit — degraded is never cached (§2.6)
    const r2 = await cv.verify(state, '', ctx);
    assert.equal(r2.fromCache, false, 'degraded result must not be cached');
    assert.equal(aStub.calls(), 2, 'A must be called again on second request (no cache)');
  });

  test('CV-6: cache hit → second call returns cached, neither A nor B called again', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    const bStub = makeVerifierStub(true, { ok: true, source: 'remote' });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    await cv.verify(state, '', ctx);           // miss → A + B run, result cached
    const r2 = await cv.verify(state, '', ctx); // hit

    assert.equal(r2.fromCache, true, 'second call must be a cache hit');
    assert.equal(aStub.calls(), 1, 'A called only once');
    assert.equal(bStub.calls(), 1, 'B called only once');
  });

  test('CV-8: B-skipped verdict (B unavailable) is NOT reused once B recovers', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const aStub = makeVerifierStub(true, { ok: true, source: 'static' }, state, ctx);
    // B stub with flippable availability.
    let bAvailable = false;
    let bCalls = 0;
    const bStub: any = {
      isAvailable: () => bAvailable,
      verify: async () => { bCalls++; return { ok: true, errors: [], warnings: [], source: 'remote', cacheKey: 'x', fromCache: false, durationMs: 1 }; },
    };
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    // 1st call: B unavailable → static verdict cached under the :B0 key.
    const r1 = await cv.verify(state, '', ctx);
    assert.equal(r1.source, 'static');
    assert.equal(bCalls, 0);

    // B recovers; same appState must MISS (:B1 key) and actually run B.
    bAvailable = true;
    const r2 = await cv.verify(state, '', ctx);
    assert.equal(r2.fromCache !== true, true, 'must not serve the stale B-skipped verdict');
    assert.equal(r2.source, 'composite', 'B should now participate');
    assert.equal(bCalls, 1, 'Layer B must run after recovery instead of a stale cache hit');
  });

  test('CV-7: same warning in both A and B → deduped to single entry', async () => {
    const state = minimalState();
    const ctx = makeCtx();
    const sharedW = { code: 'W-dup', severity: 'warning' as const, message: 'same warning', source: 'static' as const };
    const aStub = makeVerifierStub(true, {
      ok: true, source: 'static',
      warnings: [sharedW],
    }, state, ctx);
    const bStub = makeVerifierStub(true, {
      ok: true, source: 'remote',
      warnings: [{ ...sharedW, source: 'remote' as const }],
    });
    const cv = new CompositeVerifier(aStub, bStub, new VerificationCache());

    const result = await cv.verify(state, '', ctx);
    const dups = result.warnings.filter(w => w.code === 'W-dup');
    assert.equal(dups.length, 1, 'duplicate warning must be deduped to one entry');
  });

});
