// Single source of truth for verification contracts.
// Imported (never redefined) by StaticValidator, RemoteAnalyzer, CompositeVerifier,
// Orchestrator, RepairAgent, Critic, the import handler, and the eval harness.

import type { AppState } from '../../models/appstate';
import type { WidgetDefinition } from '../widget-registry/types';

// ── RegistrySnapshot — frozen read-only facade over the widget registry ──

export interface RegistrySnapshot {
  values(): IterableIterator<WidgetDefinition>;
  hasWidget(type: string): boolean;
  getDefinition(type: string): WidgetDefinition | null;
  readonly hardcodedWidgets: ReadonlySet<string>;
  readonly registryVersion: string;
}

// ── Verifier interface — one contract, two implementations, one composite ──

export interface Verifier {
  verify(appState: AppState, code: string, ctx: VerifyContext): Promise<AnalyzeResult>;
  isAvailable(): boolean;
}

export interface VerifyContext {
  registryVersion: string;
  registrySnapshot: RegistrySnapshot;
  source?: 'live' | 'import';
  requestId?: string;
  attempt?: number;
}

// ── Results ──

export interface AnalyzeResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  source: 'static' | 'remote' | 'composite' | 'cache' | 'static-only-degraded';
  cacheKey: string;
  fromCache: boolean;
  durationMs: number;
}

export interface SourceLocation {
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
  screenId?: string;
  screenIdx?: number;
  nodePath?: string;
}

export interface ValidationError {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  source: 'static' | 'remote' | 'orchestrator';
  location?: SourceLocation;
  context?: Record<string, unknown>;
}

// ── RepairAgent I/O ──

export type RepairOp = 'set' | 'remove' | 'insert' | 'insert-create';

export interface RepairPatch {
  op: RepairOp;
  path: string;
  value?: unknown;
  index?: number;
}

export interface RepairInput {
  appState: AppState;
  errors: ValidationError[];
  originalPrompt: string;
  attempt: number;
}

export interface RepairResult {
  appState: AppState;
  repairNotes: string;
  unrepairable: boolean;
}

// ── Critic ──

export type CriticRecommendation = 'pass' | 'warn' | 'reloop';

export interface CriticFeature {
  description: string;
  severity: 'core' | 'minor';
  evidence?: string;
}

export interface CriticVerdict {
  fidelityScore: number;           // 0..100
  recommendation: CriticRecommendation;
  missingFeatures: CriticFeature[];
  extraFeatures: CriticFeature[];
  summary: string;
  reloopFeedback?: string;         // present iff recommendation==='reloop'
}

export interface CriticInput {
  originalPrompt: string;
  enrichedPrompt: string;
  intent: string;
  factSheet: string;
  codeSample: string;
  attempt: number;                 // 0=first critic call; 1=re-judge after reloop
}

// ── Telemetry ──

export interface AgentCallRecord {
  agent: 'clarifier' | 'structure' | 'design' | 'extender' | 'repair' | 'critic' | 'planner';
  model: string;
  fallbackUsed: boolean;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  retries: number;
  ok: boolean;
}

export interface AttemptRecord {
  attempt: number;
  source: 'initial' | 'repair';
  verify: {
    ok: boolean;
    source: AnalyzeResult['source'];
    fromCache: boolean;
    errorCodes: string[];
    durationMs: number;
  };
  errorMultiset: Record<string, number>;   // code@nodePath → count (§3.2)
  repair?: {
    unrepairable: boolean;
    repairNotes: string;
    patchesApplied: number;
    patchesDropped: number;
  };
  critic?: {
    called: boolean;
    fromCache: boolean;
    fidelityScore: number;
    recommendation: CriticRecommendation;
    reloop: boolean;
    durationMs: number;
    costUsd: number;
  };
  remote?: {
    ran: boolean;
    durationMs: number;
    degraded: boolean;
    issueCount: number;
  };
  durationMs: number;
  agents: AgentCallRecord[];
}

// ── Loop result ──

export interface LoopResult {
  appState: AppState;
  code: string;
  outcome: 'success' | 'degrade-prior' | 'degrade';
  finalState: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'DEGRADED';
  verified: boolean;
  degraded: boolean;
  degradeReason?: string;
  warnings: ValidationError[];
  fidelity?: number;
  attempts: AttemptRecord[];
}
