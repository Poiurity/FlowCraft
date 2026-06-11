import type { StageView } from '../state/pipelineReducer';
import type { VerifyEvent } from '../services/pipeline-events';
import { useLang } from '../i18n/LanguageContext';
import { stageRows } from '../i18n/stageLabels';

interface Props {
  stage: StageView;
  verifyEvents?: VerifyEvent[];
}

export function StageCard({ stage, verifyEvents }: Props) {
  const { L } = useLang();
  if (!stage.expanded) return null;

  const issues = stage.id === 'verify' && verifyEvents
    ? verifyEvents.flatMap(v => v.issues)
    : [];
  const rows = stageRows(L, stage);

  return (
    <div className="stage-card">
      {rows.length > 0 && (
        <div className="stage-card__rows">
          {rows.map((row, i) => (
            <div key={i} className="stage-card__row">
              <span className="stage-card__row-label">{row.label}</span>
              {row.value && <span className="stage-card__row-value">{row.value}</span>}
            </div>
          ))}
        </div>
      )}
      {issues.length > 0 && (
        <div className="stage-card__issues">
          <div className="stage-card__issues-title">{L.stageCard.issuesTitle}</div>
          {issues.map((issue, i) => (
            <div key={i} className={`stage-card__issue stage-card__issue--${issue.severity}`}>
              <span className="stage-card__issue-code">{issue.code}</span>
              <span className="stage-card__issue-msg">{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
