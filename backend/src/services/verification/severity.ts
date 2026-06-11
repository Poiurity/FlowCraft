// Severity weighting for "best candidate" selection in the repair loop.
//
// The loop ships its lowest-scoring (most-compilable) candidate when it degrades.
// Ranking by raw error COUNT can ship a state with one hard compile error over a
// state with two errors that still compile. Weighting compile-FATAL codes far
// above compile-but-degraded ones makes degrade pick the genuinely-better state.

import type { ValidationError } from './types';

// Codes whose generated Dart still COMPILES (degraded UI / runtime issue), so a
// residual one is far preferable to a hard compile error.
//   C5  → unknown widget renders SizedBox.shrink()
//   C6  → Expanded outside Flex is a layout/runtime issue, not a compile error
//   C8  → implausible prop value (already warning-severity, listed for safety)
const COMPILES_DEGRADED = new Set(['C5', 'C6', 'C8']);

const FATAL_WEIGHT = 100;
const DEGRADED_WEIGHT = 1;

/** Total severity weight of the error-level entries (lower = more shippable). */
export function severityScore(errors: ValidationError[]): number {
  let score = 0;
  for (const e of errors) {
    if (e.severity !== 'error') continue;
    score += COMPILES_DEGRADED.has(e.code) ? DEGRADED_WEIGHT : FATAL_WEIGHT;
  }
  return score;
}
