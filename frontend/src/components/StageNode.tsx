import { CheckCircle, AlertTriangle, XCircle, Clock, Minus, ChevronDown, ChevronRight } from 'lucide-react';
import type { StageView } from '../state/pipelineReducer';
import { useLang } from '../i18n/LanguageContext';
import { stageLabel } from '../i18n/stageLabels';

interface Props {
  stage: StageView;
  onToggle?: () => void;
  compact?: boolean;
}

function StatusGlyph({ status }: { status: StageView['status'] }) {
  switch (status) {
    case 'active':
      return (
        <span className="stage-glyph stage-glyph--active">
          <span className="stage-pulse-dot" />
        </span>
      );
    case 'done':
      return <CheckCircle className="stage-glyph stage-glyph--done" size={16} />;
    case 'warning':
      return <AlertTriangle className="stage-glyph stage-glyph--warning" size={16} />;
    case 'error':
      return <XCircle className="stage-glyph stage-glyph--error" size={16} />;
    case 'skipped':
      return <Minus className="stage-glyph stage-glyph--skipped" size={16} />;
    case 'pending':
    default:
      return <Clock className="stage-glyph stage-glyph--pending" size={14} />;
  }
}

export function StageNode({ stage, onToggle, compact = false }: Props) {
  const { L } = useLang();
  const isClickable = stage.status !== 'pending' && onToggle;
  const hasRows = stage.rows.length > 0 || (stage.id === 'repair' && stage.issuesBefore != null);

  return (
    <div
      className={`stage-node stage-node--${stage.status}${compact ? ' stage-node--compact' : ''}`}
      onClick={isClickable ? onToggle : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => e.key === 'Enter' && onToggle() : undefined}
    >
      <div className="stage-node__header">
        <StatusGlyph status={stage.status} />
        <span className="stage-node__label">{stageLabel(L, stage)}</span>
        {stage.estimated && stage.durationMs != null && (
          <span className="stage-node__timing stage-node__timing--estimated" title={L.stageNode.estimatedTitle}>
            ~{formatMs(stage.durationMs)}
          </span>
        )}
        {!stage.estimated && stage.durationMs != null && (
          <span className="stage-node__timing">
            {formatMs(stage.durationMs)}
          </span>
        )}
        {isClickable && hasRows && (
          <span className="stage-node__chevron">
            {stage.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>
      {stage.thinking && (
        <div className="stage-node__thinking">{stage.thinking}</div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
