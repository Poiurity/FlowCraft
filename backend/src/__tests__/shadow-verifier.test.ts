import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runShadow, shadowStats, getVerifyMode } from '../services/verification/shadow-verifier';
import type { AppState } from '../models/appstate';

function validState(): AppState {
  return {
    appName: 'ShadowTest',
    theme: { primaryColor: '#2196F3', brightness: 'light' },
    navigation: { type: 'stack', initialRoute: '/' },
    screens: [{
      id: 'home',
      name: 'Home',
      route: '/',
      body: { type: 'column', props: {}, children: [
        { type: 'text', props: { text: 'Hello' } },
      ]},
      screenState: { variables: [] },
    }],
  };
}

function invalidState(): AppState {
  const s = validState();
  // C1: undeclared var reference
  s.screens[0].body = { type: 'text', props: { text: '{{undeclared}}' } };
  return s;
}

describe('shadow-verifier', () => {
  test('getVerifyMode returns off when env not set', () => {
    const prev = process.env.VERIFY_MODE;
    delete process.env.VERIFY_MODE;
    assert.equal(getVerifyMode(), 'off');
    if (prev !== undefined) process.env.VERIFY_MODE = prev;
  });

  test('getVerifyMode returns shadow when VERIFY_MODE=shadow', () => {
    const prev = process.env.VERIFY_MODE;
    process.env.VERIFY_MODE = 'shadow';
    assert.equal(getVerifyMode(), 'shadow');
    process.env.VERIFY_MODE = prev ?? '';
    if (!prev) delete process.env.VERIFY_MODE;
  });

  test('runShadow resolves without throwing for valid state', async () => {
    await assert.doesNotReject(
      runShadow(validState(), 'void main(){}', 'live', 'test-session-1', 'req-1')
    );
  });

  test('runShadow resolves without throwing for invalid state (never throws)', async () => {
    await assert.doesNotReject(
      runShadow(invalidState(), 'void main(){}', 'import', 'test-session-2', 'req-2')
    );
  });

  test('shadowStats records calls and histograms', async () => {
    // Run a few shadow verifications to populate stats
    await runShadow(validState(), '', 'live', 'sess-ok', 'req-ok');
    await runShadow(invalidState(), '', 'import', 'sess-bad', 'req-bad');

    const stats = shadowStats.toJSON() as any;
    assert.ok(stats.paths, 'should have paths');
    assert.ok(stats.paths['live'] || stats.paths['import'], 'should have at least one path');

    const liveStats = stats.paths['live'];
    if (liveStats) {
      assert.ok(typeof liveStats.calls === 'number', 'calls should be a number');
      assert.ok(typeof liveStats.okRate === 'number', 'okRate should be a number');
    }

    const importStats = stats.paths['import'];
    if (importStats && importStats.calls > 0) {
      // C1 should appear in import path since we used invalidState
      assert.ok(
        importStats.codeBuckets['C1'] !== undefined,
        'C1 should appear in import path histogram'
      );
    }
  });

  test('shadowStats recent ring has entries', async () => {
    await runShadow(validState(), '', 'live', 'sess-ring', 'req-ring');
    const stats = shadowStats.toJSON() as any;
    assert.ok(Array.isArray(stats.recent), 'recent should be an array');
    assert.ok(stats.recent.length > 0, 'recent should have entries');
  });
});
