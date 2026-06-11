// Phase 3 — Closed-loop orchestrator.
// Three-function seam: prepare() → generateForIntent() → run()
// run() wraps the GENERATE→VERIFY→REPAIR(×MAX_REPAIRS)→CRITIC→SUCCESS/DEGRADE cycle.
//
// Phase 2 SSE: optional onEvent callback emits PipelineEvent at every seam.
// Purely additive — no control flow change.

import { randomUUID } from 'crypto';
import { AppStateSchema, type AppState } from '../../models/appstate.js';
import { ClarifierAgent, type ClarifiedRequirement, type Intent } from './clarifier-agent.js';
import { WidgetExtenderAgent } from './widget-extender-agent.js';
import { StructureAgent } from './structure-agent.js';
import { DesignAgent } from './design-agent.js';
import { RepairAgent } from './repair-agent.js';
import { CriticAgent } from './critic-agent.js';
import { PlannerAgent, composePlan, type SegmentPlan } from './planner-agent.js';
import { StructureEmptyError } from './errors.js';
import { CodeGenerator } from '../code-generator.js';
import { StaticValidator } from '../verification/static-validator.js';
import { RemoteAnalyzer } from '../verification/remote-analyzer.js';
import { CompositeVerifier } from '../verification/composite-verifier.js';
import { VerificationCache } from '../verification/verification-cache.js';
import { loadRemoteConfig } from '../verification/remote-config.js';
import { widgetRegistry } from '../widget-registry/registry-manager.js';
import { collectScreenActions } from '../codegen-shared/action-naming.js';
import type {
  RegistrySnapshot, LoopResult, AttemptRecord, ValidationError, AnalyzeResult,
  CriticVerdict,
} from '../verification/types.js';
import type { PipelineEvent, StageId } from '../pipeline-events.js';
import { ORCHESTRATOR_LABELS, type Lang, type OrchestratorLabels } from './pipeline-labels.js';
import { severityScore } from '../verification/severity.js';

const MAX_REPAIRS = 2;
const MAX_CRITIC_RELOOPS = 1;
const WALL_CLOCK_MS = 30_000;
const PER_REPAIR_BUDGET_MS = 9_000;

// ── Oscillation guard — §3.2 (location-aware) ────────────────────────────────

function msKey(errors: ValidationError[]): string {
  const freq: Record<string, number> = {};
  for (const e of errors) {
    if (e.severity !== 'error') continue;
    const id = `${e.code}@${e.location?.nodePath ?? ''}`;
    freq[id] = (freq[id] ?? 0) + 1;
  }
  return Object.keys(freq).sort().map(k => `${k}:${freq[k]}`).join('|');
}

// ── Context types ─────────────────────────────────────────────────────────────

export interface PrepareResult {
  clarified: ClarifiedRequirement;
  intent: Intent;
  baseState?: AppState;
  registrySnapshot: RegistrySnapshot;
  registryVersion: string;
  requestId: string;
}

interface GenerateCtx extends PrepareResult {
  originalPrompt: string;
}

// ── Module-level shared instances ────────────────────────────────────────────

const sharedCache = new VerificationCache(256);

// ── ClosedLoopOrchestrator ───────────────────────────────────────────────────

export class ClosedLoopOrchestrator {
  private clarifier: ClarifierAgent;
  private widgetExtender: WidgetExtenderAgent;
  private structureAgent: StructureAgent;
  private designAgent: DesignAgent;
  private repairAgent: RepairAgent;
  private criticAgent: CriticAgent;
  private plannerAgent: PlannerAgent;
  private codeGenerator: CodeGenerator;
  private verifier: CompositeVerifier;
  private remoteAnalyzer: RemoteAnalyzer;

  // Phase 2 SSE instrumentation — purely additive
  private onEvent?: (e: PipelineEvent) => void;
  private runT0 = 0;
  // Localized stage labels (language requested at generation time)
  private L: OrchestratorLabels;

  constructor(apiKey: string, onEvent?: (e: PipelineEvent) => void, lang: Lang = 'ko') {
    this.clarifier = new ClarifierAgent(apiKey);
    this.widgetExtender = new WidgetExtenderAgent(apiKey);
    this.structureAgent = new StructureAgent(apiKey);
    this.designAgent = new DesignAgent(apiKey);
    this.repairAgent = new RepairAgent(apiKey);
    this.criticAgent = new CriticAgent(apiKey);
    this.plannerAgent = new PlannerAgent(apiKey);
    this.codeGenerator = new CodeGenerator();
    this.remoteAnalyzer = new RemoteAnalyzer(loadRemoteConfig());
    this.verifier = new CompositeVerifier(
      new StaticValidator(),
      this.remoteAnalyzer,
      sharedCache,
    );
    this.onEvent = onEvent;
    this.L = ORCHESTRATOR_LABELS[lang] ?? ORCHESTRATOR_LABELS.ko;
  }

