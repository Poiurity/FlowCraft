// Phase 3 — Closed-loop orchestrator.
// Three-function seam: prepare() → generateForIntent() → run()
// run() wraps the GENERATE→VERIFY→REPAIR(×MAX_REPAIRS)→CRITIC→SUCCESS/DEGRADE cycle.

import { randomUUID } from 'crypto';
import { AppStateSchema, type AppState } from '../../models/appstate';
import { ClarifierAgent, type ClarifiedRequirement, type Intent } from './clarifier-agent';
import { WidgetExtenderAgent } from './widget-extender-agent';
import { StructureAgent } from './structure-agent';
import { DesignAgent } from './design-agent';
import { RepairAgent } from './repair-agent';
import { CriticAgent } from './critic-agent';
import { StructureEmptyError } from './errors';
import { CodeGenerator } from '../code-generator';
import { StaticValidator } from '../verification/static-validator';
import { RemoteAnalyzer } from '../verification/remote-analyzer';
import { CompositeVerifier } from '../verification/composite-verifier';
import { VerificationCache } from '../verification/verification-cache';
import { loadRemoteConfig } from '../verification/remote-config';
import { widgetRegistry } from '../widget-registry/registry-manager';
import { collectActions } from '../codegen-shared/action-naming';
import type {
  RegistrySnapshot, LoopResult, AttemptRecord, ValidationError, AnalyzeResult,
  CriticVerdict,
} from '../verification/types';

const MAX_REPAIRS = 2;
const MAX_CRITIC_RELOOPS = 1;
const WALL_CLOCK_MS = 30_000;
const PER_REPAIR_BUDGET_MS = 9_000;   // don't start a repair you can't finish (§3.1)

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
  baseState?: AppState;             // currentState alias (§3.0 PrepareResult.baseState)
  registrySnapshot: RegistrySnapshot;
  registryVersion: string;
  requestId: string;
}

interface GenerateCtx extends PrepareResult {
  originalPrompt: string;           // raw user input for API responses
}

// ── Module-level shared instances (one cache per process) ────────────────────

const sharedCache = new VerificationCache(256);

// ── ClosedLoopOrchestrator ───────────────────────────────────────────────────

export class ClosedLoopOrchestrator {
  private clarifier: ClarifierAgent;
  private widgetExtender: WidgetExtenderAgent;
  private structureAgent: StructureAgent;
  private designAgent: DesignAgent;
  private repairAgent: RepairAgent;
  private criticAgent: CriticAgent;
  private codeGenerator: CodeGenerator;
  private verifier: CompositeVerifier;

  constructor(apiKey: string) {
    this.clarifier = new ClarifierAgent(apiKey);
    this.widgetExtender = new WidgetExtenderAgent(apiKey);
    this.structureAgent = new StructureAgent(apiKey);
    this.designAgent = new DesignAgent(apiKey);
    this.repairAgent = new RepairAgent(apiKey);
    this.criticAgent = new CriticAgent(apiKey);
    this.codeGenerator = new CodeGenerator();
    // §1.4 — CompositeVerifier owns the shared cache + Layer B (dormant until DART_SERVICES_URL)
    this.verifier = new CompositeVerifier(
      new StaticValidator(),
      new RemoteAnalyzer(loadRemoteConfig()),
      sharedCache,
    );
  }

  // ── Step 1: CLARIFY + EXTEND (once per request) ────────────────────────────

  async prepare(prompt: string, currentState?: AppState): Promise<PrepareResult> {
    console.log(`[ClosedLoop] prepare: "${prompt.slice(0, 60)}..."`);

    const clarified = await this.clarifier.clarify(prompt, currentState);
    console.log(`[ClosedLoop] intent=${clarified.intent} widgets=[${clarified.requiredWidgets.join(',')}]`);

    // §4.5 — ensureWidgets calls stageDefinition (Map only, no persist)
    const added = await this.widgetExtender.ensureWidgets(clarified.requiredWidgets);
    if (added.length > 0) console.log(`[ClosedLoop] staged widgets: [${added.join(',')}]`);

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

  // ── Step 2: GENERATE (re-runnable, pure w.r.t. registry) ─────────────────

  async generateForIntent(ctx: GenerateCtx, repairFeedback?: string): Promise<AppState> {
    const { clarified, intent, baseState } = ctx;
    const enriched = repairFeedback
      ? `${clarified.enrichedPrompt}\n\n[Feedback: ${repairFeedback}]`
      : clarified.enrichedPrompt;

    let appState: AppState;

    switch (intent) {
      case 'create': {
        const [structure, design] = await Promise.all([
          this.structureAgent.generate(enriched),
          this.designAgent.generate(clarified.designDirection || enriched),
        ]);
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: design.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        break;
      }
      case 'modifyStructure': {
        const structure = await this.structureAgent.modify(enriched, baseState!);
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: baseState!.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        break;
      }
      case 'modifyDesign': {
        const design = await this.designAgent.modify(clarified.designDirection || enriched, baseState!.theme);
        appState = AppStateSchema.parse({
          appName: baseState!.appName,
          theme: design.theme,
          screens: baseState!.screens,
          navigation: baseState!.navigation,
        });
        break;
      }
      case 'modifyBoth': {
        const [structure, design] = await Promise.all([
          this.structureAgent.modify(enriched, baseState!),
          this.designAgent.modify(clarified.designDirection || enriched, baseState!.theme),
        ]);
        appState = AppStateSchema.parse({
          appName: structure.appName,
          theme: design.theme,
          screens: structure.screens,
          navigation: structure.navigation,
        });
        break;
      }
    }

    return appState;
  }

  // ── Step 3: CLOSED LOOP ───────────────────────────────────────────────────

  async run(prompt: string, currentState?: AppState): Promise<LoopResult> {
    const t0 = Date.now();
    const attempts: AttemptRecord[] = [];

    // ── prepare (CLARIFY + EXTEND) ──
    let prepResult: PrepareResult;
    try {
      prepResult = await this.prepare(prompt, currentState);
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator);
    }

    const ctx: GenerateCtx = { ...prepResult, originalPrompt: prompt };
    const { registrySnapshot: snap, registryVersion, requestId } = prepResult;

    // ── attempt 0: GENERATE ──
    let appState: AppState;
    try {
      appState = await this.generateForIntent(ctx);
    } catch (e) {
      return handleGenerationThrow(e, currentState, this.codeGenerator, prepResult);
    }

    let code = this.codeGenerator.generate(appState, snap);

    // ── attempt 0: VERIFY ──
    const stepT0 = Date.now();
    let verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, 0);
    attempts.push(makeAttemptRecord(0, 'initial', verifyResult, undefined, Date.now() - stepT0));

