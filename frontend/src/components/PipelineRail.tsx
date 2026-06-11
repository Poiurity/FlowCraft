import { usePipeline } from '../state/PipelineContext';
import type { StageId, StageStatus } from '../services/pipeline-events';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  onClickActivity?: () => void;
}

const RAIL_STAGES: StageId[] = ['clarify', 'structure', 'merge', 'codegen', 'verify', 'repair', 'critic'];

function railColor(status: StageStatus): string {
  switch (status) {
    case 'active':  return 'rail-seg--active';
    case 'done':    return 'rail-seg--done';
    case 'warning': return 'rail-seg--warning';
    case 'error':   return 'rail-seg--error';
    case 'skipped': return 'rail-seg--skipped';
    default:        return 'rail-seg--pending';
  }
}

export function PipelineRail({ onClickActivity }: Props) {
  const { state } = usePipeline();
  const { L } = useLang();

  if (state.status === 'idle') return null;

  return (
    <button
      className="pipeline-rail"
      onClick={onClickActivity}
      title={L.rail.title}
      aria-label={L.rail.aria}
    >
      {RAIL_STAGES.map((id, i) => {
        const stage = state.stages[id] ?? state.lanes[id];
        const status: StageStatus = stage?.status ?? 'pending';
        const name = L.stageMeta[id]?.name ?? id;
        return (
          <span key={id} className={`rail-seg ${railColor(status)}`} title={name}>
            {i > 0 && <span className="rail-seg__dot" aria-hidden="true" />}
            <span className="rail-seg__bar" />
          </span>
        );
      })}
      <span className="pipeline-rail__label">
        {state.status === 'running' ? L.rail.running : state.final?.finalState === 'DEGRADED' ? L.rail.partial : L.rail.done}
      </span>
    </button>
  );
}
