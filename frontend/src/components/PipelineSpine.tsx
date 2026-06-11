import { useRef, useEffect, useCallback } from 'react';
import { usePipeline } from '../state/PipelineContext';
import { StageNode } from './StageNode';
import { StageCard } from './StageCard';
import { ForkJoinLanes } from './ForkJoinLanes';
import { RepairLoop } from './RepairLoop';
import { CriticCard } from './CriticCard';
import { PARALLEL_LANE_STAGES } from '../services/pipeline-events';
import type { PipelineAction } from '../state/pipelineReducer';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  dispatch: (a: PipelineAction) => void;
  onSkip?: () => void;
}

function SpineConnector({ active }: { active: boolean }) {
  return (
    <div className={`spine-connector${active ? ' spine-connector--active' : ''}`} aria-hidden="true" />
  );
}

export function PipelineSpine({ dispatch, onSkip }: Props) {
  const { state } = usePipeline();
  const { L } = useLang();
  const activeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active stage
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [state.stages, state.lanes]);

  const toggleStage = useCallback((id: string) => {
    dispatch({ kind: 'toggle', stageId: id });
  }, [dispatch]);

  if (state.status === 'idle') {
    return (
      <div className="pipeline-spine pipeline-spine--idle">
        <div className="pipeline-spine__idle-msg">
          <span className="pipeline-spine__idle-icon">⬡</span>
          <p>{L.spine.idle}</p>
        </div>
      </div>
    );
  }

  // Build the rendered stage list, inserting ForkJoinLanes at the right position
  const laneIds = Object.keys(state.lanes);
  const hasLanes = laneIds.length > 0;

  // Determine which sequential stages to show (non-lane, in order)
  const seqOrder = state.order.filter(id => !PARALLEL_LANE_STAGES.has(id) && !id.startsWith('segment:'));

  // Insert fork-join: after 'extend' for standard, after 'plan' for phase5
  const forkInsertAfter = state.pipeline === 'standard' ? 'extend' : 'plan';

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < seqOrder.length; i++) {
    const id = seqOrder[i];
    const stage = state.stages[id];
    if (!stage) continue;

    const isActive = stage.status === 'active';

    elements.push(
      <div key={id} ref={isActive ? activeRef : undefined} className="spine-stage-wrapper">
        <StageNode
          stage={stage}
          onToggle={() => toggleStage(id)}
        />
        <StageCard
          stage={stage}
          verifyEvents={id === 'verify' ? state.verifies : undefined}
        />
        {/* RepairLoop after verify */}
        {id === 'verify' && state.repairs.length > 0 && (
          <RepairLoop
            repairs={state.repairs}
            repairStage={state.stages['repair']}
            degraded={state.final?.degraded}
            degradeReason={state.final?.degradeReason}
          />
        )}
      </div>
    );

    // Insert fork-join lanes after 'extend' (standard) or 'plan' (phase5)
    if (id === forkInsertAfter && hasLanes) {
      elements.push(
        <SpineConnector key="fork-in" active={laneIds.some(l => state.lanes[l]?.status === 'active')} />
      );
      elements.push(
        <ForkJoinLanes
          key="fork-join"
          lanes={state.lanes}
          onToggle={toggleStage}
        />
      );
      elements.push(
        <SpineConnector key="join-out" active={laneIds.every(l => state.lanes[l]?.status === 'done')} />
      );
    } else if (i < seqOrder.length - 1) {
      const nextId = seqOrder[i + 1];
      const nextStage = state.stages[nextId];
      const connectorActive = isActive || (nextStage?.status === 'active');
      elements.push(<SpineConnector key={`conn-${id}`} active={connectorActive} />);
    }
  }

  // CriticCard at the end
  if (state.critic) {
    elements.push(
      <div key="critic-card" className="spine-critic-wrapper">
        <CriticCard critic={state.critic} />
      </div>
    );
  }

  return (
    <div className="pipeline-spine" ref={containerRef}>
      <div className="pipeline-spine__header">
        <span className="pipeline-spine__title">{L.spine.title}</span>
        {state.status === 'running' && onSkip && (
          <button className="pipeline-spine__skip-btn" onClick={onSkip}>
            {L.spine.skip}
          </button>
        )}
      </div>
      <div className="pipeline-spine__stages">
        {elements}
      </div>
    </div>
  );
}
