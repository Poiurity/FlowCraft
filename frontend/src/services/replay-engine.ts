import type { PipelineEvent, StageEvent, VerifyEvent, RepairEvent, CriticEvent, RunEvent } from './pipeline-events';
import type { GenerateResponse, LoopAttempt } from './api';
import type { Dict } from '../i18n/dict';

// Approximate budget splits for pre-verify stages (estimated=true in replay)
const PRE_VERIFY_SPLITS = {
  clarify: 0.15,
  extend:  0.05,
  structure: 0.25,
  design:  0.20,
  merge:   0.05,
  codegen: 0.30,
};

export function buildReplay(res: GenerateResponse, L: Dict): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  const attempts = res.attempts ?? [];

  // Estimate total pre-verify time from first attempt duration
  const firstAttempt = attempts[0];
  const firstDurationMs = firstAttempt?.durationMs ?? 5000;
  // Pre-verify is everything before the first verify
  const preVerifyMs = firstDurationMs * 0.6; // rough: 60% of first attempt is pre-verify

  let cursor = 0;
  const emit = (e: PipelineEvent) => events.push(e);

  // Run start
  emit({ type: 'run', phase: 'start', pipeline: 'standard' } as RunEvent);
  cursor = 0;

  // Pre-verify stages (estimated timings)
  const stages: (keyof typeof PRE_VERIFY_SPLITS)[] = ['clarify', 'extend', 'structure', 'design', 'merge', 'codegen'];
  for (const stageId of stages) {
    const fraction = PRE_VERIFY_SPLITS[stageId];
    const durationMs = Math.round(preVerifyMs * fraction);

    if (stageId === 'structure') {
      // emit both lanes active at same t (parallel)
      emit({ type: 'stage', stageId: 'structure', lane: 'structure', status: 'active', t: cursor, estimated: true } as StageEvent);
      emit({ type: 'stage', stageId: 'design',    lane: 'design',    status: 'active', t: cursor, estimated: true } as StageEvent);
      cursor += Math.round(preVerifyMs * (PRE_VERIFY_SPLITS.structure + PRE_VERIFY_SPLITS.design));
      // both done at end of their combined window
      emit({ type: 'stage', stageId: 'structure', lane: 'structure', status: 'done', t: cursor - Math.round(preVerifyMs * PRE_VERIFY_SPLITS.design), durationMs: Math.round(preVerifyMs * PRE_VERIFY_SPLITS.structure), estimated: true } as StageEvent);
      emit({ type: 'stage', stageId: 'design',    lane: 'design',    status: 'done', t: cursor, durationMs: Math.round(preVerifyMs * PRE_VERIFY_SPLITS.design), estimated: true } as StageEvent);
      continue;
    }
    if (stageId === 'design') continue; // handled above

    emit({ type: 'stage', stageId, status: 'active', t: cursor, estimated: true } as StageEvent);
    cursor += durationMs;
    const doneMeta = buildDoneLabel(stageId, res, L);
    emit({ type: 'stage', stageId, status: 'done', t: cursor, durationMs, doneLabel: doneMeta, estimated: true } as StageEvent);
  }

  // Per-attempt verify/repair cycles
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const verifyDurationMs = attempt.durationMs ?? 1000;

    // verify active
    emit({ type: 'stage', stageId: 'verify', status: 'active', t: cursor, estimated: true } as StageEvent);
    cursor += verifyDurationMs;

    // verify event
    const errorCodes = attempt.errorCodes ?? [];
    const issues: VerifyEvent['issues'] = errorCodes.map(code => ({
      code,
      severity: code.startsWith('C') ? 'error' : 'warning',
      message: code,
    }));
    emit({
      type: 'verify',
      ok: attempt.ok,
      attempt: i,
      issues,
      t: cursor,
      durationMs: verifyDurationMs,
      estimated: true,
    } as VerifyEvent);

    if (attempt.ok) {
      emit({ type: 'stage', stageId: 'verify', status: 'done', t: cursor, durationMs: verifyDurationMs, estimated: true } as StageEvent);
    } else {
      emit({ type: 'stage', stageId: 'verify', status: 'warning', t: cursor, durationMs: verifyDurationMs, estimated: true } as StageEvent);
    }

    // If there's a repair for this attempt
    if (attempt.repair && !attempt.ok) {
      const repairDurationMs = 2000; // estimated
      emit({ type: 'stage', stageId: 'repair', status: 'active', t: cursor, estimated: true } as StageEvent);
      cursor += repairDurationMs;

      const nextAttempt: LoopAttempt | undefined = attempts[i + 1];
      const issuesAfter = nextAttempt?.errorCodes?.length ?? 0;
      emit({
        type: 'repair',
        attempt: i + 1,
        maxAttempts: 2,
        unrepairable: attempt.repair.unrepairable ?? false,
        patchesApplied: attempt.repair.patchesApplied ?? 0,
        patchesDropped: attempt.repair.patchesDropped ?? 0,
        issuesBefore: issues.length,
        issuesAfter,
        t: cursor,
        durationMs: repairDurationMs,
        estimated: true,
      } as RepairEvent);

      const repairStatus = attempt.repair.unrepairable ? 'error' : 'done';
      emit({ type: 'stage', stageId: 'repair', status: repairStatus, t: cursor, durationMs: repairDurationMs, estimated: true } as StageEvent);
    }
  }

  // Critic — from the last attempt that has critic data
  const criticSource = [...attempts].reverse().find(a => a.critic?.called);
  if (criticSource?.critic) {
    const c = criticSource.critic;
    const criticDurationMs = c.durationMs ?? 1000;
    emit({ type: 'stage', stageId: 'critic', status: 'active', t: cursor, estimated: true } as StageEvent);
    cursor += criticDurationMs;

    emit({
      type: 'critic',
      fidelity: c.fidelityScore ?? res.fidelity ?? 0,
      recommendation: c.recommendation ?? 'pass',
      reloop: c.reloop ?? false,
      summary: buildCriticSummary(res, L),
      scope: L.replay.scope,
      t: cursor,
      durationMs: criticDurationMs,
      estimated: true,
    } as CriticEvent);

    emit({ type: 'stage', stageId: 'critic', status: criticStatus(c.recommendation), t: cursor, durationMs: criticDurationMs, estimated: true } as StageEvent);
  }

  // Run done
  emit({
    type: 'run',
    phase: 'done',
    finalState: res.finalState,
    degraded: res.degraded,
    degradeReason: res.degradeReason,
    fidelity: res.fidelity,
    totalMs: cursor,
  } as RunEvent);

  return events;
}

function criticStatus(rec?: string): 'done' | 'warning' | 'error' {
  if (rec === 'warn') return 'warning';
  if (rec === 'reloop') return 'error';
  return 'done';
}

function buildDoneLabel(stageId: string, res: GenerateResponse, L: Dict): string {
  switch (stageId) {
    case 'clarify': return L.replay.clarifyDone;
    case 'extend':  return L.replay.extendDone;
    case 'merge':   return L.replay.mergeDone;
    case 'codegen': {
      const screenCount = res.appState?.screens?.length ?? 0;
      return screenCount > 0 ? L.replay.codegenScreens(screenCount) : L.replay.codegenDone;
    }
    default: return '';
  }
}

function buildCriticSummary(res: GenerateResponse, L: Dict): string {
  return L.critic.summary(res.fidelity ?? 0);
}