  // ── Event helpers ─────────────────────────────────────────────────────────

  private emit(event: PipelineEvent): void {
    this.onEvent?.(event);
  }

  private t(): number {
    return Date.now() - this.runT0;
  }

  private stageActive(stageId: StageId, lane?: string, activeLabel?: string): void {
    this.emit({
      type: 'stage',
      stageId,
      ...(lane ? { lane: lane as any } : {}),
      status: 'active',
      ...(activeLabel ? { activeLabel } : {}),
      t: this.t(),
    });
  }

  private stageDone(stageId: StageId, durationMs: number, doneLabel?: string, lane?: string): void {
    this.emit({
      type: 'stage',
      stageId,
      ...(lane ? { lane: lane as any } : {}),
      status: 'done',
      ...(doneLabel ? { doneLabel } : {}),
      t: this.t(),
      durationMs,
    });
  }

  private stageWarning(stageId: StageId, durationMs: number, doneLabel?: string): void {
    this.emit({ type: 'stage', stageId, status: 'warning', ...(doneLabel ? { doneLabel } : {}), t: this.t(), durationMs });
  }

  private stageError(stageId: StageId, durationMs: number): void {
    this.emit({ type: 'stage', stageId, status: 'error', t: this.t(), durationMs });
  }

  private stageSkipped(stageId: StageId): void {
    this.emit({ type: 'stage', stageId, status: 'skipped', t: this.t() });
  }

  private emitVerify(result: AnalyzeResult, attempt: number, durationMs: number): void {
    this.emit({
      type: 'verify',
      ok: result.ok,
      attempt,
      issues: result.errors.map(e => ({
        code: e.code,
        severity: e.severity as 'error' | 'warning',
        nodePath: e.location?.nodePath,
        message: e.message,
      })),
      t: this.t(),
      durationMs,
    });
    if (result.ok) {
      this.stageDone('verify', durationMs, this.L.verifyClean);
    } else {
      this.stageWarning('verify', durationMs, this.L.verifyIssues(result.errors.length));
    }
  }

  private emitRepair(
    attempt: number,
    unrepairable: boolean,
    patchesApplied: number,
    patchesDropped: number,
    issuesBefore: number,
    issuesAfter: number,
    durationMs: number,
  ): void {
    this.emit({
      type: 'repair',
      attempt,
      maxAttempts: MAX_REPAIRS,
      unrepairable,
      patchesApplied,
      patchesDropped,
      issuesBefore,
      issuesAfter,
      t: this.t(),
      durationMs,
    });
    if (unrepairable) {
      this.stageError('repair', durationMs);
    } else {
      this.stageDone('repair', durationMs, this.L.repairDone(attempt, MAX_REPAIRS));
    }
  }

  // ── Step 1: CLARIFY + EXTEND ──────────────────────────────────────────────

  async prepare(prompt: string, currentState?: AppState): Promise<PrepareResult> {
    console.log(`[ClosedLoop] prepare: "${prompt.slice(0, 60)}..."`);

    this.stageActive('clarify', undefined, this.L.clarifyActive);
    const tClarify = Date.now();
    const clarified = await this.clarifier.clarify(prompt, currentState);
    const clarifyDuration = Date.now() - tClarify;
    console.log(`[ClosedLoop] intent=${clarified.intent} widgets=[${clarified.requiredWidgets.join(',')}]`);
    this.stageDone('clarify', clarifyDuration, `intent: ${clarified.intent}`);

    this.stageActive('extend', undefined, this.L.extendActive);
    const tExtend = Date.now();
    const added = await this.widgetExtender.ensureWidgets(clarified.requiredWidgets);
    const extendDuration = Date.now() - tExtend;
    if (added.length > 0) {
      console.log(`[ClosedLoop] staged widgets: [${added.join(',')}]`);
      this.stageDone('extend', extendDuration, this.L.extendDone(added.length));
    } else {
      this.stageSkipped('extend');
    }

    const snap = widgetRegistry.cloneDefinitions();
    return {
      clarified,
      intent: clarified.intent,
      baseState: currentState,
      registrySnapshot: snap,
      registryVersion: snap.registryVersion,
      requestId: randomUUID(),
    };
  }

  // ── Step 2: GENERATE ──────────────────────────────────────────────────────

