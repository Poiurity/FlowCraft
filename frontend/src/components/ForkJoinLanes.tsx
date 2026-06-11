import { StageNode } from './StageNode';
import { StageCard } from './StageCard';
import type { StageView } from '../state/pipelineReducer';

interface Props {
  lanes: Record<string, StageView>;
  onToggle: (id: string) => void;
}

// Renders parallel lanes (structure ∥ design, or segment lanes)
export function ForkJoinLanes({ lanes, onToggle }: Props) {
  const laneList = Object.values(lanes);
  if (laneList.length === 0) return null;

  const allDone = laneList.every(l => l.status === 'done' || l.status === 'warning' || l.status === 'error' || l.status === 'skipped');
  const anyActive = laneList.some(l => l.status === 'active');

  return (
    <div className="fork-join">
      {/* Fork connector */}
      <div className="fork-join__fork">
        <div className={`fork-join__fork-line${anyActive ? ' fork-join__fork-line--active' : ''}`} />
      </div>

      {/* Lane columns */}
      <div className="fork-join__lanes">
        {laneList.map(lane => (
          <div key={lane.id} className="fork-join__lane">
            <StageNode
              stage={lane}
              onToggle={() => onToggle(lane.id)}
            />
            <StageCard stage={lane} />
          </div>
        ))}
      </div>

      {/* Join connector — flows to Merge; animated when both done */}
      <div className="fork-join__join">
        {laneList.map(lane => (
          <div
            key={lane.id}
            className={`fork-join__join-line${allDone ? ' fork-join__join-line--done' : ''}`}
          />
        ))}
        <div className={`fork-join__edge-flow${allDone ? ' fork-join__edge-flow--active' : ''}`} />
      </div>
    </div>
  );
}
