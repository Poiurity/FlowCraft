// Phase 2f — loop telemetry aggregation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recordLoopResult, getLoopStats } from '../services/verification/loop-telemetry';
import type { LoopResult } from '../services/verification/types';

function res(partial: Partial<LoopResult>): LoopResult {
  return {
    appState: {} as any, code: '', outcome: 'success', finalState: 'SUCCESS',
    verified: true, degraded: false, warnings: [], attempts: [], ...partial,
  } as LoopResult;
}

describe('loop-telemetry', () => {
  test('aggregates outcomes, degrade reasons, repair attempts, and degrade rate', () => {
    const before = getLoopStats().totalRuns;

    recordLoopResult(res({ outcome: 'success', finalState: 'SUCCESS',
      attempts: [{ source: 'initial' } as any] }));
    recordLoopResult(res({ outcome: 'degrade', finalState: 'DEGRADED', degraded: true, degradeReason: 'no_progress',
      attempts: [{ source: 'initial' } as any, { source: 'repair' } as any] }));
    recordLoopResult(res({ outcome: 'degrade-prior', finalState: 'DEGRADED', degraded: true, degradeReason: 'unrepairable',
      attempts: [{ source: 'repair' } as any] }));

    const s = getLoopStats();
    assert.equal(s.totalRuns, before + 3);
    assert.ok(s.byOutcome['degrade'] >= 1 && s.byOutcome['degrade-prior'] >= 1);
    assert.ok(s.degradeReasons['no_progress'] >= 1 && s.degradeReasons['unrepairable'] >= 1);
    assert.ok(s.repairRuns >= 2, 'two runs had repair attempts');
    assert.ok(s.repairAttemptsTotal >= 2);
    assert.ok(s.degradeRate > 0 && s.degradeRate <= 1);
  });
});