    if (verifyResult.ok) {
      console.log('[ClosedLoop] attempt 0 ok');
      return this.runCritic(appState, code, ctx, attempts, verifyResult.warnings, t0, 0);
    }

    console.log(`[ClosedLoop] attempt 0 errors=[${verifyResult.errors.map(e => e.code).join(',')}]`);

    // ── Seeded oscillation guard (§6.0.8) ────────────────────────────────────
    const seen = new Set<string>([msKey(verifyResult.errors)]);
    let prevKey = msKey(verifyResult.errors);

    // Track best-so-far (fewest severity-error count; tie → earliest attempt)
    let bestAppState = appState;
    let bestCode = code;
    let bestErrors = verifyResult.errors;

    // ── repair loop ──
    for (let repairAttempt = 1; repairAttempt <= MAX_REPAIRS; repairAttempt++) {
      // Wall-clock guard: don't start a repair you can't finish (§3.1)
      if (Date.now() - t0 + PER_REPAIR_BUDGET_MS > WALL_CLOCK_MS) {
        console.warn('[ClosedLoop] wall_clock — not enough budget for another repair');
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'wall_clock', attempts,
        );
      }

      console.log(`[ClosedLoop] repair ${repairAttempt}/${MAX_REPAIRS}`);
      const repairT0 = Date.now();

      // §2.2 — originalPrompt is enrichedPrompt for the RepairAgent
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
        return this.doDegradeFull(
          bestAppState, bestCode, bestErrors, prepResult, currentState, 'unrepairable', attempts,
        );
      }

      appState = repairResult.appState;
      code = this.codeGenerator.generate(appState, snap);

      const reVerifyT0 = Date.now();
      verifyResult = await this.runVerify(appState, code, snap, registryVersion, requestId, repairAttempt);
      const attemptDurationMs = Date.now() - repairT0;

      const newAttempt = makeAttemptRecord(repairAttempt, 'repair', verifyResult, {
        unrepairable: false,
        repairNotes: repairResult.repairNotes,
        patchesApplied: repairMeta?.patchesApplied ?? 0,
        patchesDropped: repairMeta?.patchesDropped ?? 0,
      }, attemptDurationMs);
      attempts.push(newAttempt);

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

      // Update best-so-far
      if (verifyResult.errors.filter(e => e.severity === 'error').length <
          bestErrors.filter(e => e.severity === 'error').length) {
        bestAppState = appState;
        bestCode = code;
        bestErrors = verifyResult.errors;
      }
    }

    return this.doDegradeFull(
      bestAppState, bestCode, bestErrors, prepResult, currentState, 'budget_exhausted', attempts,
    );
  }

  // ── Critic path (§6) ─────────────────────────────────────────────────────

  private async runCritic(
    appState: AppState,
    code: string,
    ctx: GenerateCtx,
    attempts: AttemptRecord[],
    warnings: ValidationError[],
    t0: number,
    criticAttempt: number,
  ): Promise<LoopResult> {
    // §6.4 — skip for modifyDesign by default
    if (ctx.intent === 'modifyDesign') {
      return this.succeed(appState, code, warnings, attempts);
    }

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
      return this.succeed(appState, code, warnings, attempts);
    }

    const criticDurationMs = Date.now() - criticT0;
    console.log(`[ClosedLoop] critic: score=${verdict.fidelityScore} rec=${verdict.recommendation}`);

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
      // Wall-clock guard before reloop
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
      // Re-verify failed → fall back to original passing code
      console.warn('[ClosedLoop] reloop failed verify — keeping original');
      return this.succeed(appState, code, warnings, attempts);
    }

    // pass or warn
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

// §3.3 — D0 synthetic degrade warning, attached to every degrade result.
const D0_WARNING: ValidationError = {
  code: 'D0',
  severity: 'warning',
  message: 'This response was degraded; the displayed app may not reflect your latest request.',
  source: 'orchestrator',
};

// §4.3 — three-way exception classification for generation throws.
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
  throw err;  // first-ever request failed → 500
}

// §6.4 — deterministic fact sheet (no LLM, pure function of AppState)
function makeFactSheet(appState: AppState): string {
  const screen = appState.screens[0];
  if (!screen) return 'No screens generated.';

  const vars = screen.screenState?.variables ?? [];
  const actions = collectActions(screen.body);
  const actionTypes = [...new Set(actions.map((a: any) => a.type))];

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
    `Widget types: ${[...widgetTypes].join(', ')}`,
    `Navigation: ${appState.navigation.type}`,
  ].join('\n');
}

// ── AttemptRecord factory ─────────────────────────────────────────────────────

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
