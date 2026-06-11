import type {
  PipelineEvent,
  StageEvent,
  VerifyEvent,
  RepairEvent,
  CriticEvent,
  RunEvent,
  StageId,
  StageStatus,
  ToolCallRow,
} from '../services/pipeline-events';
import {
  STANDARD_ORDER,
  PHASE5_ORDER,
  PARALLEL_LANE_STAGES,
} from '../services/pipeline-events';

// StageView holds language-neutral, structured state. Display labels are
// resolved at render time from the active language (see i18n/stageLabels.ts),
// so toggling the language switches every label instantly.
export interface StageView {
  id: StageId;
  status: StageStatus;
  /** Optional labels baked by the backend (in the language at generation time). */
  serverActiveLabel?: string;
  serverDoneLabel?: string;
  /** For segment lanes: the screen name carried by the stage id. */
  segmentName?: string;
  estimated?: boolean;
  rows: ToolCallRow[];
  durationMs?: number;
  expanded: boolean;
  // Structured fields used to build dynamic labels at render time.
  verifyOk?: boolean;
  verifyIssueCount?: number;
  repairAttempt?: number;
  repairMax?: number;
  patchesApplied?: number;
  patchesDropped?: number;
  issuesBefore?: number;
  criticFidelity?: number;
}

export interface PipelineState {
  status: 'idle' | 'running' | 'done';
  pipeline: 'standard' | 'phase5';
  order: StageId[];
  stages: Record<string, StageView>;
  lanes: Record<string, StageView>;   // parallel lane stages (structure/design or segment:*)
  verifies: VerifyEvent[];
  repairs: RepairEvent[];
  critic: CriticEvent | null;
  final: Pick<RunEvent, 'finalState' | 'degraded' | 'degradeReason' | 'fidelity' | 'totalMs'> | null;
}

export type PipelineAction =
  | { kind: 'event'; event: PipelineEvent }
  | { kind: 'reset' };

function makeStageView(id: StageId): StageView {
  return {
    id,
    status: 'pending',
    rows: [],
    expanded: false,
  };
}

function makeSegmentView(stageId: string): StageView {
  const segmentName = stageId.startsWith('segment:') ? stageId.slice(8) : stageId;
  return {
    id: stageId as StageId,
    status: 'pending',
    segmentName,
    rows: [],
    expanded: false,
  };
}

function buildInitialStages(order: StageId[]): Record<string, StageView> {
  const stages: Record<string, StageView> = {};
  for (const id of order) {
    if (!PARALLEL_LANE_STAGES.has(id)) {
      stages[id] = makeStageView(id);
    }
  }
  return stages;
}

export const INITIAL_STATE: PipelineState = {
  status: 'idle',
  pipeline: 'standard',
  order: STANDARD_ORDER,
  stages: buildInitialStages(STANDARD_ORDER),
  lanes: {},
  verifies: [],
  repairs: [],
  critic: null,
  final: null,
};

