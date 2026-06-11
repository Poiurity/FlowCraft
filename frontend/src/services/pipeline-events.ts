// Transport-agnostic event contract — consumed identically by replay engine and SSE

export type StageId =
  | 'clarify'
  | 'extend'
  | 'structure'
  | 'design'          // parallel lanes (standard create)
  | 'plan'
  | 'compose'         // Phase 5 only
  | `segment:${string}` // Phase 5 per-segment lanes
  | 'merge'
  | 'codegen'
  | 'verify'
  | 'repair'
  | 'critic';

export type StageStatus = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';
export type Lane = 'structure' | 'design' | `segment:${string}`;

export interface ToolCallRow {
  label: string;
  value?: string;
}

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
  estimated?: boolean;
}

export interface VerifyEvent {
  type: 'verify';
  ok: boolean;
  attempt: number;
  issues: { code: string; severity: 'error' | 'warning'; nodePath?: string; message: string }[];
  t: number;
  durationMs?: number;
  estimated?: boolean;
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
  estimated?: boolean;
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
  estimated?: boolean;
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

// Stage display metadata (Korean labels)
export const STAGE_META: Record<string, { name: string; activeLabel: string; doneLabel: string }> = {
  clarify:   { name: '요구사항 분석', activeLabel: '요구사항 분석 중…', doneLabel: '요구사항 확정' },
  extend:    { name: '위젯 준비',    activeLabel: '위젯 준비 중…',    doneLabel: '위젯 목록 확정' },
  structure: { name: '구조 설계',    activeLabel: '화면 구조 생성 중…', doneLabel: '화면 구조 완성' },
  design:    { name: '디자인 설계',  activeLabel: '테마 및 스타일 생성 중…', doneLabel: '디자인 완성' },
  plan:      { name: '앱 기획',      activeLabel: '앱 구조 기획 중…', doneLabel: '기획 완성' },
  compose:   { name: '화면 조합',    activeLabel: '화면 조합 중…',    doneLabel: '화면 조합 완성' },
  merge:     { name: '병합',         activeLabel: '상태 병합 중…',    doneLabel: '병합 완성' },
  codegen:   { name: '코드 생성',    activeLabel: 'Dart 코드 생성 중…', doneLabel: '코드 생성 완성' },
  verify:    { name: '검증',         activeLabel: '코드 검증 중…',    doneLabel: '검증 완료' },
  repair:    { name: '수정',         activeLabel: '오류 수정 중…',    doneLabel: '수정 완료' },
  critic:    { name: '품질 평가',    activeLabel: '충실도 평가 중…',  doneLabel: '평가 완료' },
};

// Standard pipeline stage order
export const STANDARD_ORDER: StageId[] = [
  'clarify', 'extend', 'structure', 'design', 'merge', 'codegen', 'verify', 'repair', 'critic',
];

// Phase 5 pipeline stage order
export const PHASE5_ORDER: StageId[] = [
  'clarify', 'extend', 'plan', 'compose', 'codegen', 'verify', 'repair', 'critic',
];

// Which stage IDs are parallel lanes in standard pipeline
export const PARALLEL_LANE_STAGES = new Set<StageId>(['structure', 'design']);