  async generateForIntent(ctx: GenerateCtx, repairFeedback?: string): Promise<AppState> {
    const { clarified, intent, baseState } = ctx;
    const enriched = repairFeedback
      ? `${clarified.enrichedPrompt}\n\n[Feedback: ${repairFeedback}]`
      : clarified.enrichedPrompt;

    let appState: AppState;

    switch (intent) {
      case 'create': {
        const tStructure = Date.now();
        const tDesign = Date.now();
        this.stageActive('structure', 'structure', this.L.structureActive);
        this.stageActive('design', 'design', this.L.designActive);

        const [structure, design] = await Promise.all([
          this.structureAgent.generate(enriched).then(r => {
            this.stageDone('structure', Date.now() - tStructure, this.L.structureDone(r.screens?.length ?? 0), 'structure');
            return r;
          }),
          this.designAgent.generate(clarified.designDirection || enriched).then(r => {
            this.stageDone('design', Date.now() - tDesign, this.L.designDone, 'design');
            return r;
          }),
        ]);

        this.stageActive('merge', undefined, this.L.mergeActive);
        const tMerge = Date.now();
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: design.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        this.stageDone('merge', Date.now() - tMerge, this.L.mergeDone);
        break;
      }
      case 'modifyStructure': {
        this.stageActive('structure', undefined, this.L.structureFixActive);
        const tStructure = Date.now();
        const structure = await this.structureAgent.modify(enriched, baseState!);
        this.stageDone('structure', Date.now() - tStructure, this.L.structureFixDone(structure.screens?.length ?? 0));

        this.stageActive('merge', undefined, this.L.mergeActive);
        const tMerge = Date.now();
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: baseState!.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        this.stageDone('merge', Date.now() - tMerge, this.L.mergeDone);
        break;
      }
      case 'modifyDesign': {
        this.stageActive('design', undefined, this.L.designFixActive);
        const tDesign = Date.now();
        const design = await this.designAgent.modify(clarified.designDirection || enriched, baseState!.theme);
        this.stageDone('design', Date.now() - tDesign, this.L.designFixDone);

        this.stageActive('merge', undefined, this.L.mergeActive);
        const tMerge = Date.now();
        appState = AppStateSchema.parse({
          appName: baseState!.appName,
          theme: design.theme,
          screens: baseState!.screens,
          navigation: baseState!.navigation,
        });
        this.stageDone('merge', Date.now() - tMerge, this.L.mergeDone);
        break;
      }
      case 'modifyBoth': {
        const tStructure = Date.now();
        const tDesign = Date.now();
        this.stageActive('structure', 'structure', this.L.structureFixActive);
        this.stageActive('design', 'design', this.L.designThemeFixActive);

        const [structure, design] = await Promise.all([
          this.structureAgent.modify(enriched, baseState!).then(r => {
            this.stageDone('structure', Date.now() - tStructure, this.L.structureScreens(r.screens?.length ?? 0), 'structure');
            return r;
          }),
          this.designAgent.modify(clarified.designDirection || enriched, baseState!.theme).then(r => {
            this.stageDone('design', Date.now() - tDesign, this.L.designFixDone, 'design');
            return r;
          }),
        ]);

        this.stageActive('merge', undefined, this.L.mergeActive);
        const tMerge = Date.now();
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: design.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        this.stageDone('merge', Date.now() - tMerge, this.L.mergeDone);
        break;
      }
    }

    // Preserve app identity on modify intents. The structure agent regenerates
    // appName (and, for modifyStructure/Both, navigation) from a fresh LLM call,
    // which would silently RENAME the app / reset its nav shell on a request that
    // only asked to change content. Restore them deterministically from baseState.
    // (Preserving the full multi-screen set is coupled to the multi-screen-default
    // work; here we only guard nav when the base is single-screen so the collapsed
    // result stays consistent.)
    if (intent !== 'create' && baseState) {
      appState = { ...appState!, appName: baseState.appName };
      if ((baseState.screens?.length ?? 0) <= 1) {
        appState.navigation = baseState.navigation;
      }
    }

    return appState!;
  }

  // ── Step 3: CLOSED LOOP ───────────────────────────────────────────────────
  // Public run() is the SSE wrapper; _runCore() contains the loop logic.

  async run(prompt: string, currentState?: AppState): Promise<LoopResult> {
    this.runT0 = Date.now();
    this.emit({ type: 'run', phase: 'start', pipeline: 'standard' });

    let result: LoopResult;
    try {
      result = await this._runCore(prompt, currentState);
    } catch (err) {
      this.emit({ type: 'run', phase: 'done', finalState: 'DEGRADED', degraded: true, totalMs: this.t() });
      throw err;
    }
    this.emit({
      type: 'run', phase: 'done',
      finalState: result.finalState,
      degraded: result.degraded,
      degradeReason: result.degradeReason,
      fidelity: result.fidelity,
      totalMs: this.t(),
    });
    return result;
  }

  private async _runCore(prompt: string, currentState?: AppState): Promise<LoopResult> {
    const t0 = this.runT0;
    const attempts: AttemptRecord[] = [];

    let prepResult: PrepareResult;
    try {
      prepResult = await this.prepare(prompt, currentState);
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator);
    }

    const FEATURE_PHASE5 = process.env.FLOWCRAFT_PHASE5 === '1' && this.remoteAnalyzer.isAvailable();
    if (FEATURE_PHASE5 && prepResult.intent === 'create') {
      return this.runPhase5(prompt, currentState, prepResult, t0);
    }

