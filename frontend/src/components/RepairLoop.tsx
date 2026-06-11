import { RotateCcw } from 'lucide-react';
import type { RepairEvent } from '../services/pipeline-events';
import type { StageView } from '../state/pipelineReducer';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  repairs: RepairEvent[];
  repairStage: StageView | undefined;
  degraded?: boolean;
  degradeReason?: string;
}

export function RepairLoop({ repairs, repairStage, degraded, degradeReason }: Props) {
  const { L } = useLang();
  if (repairs.length === 0 && !degraded) return null;

  const latest = repairs[repairs.length - 1];
  const issuesBefore = latest?.issuesBefore ?? 0;
  const issuesAfter = latest?.issuesAfter ?? 0;
  const totalAttempts = latest?.maxAttempts ?? 2;
  const currentAttempt = repairs.length;
  const unrepairable = latest?.unrepairable ?? false;

  return (
    <div className={`repair-loop${unrepairable || degraded ? ' repair-loop--failed' : ''}`}>
      {/* Attempt chip */}
      <div className="repair-loop__header">
        <RotateCcw size={14} className="repair-loop__icon" />
        <span className="repair-loop__chip">
          {L.repair.chip(currentAttempt, totalAttempts)}
        </span>
        {issuesBefore > 0 && (
          <span className="repair-loop__counter">
            {issuesBefore}
            {issuesAfter < issuesBefore && (
              <>
                {' → '}{issuesAfter}
                {issuesAfter === 0 && <span className="repair-loop__resolved"> ✓</span>}
              </>
            )}
            {issuesAfter >= issuesBefore && issuesBefore > 0 && ` ${L.repair.noChange}`}
            {' '}{L.repair.issuesSuffix}
          </span>
        )}
      </div>

      {/* Microcopy */}
      {!unrepairable && !degraded && (
        <div className="repair-loop__copy">
          {L.repair.copy(issuesBefore)}
        </div>
      )}

      {/* Degrade banner */}
      {(unrepairable || degraded) && (
        <div className="repair-loop__degrade">
          <span className="repair-loop__degrade-title">{L.repair.limitTitle}</span>
          {degradeReason && (
            <span className="repair-loop__degrade-reason">{degradeReason}</span>
          )}
          <span className="repair-loop__degrade-note">{L.repair.fallbackNote}</span>
        </div>
      )}

      {/* Back-arrow pulse (verify ↔ repair loop visual) */}
      {!unrepairable && !degraded && repairStage?.status === 'active' && (
        <div className="repair-loop__pulse-arrow" aria-hidden="true">↩</div>
      )}
    </div>
  );
}