function applyStageEvent(state: PipelineState, e: StageEvent): PipelineState {
  const baseView: StageView = (
    state.lanes[e.stageId] ??
    state.stages[e.stageId] ??
    (e.stageId.startsWith('segment:') ? makeSegmentView(e.stageId) : makeStageView(e.stageId))
  );

  const updated: StageView = {
    ...baseView,
    status: e.status,
    serverActiveLabel: e.status === 'active' ? (e.activeLabel ?? baseView.serverActiveLabel) : baseView.serverActiveLabel,
    serverDoneLabel:
      e.status === 'done' || e.status === 'warning' || e.status === 'error'
        ? (e.doneLabel ?? baseView.serverDoneLabel)
        : baseView.serverDoneLabel,
    estimated: e.estimated,
    rows: e.rows ?? baseView.rows,
    durationMs: e.durationMs ?? baseView.durationMs,
    // auto-expand active stages; collapse on done
    expanded: e.status === 'active' ? true : e.status === 'done' ? false : baseView.expanded,
  };

  // Lane stages (structure, design, segment:*) go into `lanes`
  const isLane = PARALLEL_LANE_STAGES.has(e.stageId) || e.stageId.startsWith('segment:');
  if (isLane) {
    const newLanes = { ...state.lanes, [e.stageId]: updated };
    // Ensure segment stages appear in order if new
    let newOrder = state.order;
    if (e.stageId.startsWith('segment:') && !state.order.includes(e.stageId)) {
      const insertIdx = state.order.indexOf('compose');
      newOrder = [
        ...state.order.slice(0, insertIdx),
        e.stageId,
        ...state.order.slice(insertIdx),
      ];
    }
    return { ...state, lanes: newLanes, order: newOrder };
  }

  return { ...state, stages: { ...state.stages, [e.stageId]: updated } };
}

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  if (action.kind === 'reset') return INITIAL_STATE;

  const { event } = action;

  switch (event.type) {
    case 'run': {
      const e = event as RunEvent;
      if (e.phase === 'start') {
        const pipeline = e.pipeline ?? 'standard';
        const order = pipeline === 'phase5' ? PHASE5_ORDER : STANDARD_ORDER;
        // Initialize all non-lane stages as pending
        const stages = buildInitialStages(order);
        // For standard, pre-populate lanes
        const lanes: Record<string, StageView> = {};
        if (pipeline === 'standard') {
          lanes['structure'] = makeStageView('structure');
          lanes['design'] = makeStageView('design');
        }
        return {
          ...INITIAL_STATE,
          status: 'running',
          pipeline,
          order,
          stages,
          lanes,
        };
      }
      // phase === 'done'
      return {
        ...state,
        status: 'done',
        final: {
          finalState: e.finalState,
          degraded: e.degraded,
          degradeReason: e.degradeReason,
          fidelity: e.fidelity,
          totalMs: e.totalMs,
        },
      };
    }

    case 'stage':
      return applyStageEvent(state, event as StageEvent);

    case 'verify': {
      const e = event as VerifyEvent;
      // Update verify stage status based on result
      const verifyView = state.stages['verify'] ?? makeStageView('verify');
      const newStatus: StageStatus = e.ok ? 'done' : 'warning';
      const updated: StageView = {
        ...verifyView,
        status: newStatus,
        verifyOk: e.ok,
        verifyIssueCount: e.issues.length,
        durationMs: e.durationMs ?? verifyView.durationMs,
        estimated: e.estimated,
        expanded: !e.ok,
      };
      return {
        ...state,
        stages: { ...state.stages, verify: updated },
        verifies: [...state.verifies, e],
      };
    }

    case 'repair': {
      const e = event as RepairEvent;
      const repairView = state.stages['repair'] ?? makeStageView('repair');
      const updated: StageView = {
        ...repairView,
        status: e.unrepairable ? 'error' : 'active',
        repairAttempt: e.attempt,
        repairMax: e.maxAttempts,
        issuesBefore: e.issuesBefore,
        patchesApplied: e.patchesApplied,
        patchesDropped: e.patchesDropped,
        durationMs: e.durationMs ?? repairView.durationMs,
        estimated: e.estimated,
        expanded: true,
      };
      return {
        ...state,
        stages: { ...state.stages, repair: updated },
        repairs: [...state.repairs, e],
      };
    }

    case 'critic': {
      const e = event as CriticEvent;
      const criticView = state.stages['critic'] ?? makeStageView('critic');
      const updated: StageView = {
        ...criticView,
        status: e.recommendation === 'pass' ? 'done' : e.recommendation === 'warn' ? 'warning' : 'error',
        criticFidelity: e.fidelity,
        durationMs: e.durationMs ?? criticView.durationMs,
        estimated: e.estimated,
        expanded: false,
      };
      return {
        ...state,
        stages: { ...state.stages, critic: updated },
        critic: e,
      };
    }

    default:
      return state;
  }
}
