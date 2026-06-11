// Shared pipeline event contract — emitted by ClosedLoopOrchestrator, consumed by SSE clients.
// Keep in sync with frontend/src/services/pipeline-events.ts.

export type StageId =
  | 'clarify' | 'extend'
  | 'structure' | 'design'
  | 'plan' | 'compose'
  | `segment:${string}`
  | 'merge' | 'codegen'
  | 'verify' | 'repair' | 'critic';

export type StageStatus = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';
export type Lane = 'structure' | 'design' | `segment:${string}`;

export interface ToolCallRow { label: string; value?: string; }

export interface StageEvent {
  type: 'stage';
  stageId: StageId;
  lane?: Lane;
  status: StageStatus;
  activeLabel?: string;
  doneLabel?: string;
  attempt?: number;
  maxAttempts?: number;
  rows?: ToolCallRow[];
  thinking?: string;   // one-line "what this agent reasoned/decided"
  t: number;
  durationMs?: number;
}

export interface VerifyEvent {
  type: 'verify';
  ok: boolean;
  attempt: number;
  issues: { code: string; severity: 'error' | 'warning'; nodePath?: string; message: string }[];
  t: number;
  durationMs?: number;
}

export interface RepairEvent {
  type: 'repair';
  attempt: number;
  maxAttempts: number;
  unrepairable: boolean;
  patchesApplied: number;
  patchesDropped: number;
  issuesBefore: number;
  issuesAfter: number;
  t: number;
  durationMs?: number;
}

export interface CriticEvent {
  type: 'critic';
  fidelity: number;
  recommendation: 'pass' | 'warn' | 'reloop';
  reloop: boolean;
  summary: string;
  scope: string;
  t: number;
  durationMs?: number;
}

export interface RunEvent {
  type: 'run';
  phase: 'start' | 'done';
  pipeline?: 'standard' | 'phase5';
  finalState?: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'DEGRADED';
  degraded?: boolean;
  degradeReason?: string;
  fidelity?: number;
  totalMs?: number;
}

export type PipelineEvent = RunEvent | StageEvent | VerifyEvent | RepairEvent | CriticEvent;
