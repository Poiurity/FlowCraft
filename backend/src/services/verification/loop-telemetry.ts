// Process-level aggregation of closed-loop outcomes (mirrors shadowStats).
// Read-only observability: it never alters control flow. Exposed via GET
// /api/loop-stats so degrade/repair rates are a measured signal, not anecdote.

import type { LoopResult } from './types';

interface LoopStats {
  totalRuns: number;
  byOutcome: Record<string, number>;       // success | degrade | degrade-prior
  byFinalState: Record<string, number>;    // SUCCESS | SUCCESS_WITH_WARNINGS | DEGRADED
  degradeReasons: Record<string, number>;  // no_progress | oscillation | unrepairable | wall_clock | ...
  repairRuns: number;                      // runs that needed ≥1 repair attempt
  repairAttemptsTotal: number;
  criticReloops: number;
  degradeRate: number;                     // (degrade + degrade-prior) / totalRuns
}

const stats: LoopStats = {
  totalRuns: 0,
  byOutcome: {},
  byFinalState: {},
  degradeReasons: {},
  repairRuns: 0,
  repairAttemptsTotal: 0,
  criticReloops: 0,
  degradeRate: 0,
};

function bump(rec: Record<string, number>, key: string | undefined): void {
  if (!key) return;
  rec[key] = (rec[key] ?? 0) + 1;
}

export function recordLoopResult(result: LoopResult): void {
  stats.totalRuns++;
  bump(stats.byOutcome, result.outcome);
  bump(stats.byFinalState, result.finalState);
  if (result.degraded) bump(stats.degradeReasons, result.degradeReason ?? 'unknown');

  const attempts = result.attempts ?? [];
  const repairAttempts = attempts.filter(a => a.source === 'repair').length;
  if (repairAttempts > 0) stats.repairRuns++;
  stats.repairAttemptsTotal += repairAttempts;
  // A reloop appears as an extra critic-bearing repair attempt beyond the first.
  stats.criticReloops += attempts.filter(a => a.critic?.reloop).length;

  const degraded = (stats.byOutcome['degrade'] ?? 0) + (stats.byOutcome['degrade-prior'] ?? 0);
  stats.degradeRate = stats.totalRuns ? +(degraded / stats.totalRuns).toFixed(3) : 0;
}

export function getLoopStats(): LoopStats {
  return JSON.parse(JSON.stringify(stats));
}