    const ctx: GenerateCtx = { ...prepResult, originalPrompt: prompt };
    const { registrySnapshot: snap, registryVersion, requestId } = prepResult;

    // GENERATE
    let appState: AppState;
    try {
      appState = await this.generateForIntent(ctx);
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
    }

    // CODEGEN
    this.stageActive('codegen', undefined, this.L.codegenActive);
    const tCodegen = Date.now();
    let code = this.codeGenerator.generate(appState, snap);
    this.stageDone('codegen', Date.now() - tCodegen, this.L.codegenDone(appState.screens.length));

    // VERIFY (attempt 0)
    this.stageActive('verify', undefined, this.L.verifyActive);
    const tVerify0 = Date.now();
    let verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, 0);
    const verifyDuration0 = Date.now() - tVerify0;
    attempts.push(makeAttemptRecord(0, 'initial', verifyResult, undefined, verifyDuration0));
    this.emitVerify(verifyResult, 0, verifyDuration0);

    if (verifyResult.ok) {
      console.log('[ClosedLoop] attempt 0 ok');
      return this.runCritic(appState, code, ctx, attempts, verifyResult.warnings, t0, 0);
    }

    console.log(`[ClosedLoop] attempt 0 errors=[${verifyResult.errors.map(e => e.code).join(',')}]`);

    const seen = new Set<string>([msKey(verifyResult.errors)]);
    let prevKey = msKey(verifyResult.errors);

    let bestAppState = appState;
    let bestCode = code;
    let bestErrors = verifyResult.errors;
    let bestScore = severityScore(verifyResult.errors);

    for (let repairAttempt = 1; repairAttempt <= MAX_REPAIRS; repairAttempt++) {
      if (Date.now() - t0 + PER_REPAIR_BUDGET_MS > WALL_CLOCK_MS) {
        console.warn('[ClosedLoop] wall_clock — not enough budget for another repair');
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'wall_clock', attempts,
        );
      }

      console.log(`[ClosedLoop] repair ${repairAttempt}/${MAX_REPAIRS}`);
      const issuesBefore = verifyResult.errors.length;

      this.stageActive('repair', undefined, this.L.repairActive(repairAttempt, MAX_REPAIRS));
      const tRepair = Date.now();

      const repairResult = await this.repairAgent.repair(
        {
          appState,
          errors: verifyResult.errors.filter(e => e.severity === 'error').slice(0, 8),
          originalPrompt: ctx.clarified.enrichedPrompt,
          attempt: repairAttempt,
        },
        snap,
      );

      const repairMeta = (repairResult as any)._meta as
        { patchesApplied: number; patchesDropped: number } | undefined;

      if (repairResult.unrepairable) {
        console.warn('[ClosedLoop] unrepairable');
        const last = attempts[attempts.length - 1];
        last.repair = {
          unrepairable: true,
          repairNotes: repairResult.repairNotes,
          patchesApplied: 0,
          patchesDropped: 0,
        };
        const repairDuration = Date.now() - tRepair;
        this.emitRepair(repairAttempt, true, 0, 0, issuesBefore, issuesBefore, repairDuration);
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'unrepairable', attempts,
        );
      }

      appState = repairResult.appState;
      code = this.codeGenerator.generate(appState, snap);

      // RE-VERIFY after repair
      this.stageActive('verify', undefined, this.L.verifyReActive);
      const tReVerify = Date.now();
      verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, repairAttempt);
      const reVerifyDuration = Date.now() - tReVerify;
      const repairDuration = Date.now() - tRepair;

      this.emitRepair(
        repairAttempt,
        false,
        repairMeta?.patchesApplied ?? 0,
        repairMeta?.patchesDropped ?? 0,
        issuesBefore,
        verifyResult.errors.length,
        repairDuration,
      );

      const newAttempt = makeAttemptRecord(repairAttempt, 'repair', verifyResult, {
        unrepairable: false,
        repairNotes: repairResult.repairNotes,
        patchesApplied: repairMeta?.patchesApplied ?? 0,
        patchesDropped: repairMeta?.patchesDropped ?? 0,
      }, repairDuration);
      attempts.push(newAttempt);

      this.emitVerify(verifyResult, repairAttempt, reVerifyDuration);

      if (verifyResult.ok) {
        console.log(`[ClosedLoop] repair ${repairAttempt} ok`);
        return this.runCritic(appState, code, ctx, attempts, verifyResult.warnings, t0, 0);
      }

      const curKey = msKey(verifyResult.errors);

      if (curKey === prevKey) {
        console.warn('[ClosedLoop] no_progress');
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'no_progress', attempts,
        );
      }
      if (seen.has(curKey)) {
        console.warn('[ClosedLoop] oscillation');
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'oscillation', attempts,
        );
      }

      seen.add(curKey);
      prevKey = curKey;

      // Keep the most-compilable candidate by severity weight (compile-fatal
      // errors outrank compile-but-degraded ones), so degrade never ships a
      // worse-but-fewer-errors state.
      const curScore = severityScore(verifyResult.errors);
      if (curScore < bestScore) {
        bestAppState = appState;
        bestCode = code;
        bestErrors = verifyResult.errors;
        bestScore = curScore;
      }
    }

    return this.doDegradeFull(
      bestAppState, bestCode, bestErrors, prepResult, currentState, 'budget_exhausted', attempts,
    );
  }

  // ── Phase 5: PLAN → DESIGN → per-segment GENERATE → COMPOSE ──────────────

  private async runPhase5(
    prompt: string,
    currentState: AppState | undefined,
    prepResult: PrepareResult,
    t0: number,
  ): Promise<LoopResult> {
    // Reset spine to phase5 layout
    this.emit({ type: 'run', phase: 'start', pipeline: 'phase5' });

    const { clarified, registrySnapshot: snap, registryVersion, requestId } = prepResult;
    const ctx: GenerateCtx = { ...prepResult, originalPrompt: prompt };

    // PLAN
    this.stageActive('plan', undefined, this.L.planActive);
    const tPlan = Date.now();
    let plan: SegmentPlan;
    try {
      plan = await this.plannerAgent.plan(clarified.enrichedPrompt);
      console.log(`[Phase5] plan: ${plan.segments.length} segments, nav=${plan.navigationStyle}`);
      this.stageDone('plan', Date.now() - tPlan, this.L.planDone(plan.segments.length));
    } catch (e) {
      console.warn('[Phase5] plan failed, falling back to non-Phase5 run');
      return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
    }

    // DESIGN (shared theme)
    this.stageActive('design', 'design', this.L.designActive);
    const tDesign = Date.now();
    let design: { theme: import('../../models/appstate.js').Theme };
    try {
      design = await this.designAgent.generate(clarified.designDirection || clarified.enrichedPrompt);
      this.stageDone('design', Date.now() - tDesign, this.L.designDone, 'design');
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
    }

    // Per-segment GENERATE
    const segmentScreens: import('../../models/appstate.js').Screen[] = [];
    for (const spec of plan.segments) {
      const segId = `segment:${spec.screenId}` as const;
      this.stageActive(segId, segId, this.L.segmentActive(spec.screenName));
      const tSeg = Date.now();
      let screen: import('../../models/appstate.js').Screen;
      try {
        screen = await this.structureAgent.generateSegment(spec, plan, clarified.enrichedPrompt);
        console.log(`[Phase5] segment '${spec.screenId}' generated`);
        this.stageDone(segId, Date.now() - tSeg, this.L.segmentDone(spec.screenName), segId);
      } catch (e) {
        return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
      }
      segmentScreens.push(screen);
    }

    // COMPOSE
    this.stageActive('compose', undefined, this.L.composeActive);
    const tCompose = Date.now();
    let appState: AppState;
    try {
      const composed = composePlan(segmentScreens, plan, design.theme);
      appState = AppStateSchema.parse(composed);
      this.stageDone('compose', Date.now() - tCompose, this.L.composeDone(segmentScreens.length));
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
    }

    // CODEGEN
    this.stageActive('codegen', undefined, this.L.codegenActive);
    const tCodegen = Date.now();
    let code = this.codeGenerator.generate(appState, snap);
    this.stageDone('codegen', Date.now() - tCodegen, this.L.codegenDone(appState.screens.length));

    // VERIFY → REPAIR (same loop as normal run)
    const attempts: AttemptRecord[] = [];

    this.stageActive('verify', undefined, this.L.verifyActive);
    const tVerify0 = Date.now();
    let verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, 0);
    const verifyDuration0 = Date.now() - tVerify0;
    attempts.push(makeAttemptRecord(0, 'initial', verifyResult, undefined, verifyDuration0));
    this.emitVerify(verifyResult, 0, verifyDuration0);

    if (verifyResult.ok) {
      console.log('[Phase5] initial verify ok');
      return this.runCritic(appState, code, ctx, attempts, verifyResult.warnings, t0, 0);
    }

    console.log(`[Phase5] initial verify errors=[${verifyResult.errors.map(e => e.code).join(',')}]`);

    const seen = new Set<string>([msKey(verifyResult.errors)]);
    let prevKey = msKey(verifyResult.errors);
    let bestAppState = appState;
    let bestCode = code;
    let bestErrors = verifyResult.errors;
    let bestScore = severityScore(verifyResult.errors);

    const entryScreen = segmentScreens[0];
    const degradeToEntry = (): LoopResult => {
      if (!entryScreen) return this.doDegradeFull(bestAppState, bestCode, bestErrors, prepResult, currentState, 'phase5_compose_failed', attempts);
      try {
        const entryState = AppStateSchema.parse({
          appName: plan.appName,
          theme: design.theme,
          screens: [entryScreen],
          navigation: { type: 'stack', initialRoute: '/' },
        });
        const entryCode = this.codeGenerator.generate(entryState, snap);
        return {
          appState: entryState, code: entryCode,
          outcome: 'degrade',
          finalState: 'DEGRADED',
          verified: false,
          degraded: true,
          degradeReason: 'phase5_compose_failed',
          warnings: [D0_WARNING, ...bestErrors],
          attempts,
        };
      } catch {
        return this.doDegradeFull(bestAppState, bestCode, bestErrors, prepResult, currentState, 'phase5_compose_failed', attempts);
      }
    };

    for (let repairAttempt = 1; repairAttempt <= MAX_REPAIRS; repairAttempt++) {
      if (Date.now() - t0 + PER_REPAIR_BUDGET_MS > WALL_CLOCK_MS) {
        console.warn('[Phase5] wall_clock — not enough budget for another repair');
        return degradeToEntry();
      }

      const issuesBefore = verifyResult.errors.length;
      this.stageActive('repair', undefined, this.L.repairActive(repairAttempt, MAX_REPAIRS));
      const tRepair = Date.now();

      const repairResult = await this.repairAgent.repair(
        {
          appState,
          errors: verifyResult.errors.filter(e => e.severity === 'error').slice(0, 8),
          originalPrompt: ctx.clarified.enrichedPrompt,
          attempt: repairAttempt,
        },
        snap,
      );

      const repairMeta = (repairResult as any)._meta as
        { patchesApplied: number; patchesDropped: number } | undefined;

      if (repairResult.unrepairable) {
        console.warn('[Phase5] unrepairable');
        const last = attempts[attempts.length - 1];
        last.repair = { unrepairable: true, repairNotes: repairResult.repairNotes, patchesApplied: 0, patchesDropped: 0 };
        const repairDuration = Date.now() - tRepair;
        this.emitRepair(repairAttempt, true, 0, 0, issuesBefore, issuesBefore, repairDuration);
        return degradeToEntry();
      }

      appState = repairResult.appState;
      code = this.codeGenerator.generate(appState, snap);

      this.stageActive('verify', undefined, this.L.verifyReActive);
      const tReVerify = Date.now();
      verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, repairAttempt);
      const reVerifyDuration = Date.now() - tReVerify;
      const repairDuration = Date.now() - tRepair;

      this.emitRepair(
        repairAttempt, false,
        repairMeta?.patchesApplied ?? 0, repairMeta?.patchesDropped ?? 0,
        issuesBefore, verifyResult.errors.length, repairDuration,
      );

      attempts.push(makeAttemptRecord(repairAttempt, 'repair', verifyResult, {
        unrepairable: false,
        repairNotes: repairResult.repairNotes,
        patchesApplied: repairMeta?.patchesApplied ?? 0,
        patchesDropped: repairMeta?.patchesDropped ?? 0,
      }, repairDuration));

      this.emitVerify(verifyResult, repairAttempt, reVerifyDuration);

      if (verifyResult.ok) {
        console.log(`[Phase5] repair ${repairAttempt} ok`);
        return this.runCritic(appState, code, ctx, attempts, verifyResult.warnings, t0, 0);
      }

      const curKey = msKey(verifyResult.errors);
      if (curKey === prevKey || seen.has(curKey)) {
        console.warn(`[Phase5] ${curKey === prevKey ? 'no_progress' : 'oscillation'}`);
        return degradeToEntry();
      }
      seen.add(curKey);
      prevKey = curKey;

      // Keep the most-compilable candidate by severity weight (compile-fatal
      // errors outrank compile-but-degraded ones), so degrade never ships a
      // worse-but-fewer-errors state.
      const curScore = severityScore(verifyResult.errors);
      if (curScore < bestScore) {
        bestAppState = appState;
        bestCode = code;
        bestErrors = verifyResult.errors;
        bestScore = curScore;
      }
    }

    return degradeToEntry();
  }

  // ── Critic path ───────────────────────────────────────────────────────────

  private async runCritic(
    appState: AppState,
    code: string,
    ctx: GenerateCtx,
    attempts: AttemptRecord[],
    warnings: ValidationError[],
    t0: number,
    criticAttempt: number,
  ): Promise<LoopResult> {
    if (ctx.intent === 'modifyDesign') {
      return this.succeed(appState, code, warnings, attempts);
    }

    this.stageActive('critic', undefined, this.L.criticActive);
    const criticT0 = Date.now();
    let verdict: CriticVerdict;
    try {
      verdict = await this.criticAgent.critique({
        originalPrompt: ctx.originalPrompt,
        enrichedPrompt: ctx.clarified.enrichedPrompt,
        intent: ctx.intent,
        factSheet: makeFactSheet(appState),
        codeSample: code,
        attempt: criticAttempt,
      });
    } catch (e) {
      console.warn('[ClosedLoop] critic threw, treating as pass:', e);
      this.stageDone('critic', Date.now() - criticT0, this.L.criticSkip);
      return this.succeed(appState, code, warnings, attempts);
    }

    const criticDurationMs = Date.now() - criticT0;
    console.log(`[ClosedLoop] critic: score=${verdict.fidelityScore} rec=${verdict.recommendation}`);

    // Emit CriticEvent
    this.emit({
      type: 'critic',
      fidelity: verdict.fidelityScore,
      recommendation: verdict.recommendation,
      reloop: verdict.recommendation === 'reloop',
      summary: verdict.summary ?? '',
      scope: this.L.criticScope,
      t: this.t(),
      durationMs: criticDurationMs,
    });

    const criticStatus = verdict.recommendation === 'pass' ? 'done'
      : verdict.recommendation === 'warn' ? 'warning' : 'error';
    this.emit({ type: 'stage', stageId: 'critic', status: criticStatus, t: this.t(), durationMs: criticDurationMs });

    // Record critic info on last attempt
    if (attempts.length > 0) {
      attempts[attempts.length - 1].critic = {
        called: true,
        fromCache: false,
        fidelityScore: verdict.fidelityScore,
        recommendation: verdict.recommendation,
        reloop: verdict.recommendation === 'reloop',
        durationMs: criticDurationMs,
        costUsd: 0,
      };
    }

    if (verdict.recommendation === 'reloop' && criticAttempt < MAX_CRITIC_RELOOPS) {
      if (Date.now() - t0 + PER_REPAIR_BUDGET_MS > WALL_CLOCK_MS) {
        console.warn('[ClosedLoop] wall_clock — skipping critic reloop');
        return this.succeed(appState, code, warnings, attempts);
      }

      let reloopAppState: AppState;
      try {
        reloopAppState = await this.generateForIntent(ctx, verdict.reloopFeedback);
      } catch (e) {
        console.warn('[ClosedLoop] reloop generate threw, keeping current');
        return this.succeed(appState, code, warnings, attempts);
      }

      const reloopCode = this.codeGenerator.generate(reloopAppState, ctx.registrySnapshot);
      const reResult = await this.runVerify(
        reloopAppState, reloopCode, ctx.registrySnapshot, ctx.registryVersion, ctx.requestId,
        attempts.length,
      );
      attempts.push(makeAttemptRecord(attempts.length, 'repair', reResult, undefined, criticDurationMs));

      if (reResult.ok) {
        return this.runCritic(
          reloopAppState, reloopCode, ctx, attempts, reResult.warnings, t0, criticAttempt + 1,
        );
      }
      console.warn('[ClosedLoop] reloop failed verify — keeping original');
      return this.succeed(appState, code, warnings, attempts);
    }

    const finalState = verdict.recommendation === 'warn' ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS';
    const allWarnings = [...warnings];
    if (verdict.recommendation === 'warn') {
      allWarnings.push({
        code: 'W-critic',
        severity: 'warning',
        message: verdict.summary,
        source: 'orchestrator',
      });
    }

    return {
      appState, code,
      outcome: 'success',
      finalState,
      verified: true,
      degraded: false,
      warnings: allWarnings,
      fidelity: verdict.fidelityScore,
      attempts,
    };
  }

  // ── Verify helper ─────────────────────────────────────────────────────────

  private runVerify(
    appState: AppState,
    code: string,
    snap: RegistrySnapshot,
    registryVersion: string,
    requestId: string,
    attempt: number,
  ): Promise<AnalyzeResult> {
    return this.verifier.verify(appState, code, {
      registryVersion,
      registrySnapshot: snap,
      source: 'live',
      requestId,
      attempt,
    });
  }

  // ── Degrade helpers ───────────────────────────────────────────────────────

  private doDegradeFull(
    bestAppState: AppState,
    bestCode: string,
    bestErrors: ValidationError[],
    prepResult: PrepareResult,
    currentState: AppState | undefined,
    reason: string,
    attempts: AttemptRecord[],
  ): LoopResult {
    if (currentState) {
      return this.degradePrior(currentState, prepResult, reason, attempts);
    }
    return this.degrade(bestAppState, bestCode, bestErrors, reason, attempts);
  }

  private succeed(appState: AppState, code: string, warnings: ValidationError[], attempts: AttemptRecord[]): LoopResult {
    return {
      appState, code,
      outcome: 'success',
      finalState: 'SUCCESS',
      verified: true,
      degraded: false,
      warnings,
      attempts,
    };
  }

  private degradePrior(
    priorState: AppState,
    prepResult: PrepareResult | undefined,
    reason: string,
    attempts: AttemptRecord[],
  ): LoopResult {
    const snap = prepResult?.registrySnapshot ?? widgetRegistry.cloneDefinitions();
    const code = this.codeGenerator.generate(priorState, snap);
    return {
      appState: priorState, code,
      outcome: 'degrade-prior',
      finalState: 'DEGRADED',
      verified: false,
      degraded: true,
      degradeReason: reason,
      warnings: [D0_WARNING],
      attempts,
    };
  }

  private degrade(
    appState: AppState,
    code: string,
    errors: ValidationError[],
    reason: string,
    attempts: AttemptRecord[],
  ): LoopResult {
    return {
      appState, code,
      outcome: 'degrade',
      finalState: 'DEGRADED',
      verified: false,
      degraded: true,
      degradeReason: reason,
      warnings: [D0_WARNING, ...errors],
      attempts,
    };
  }
}

