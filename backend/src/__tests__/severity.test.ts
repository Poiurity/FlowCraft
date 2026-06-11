// Phase 1c — severity-weighted "best candidate" scoring.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { severityScore } from '../services/verification/severity';
import type { ValidationError } from '../services/verification/types';

const e = (code: string, severity: 'error' | 'warning' = 'error'): ValidationError =>
  ({ code, severity, message: code, source: 'static' });

describe('severityScore', () => {
  test('warnings do not count', () => {
    assert.equal(severityScore([e('C8', 'warning'), e('W-leading', 'warning')]), 0);
  });

  test('a single compile-fatal error outweighs two compile-degraded errors', () => {
    const oneFatal = severityScore([e('C1')]);            // 100
    const twoDegraded = severityScore([e('C5'), e('C6')]); // 1 + 1 = 2
    assert.ok(oneFatal > twoDegraded, `fatal(${oneFatal}) should outweigh degraded(${twoDegraded})`);
  });

  test('remote B-* errors are treated as compile-fatal', () => {
    assert.equal(severityScore([e('B-undefined_identifier')]), 100);
  });

  test('fewer fatal errors scores lower (better)', () => {
    assert.ok(severityScore([e('C1')]) < severityScore([e('C1'), e('C3b')]));
  });
});