// ── Module helpers ────────────────────────────────────────────────────────────

const D0_WARNING: ValidationError = {
  code: 'D0',
  severity: 'warning',
  message: 'This response was degraded; the displayed app may not reflect your latest request.',
  source: 'orchestrator',
};

function handleGenerationThrow(
  err: unknown,
  currentState: AppState | undefined,
  codeGenerator: CodeGenerator,
  prepResult?: PrepareResult,
): LoopResult {
  const degradable = currentState != null;
  if (degradable) {
    const reason = err instanceof StructureEmptyError ? 'structure_empty' : 'degrade-prior';
    const snap = prepResult?.registrySnapshot ?? widgetRegistry.cloneDefinitions();
    return {
      appState: currentState,
      code: codeGenerator.generate(currentState, snap),
      outcome: 'degrade-prior',
      finalState: 'DEGRADED',
      verified: false,
      degraded: true,
      degradeReason: reason,
      warnings: [D0_WARNING],
      attempts: [],
    };
  }
  throw err;
}

function makeFactSheet(appState: AppState): string {
  if (!appState.screens?.length) return 'No screens generated.';

  // Aggregate state and actions across ALL screens (not just screens[0]) so the
  // critic doesn't see features on detail/settings screens as "missing".
  const vars = appState.screens.flatMap(s => s.screenState?.variables ?? []);
  const actions = appState.screens.flatMap(s => collectScreenActions(s));
  const actionTypes = [...new Set(actions.map((a: any) => a.type))];

  // Per-action binding facts so the critic can detect mis-wiring (e.g. Add
  // pointed at the wrong list) rather than just feature presence.
  const bindingFacts = actions
    .filter((a: any) => !['none', 'navigate', 'pop'].includes(a.type))
    .map((a: any) => {
      if (a.type === 'addItem') return `addItem→list '${a.listName}'`;
      if (a.type === 'removeItem' || a.type === 'toggleItemField') return `${a.type}→list '${a.listName}'${a.fieldName ? `.${a.fieldName}` : ''}`;
      if (a.type === 'increment' || a.type === 'decrement') return `${a.type}→'${a.fieldName}'`;
      if (a.type === 'setValue') return `setValue→'${a.fieldName}'`;
      if (a.type === 'clearField') return `clearField→'${(a.clearFields ?? [a.fieldName]).filter(Boolean).join("','")}'`;
      return a.type;
    });

  const widgetTypes = new Set<string>();
  function walkWidgets(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') widgetTypes.add(node.type);
    if (Array.isArray(node.children)) node.children.forEach(walkWidgets);
    if (node.props && typeof node.props === 'object') {
      Object.values(node.props).forEach(v => {
        if (v && typeof v === 'object' && 'type' in (v as any)) walkWidgets(v);
      });
    }
  }
  appState.screens.forEach(s => walkWidgets(s.body));

  return [
    `App name: ${appState.appName}`,
    `Screens: ${appState.screens.length} (names: ${appState.screens.map(s => s.name).join(', ')})`,
    `State variables: ${vars.length > 0 ? vars.map((v: any) => `${v.name}:${v.type}`).join(', ') : 'none'}`,
    `Action types: ${actionTypes.length > 0 ? actionTypes.join(', ') : 'none'}`,
    `Action bindings: ${bindingFacts.length > 0 ? bindingFacts.join('; ') : 'none'}`,
    `Widget types: ${[...widgetTypes].join(', ')}`,
    `Navigation: ${appState.navigation.type}`,
  ].join('\n');
}

function makeAttemptRecord(
  attempt: number,
  source: 'initial' | 'repair',
  result: AnalyzeResult,
  repair?: AttemptRecord['repair'],
  durationMs?: number,
): AttemptRecord {
  const errorMultiset: Record<string, number> = {};
  for (const e of result.errors) {
    if (e.severity !== 'error') continue;
    const id = `${e.code}@${e.location?.nodePath ?? ''}`;
    errorMultiset[id] = (errorMultiset[id] ?? 0) + 1;
  }
  return {
    attempt,
    source,
    verify: {
      ok: result.ok,
      source: result.source,
      fromCache: result.fromCache,
      errorCodes: result.errors.map(e => e.code),
      durationMs: result.durationMs,
    },
    errorMultiset,
    repair,
    durationMs: durationMs ?? result.durationMs,
    agents: [],
  };
}
