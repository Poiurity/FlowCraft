# FlowCraft UI/UX Overhaul — Implementation Plan

> **Decisions locked (2026-06-11):** real-time delivered **phased (replay → SSE)**; scope is a **full IA + visual overhaul**; this document is the **detailed implementation plan to review before code**.

The thesis: competitors hide their agentic internals because their loops are non-deterministic. FlowCraft's pipeline is **fixed, named, and capped**, so we make it the visible centerpiece — it reads as rigor, not chaos. The hero surface is the **Pipeline Spine**.

---

## 0. Keystone decision — a transport-agnostic event model

The single most important architectural choice: **both Phase 1 (replay from `attempts[]`) and Phase 2 (live SSE) emit the *same* `PipelineEvent` stream.** The UI reducer consumes that stream and never knows or cares whether events came from a post-hoc replay or a live socket. This makes Phase 2 a backend+transport addition, not a UI rewrite.

```
Phase 1:  GenerateResponse.attempts[]  ──► replayEngine() ──┐
                                                            ├─► PipelineEvent[] ─► pipelineReducer ─► <PipelineSpine/>
Phase 2:  SSE /api/generate/stream ─────────────────────────┘
```

### 0.1 The event schema (`frontend/src/services/pipeline-events.ts`)

```ts
export type StageId =
  | 'clarify' | 'extend'
  | 'structure' | 'design'          // parallel lanes (standard create)
  | 'plan' | 'compose'              // Phase 5 only
  | `segment:${string}`             // Phase 5 per-segment lanes
  | 'merge' | 'codegen'
  | 'verify' | 'repair' | 'critic';

export type StageStatus = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';
export type Lane = 'structure' | 'design' | `segment:${string}`;

export interface ToolCallRow { label: string; value?: string; }   // Level-1 disclosure rows

export interface StageEvent {
  type: 'stage';
  stageId: StageId;
  lane?: Lane;                  // present ⇒ render inside a parallel lane
  status: StageStatus;
  activeLabel?: string;        // present-continuous: "Generating home.dart…"
  doneLabel?: string;          // outcome: "8 screens · nav graph"
  attempt?: number;            // repair iteration (1-based)
  maxAttempts?: number;        // = MAX_REPAIRS (2)
  rows?: ToolCallRow[];        // Level-1 tool-call / reasoning rows
  t: number;                   // ms since run start (timeline position)
  durationMs?: number;
  estimated?: boolean;         // TRUE in replay for synthesized timings (honesty flag)
}

export interface VerifyEvent {
  type: 'verify';
  ok: boolean;
  attempt: number;
  issues: { code: string; severity: 'error' | 'warning'; nodePath?: string; message: string }[];
  t: number; durationMs?: number; estimated?: boolean;
}

export interface RepairEvent {
  type: 'repair';
  attempt: number; maxAttempts: number;
  unrepairable: boolean;
  patchesApplied: number; patchesDropped: number;
  issuesBefore: number; issuesAfter: number;   // drives the 3→1→0 counter
  t: number; durationMs?: number; estimated?: boolean;
}

export interface CriticEvent {
  type: 'critic';
  fidelity: number;                              // 0–100
  recommendation: 'pass' | 'warn' | 'reloop';
  reloop: boolean;
  summary: string;
  scope: string;                                 // "layout & theme; not runtime behavior"
  t: number; durationMs?: number; estimated?: boolean;
}

export interface RunEvent {
  type: 'run';
  phase: 'start' | 'done';
  pipeline?: 'standard' | 'phase5';              // which spine layout to render
  finalState?: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'DEGRADED';
  degraded?: boolean; degradeReason?: string; fidelity?: number;
  totalMs?: number;
}

export type PipelineEvent = RunEvent | StageEvent | VerifyEvent | RepairEvent | CriticEvent;
```

### 0.2 Orchestrator stages → events (the canonical mapping)

Derived from `closed-loop-orchestrator.ts`. Standard `create` path:

| Orchestrator seam | Emits |
|---|---|
| `run()` start | `RunEvent{phase:'start', pipeline:'standard'}` |
| `prepare()` → clarifier.clarify | `clarify` active → done (`doneLabel`: "N requirements · intent") |
| `prepare()` → widgetExtender.ensureWidgets | `extend` (skipped if 0 staged) |
| `generateForIntent()` `Promise.all([structure, design])` | `structure` + `design` **both active in parallel lanes**, each → done |
| `AppStateSchema.parse(...)` | `merge` active → done |
| `codeGenerator.generate()` | `codegen` active (`activeLabel` streams file/screen progress) → done |
| `runVerify()` attempt 0 | `VerifyEvent{attempt:0, ...}` |
| repair loop iter `k` | `RepairEvent{attempt:k}` then `VerifyEvent{attempt:k}` |
| `runCritic()` | `CriticEvent` |
| `run()` return | `RunEvent{phase:'done', finalState, degraded, fidelity, totalMs}` |

Phase 5 path (`runPhase5()`, gated by `FLOWCRAFT_PHASE5` + `remoteAnalyzer.isAvailable()`): `RunEvent{pipeline:'phase5'}`, then `plan` → per-segment `segment:<id>` lanes (Structure per segment) → `compose` → `codegen` → verify/repair/critic as above.

### 0.3 The replay engine (Phase 1 — `frontend/src/services/replay-engine.ts`)

```ts
export function buildReplay(res: GenerateResponse): PipelineEvent[]
```

Synthesizes an ordered event list from the existing response:
- **Real data we have:** `attempts[].source`, `.ok`, `.errorCodes`, `.durationMs`, `.critic{fidelityScore,recommendation,reloop}`, `.repair{unrepairable,patchesApplied,patchesDropped}`, and top-level `degraded/degradeReason/fidelity/finalState`.
- **Synthesized (mark `estimated:true`):** per-agent timings for clarify/structure/design/merge/codegen — we only have verify + per-attempt durations, so pre-verify splits are *estimates*. Phase 2 SSE replaces these with real timings. **We surface `estimated` honestly** (a subtle "~" or dimmed timing) rather than faking precision.
- **Player:** `usePipelinePlayer(events, {speed})` ticks events onto the reducer scaled to a snappy budget (~3–5 s wall-clock total, compressing real durations), with a **Skip** control. **Cache hits / instant results do NOT get a fake delay** — if `attempts` shows a single cached pass, we render the done state near-instantly (respects determinism; no theatre).

---

## 1. Frontend architecture

### 1.1 Component tree

```
App
├─ Header
│   └─ PipelineRail            ← slim 7-segment glanceable status (always visible)
├─ ChatPanel                   (control surface; ~360–400px)
│   ├─ MessageList
│   │   └─ DoneSummaryCard     ← replaces ChangelogMessage; fidelity · time · repairs · files
│   ├─ LoopStatusChip          ← demoted LoopStatusBadge (compact chat summary only)
│   └─ Composer                ← textarea (+ Enhance-prompt button in Phase 3)
└─ Workspace
    ├─ WorkspaceTabs           [ Activity | Preview | Code | State ]
    ├─ ActivityTab
    │   └─ PipelineSpine        ← HERO
    │       ├─ StageNode ×N     (glyph · activeLabel/doneLabel · expand)
    │       ├─ ForkJoinLanes    (Structure ∥ Design, animated edges → Merge)
    │       ├─ RepairLoop       (attempt chip · issues 3→1→0 · pulse back-arrow)
    │       ├─ CriticCard       (fidelity score · calibration · scope)
    │       └─ StageCard        (Level-1 expansion: ToolCallRow[], diff)
    ├─ PreviewTab → DeviceFrame → DartPadEmbed   (regenerating/last-good overlay)
    ├─ CodeTab    → CodeView    (react-syntax-highlighter + attempt diff)
    └─ StateTab   → AppStateViewer               (existing)
```

### 1.2 State management

The app is currently light (plain `useState` in `App.tsx`, no store lib). Introduce one **`pipelineReducer` + `PipelineContext`** — no new dependency.

```ts
interface StageView {
  id: StageId; status: StageStatus;
  label: string; estimated?: boolean;
  rows: ToolCallRow[]; durationMs?: number; expanded: boolean;
}
interface PipelineState {
  status: 'idle' | 'running' | 'done';
  pipeline: 'standard' | 'phase5';
  order: StageId[];                       // spine order for current pipeline
  stages: Record<string, StageView>;
  lanes: { structure?: StageView; design?: StageView } | Record<string, StageView>;
  verifies: VerifyEvent[];
  repairs: RepairEvent[];
  critic: CriticEvent | null;
  final: Pick<RunEvent,'finalState'|'degraded'|'degradeReason'|'fidelity'|'totalMs'> | null;
}
type PipelineAction = { kind: 'event'; event: PipelineEvent } | { kind: 'reset' };
```

`dispatch({kind:'event', event})` is called identically by the replay player and (Phase 2) the SSE `onmessage` handler.

### 1.3 New / changed types in `api.ts`

Keep `GenerateResponse` as the fallback contract. Add the SSE client (Phase 2) and re-export `PipelineEvent`. `generateFromPrompt()` stays; add `generateStream(prompt, sessionId, onEvent)` in Phase 2.

---

## 2. Component specifications

### 2.1 `PipelineSpine.tsx`
Vertical stepper rendered from `PipelineState.order`. Every stage visible from t=0 in `pending`. Only the `active` stage auto-expands and auto-scrolls. Two-level disclosure, hard stop (Level 0 = summary line; Level 1 = `StageCard` rows; no deeper). Swaps layout on `pipeline:'phase5'`.

### 2.2 `StageNode.tsx`
- Glyph map: `pending ⏳/gray` · `active 🔵 pulsing+glow` · `done ✓ green` · `warning ⚠ amber` · `error ✕ red` · `skipped ⊘ dim`.
- Active shows `activeLabel` (present-continuous) + optional streaming sub-line; done shows `doneLabel`.
- Click → toggles `StageCard`.

### 2.3 `ForkJoinLanes.tsx` (the differentiator)
Structure ∥ Design as two side-by-side mini-columns that **fork** after the predecessor and **rejoin at Merge**, each streaming its own rows. **Animated connector edges** flow from both lanes into Merge; Merge stays `pending` and visibly waits until **both** lanes are `done`. Phase 5: N segment lanes instead of 2.

### 2.4 `RepairLoop.tsx`
Calm `Repair · Attempt k/2` chip; corrective microcopy ("Found 3 issues → applying patches → re-running Verify"); live **issues-remaining `3 → 1 → 0`** counter from `issuesBefore/issuesAfter`; back-arrow between Verify↔Repair pulses per iteration. The visible cap is a trust feature (contrast v0's "infinite fix loop"). Degrade → graceful banner using `degradeReason`, not a dead end.

### 2.5 `CriticCard.tsx`
`Fidelity 92% — strong match` (word calibration beside the number), plus `scope` note. Color: green ≥85 / amber 65–84 / red <65 (reuse current `LoopStatusBadge` thresholds). Maps to `fidelity`, `finalState`, `recommendation`.

### 2.6 `CodeView.tsx`
Activate the **already-installed-but-unused** `react-syntax-highlighter`. Dart highlighting, dark theme matching tokens. Phase 3: attempt-to-attempt diff (Repair output vs CodeGen output) red/green.

### 2.7 `DeviceFrame.tsx` + `DartPadEmbed.tsx`
Wrap DartPad in a phone frame with a responsive toggle. **Hold last-good preview** during Repair (v0 "LLM Suspense"); show a regenerating overlay; never flash a broken build.

### 2.8 `PipelineRail.tsx` (header)
7 segments reflecting `order` status; click → focus Activity tab. Claude-Code-style always-glanceable status line.

### 2.9 `DoneSummaryCard.tsx`
Replaces `ChangelogMessage` as the closing artifact: header ("App generated · Fidelity 92% · 2m14s · 1 repair pass"), files/screens changed, "what was fixed" recap, Critic verdict + flagged gaps (graceful partial completion), Undo/Regenerate.

---

## 3. Layout / IA changes (`App.tsx`)

- Replace 2-tab right panel with **4-tab Workspace** (Activity/Preview/Code/State).
- Add header **PipelineRail**.
- Auto-focus: **Activity during generation**, **Preview on done**; drop `DoneSummaryCard` into chat.
- Wrap tree in `PipelineProvider`; `handleSend` builds replay events and runs the player (Phase 1) / opens SSE (Phase 2).
- Chat narrows to control-surface role.

---

## 4. Visual language & motion (`index.css`)

Keep dark-first + primary `#3789FC` + surface ramp. Add tokens + keyframes:
- Stage-state tokens: `--stage-pending/active/done/warning/error`.
- `--glow-active` accent on the running stage.
- Keyframes: `edge-flow` (animated connectors), `pulse-travel` (signature spine pulse), `shimmer` (skeletons), reuse `pulse-dot`.
- No naked spinners: every running stage shows name + counter; determinate bar **only** for CodeGen ("3 of 8 screens"); never freeze at 99%; spinner only for sub-300ms waits, delayed 200ms.

---

## 5. Phase 2 — real SSE (after Phase 1 ships)

### 5.1 Backend
- New route `GET /api/generate/stream` (SSE; `text/event-stream`), or reuse POST with a streamed body.
- `ClosedLoopOrchestrator` gains an optional injected `onEvent?: (e: PipelineEvent) => void`, called at each seam in §0.2 (real timings, no `estimated`). No change to the loop's control flow — purely additive instrumentation.
- CodeGen streams file/screen progress as `codegen` `activeLabel` updates.
- Keep single-shot `POST /api/generate` as fallback for non-SSE clients.

### 5.2 Frontend
- `generateStream()` opens `EventSource`, dispatches each parsed `PipelineEvent` into the **same reducer**. Replay engine becomes the offline/fallback path. Zero spine-component changes.

---

## 6. File-by-file change list

**New (frontend):**
`services/pipeline-events.ts`, `services/replay-engine.ts`, `hooks/usePipelinePlayer.ts`, `state/pipelineReducer.ts`, `state/PipelineContext.tsx`, `components/PipelineSpine.tsx`, `StageNode.tsx`, `ForkJoinLanes.tsx`, `RepairLoop.tsx`, `CriticCard.tsx`, `StageCard.tsx`, `PipelineRail.tsx`, `DoneSummaryCard.tsx`, `CodeView.tsx`, `DeviceFrame.tsx`, `WorkspaceTabs.tsx`.

**Changed (frontend):**
`App.tsx` (IA, provider, auto-focus), `ChatPanel.tsx` (LoopStatusBadge→chip, ChangelogMessage→DoneSummaryCard), `DartPadEmbed.tsx` (frame + overlay), `services/api.ts` (SSE client, re-exports), `index.css` (tokens + keyframes).

**New/changed (backend, Phase 2 only):**
`routes/api.ts` (+`/generate/stream`), `services/agents/closed-loop-orchestrator.ts` (+`onEvent` instrumentation), small `services/pipeline-events.ts` shared type (or duplicated contract).

---

## 7. Build sequence (full overhaul, Phase 1 first)

1. **Event contract + reducer** (`pipeline-events.ts`, `pipelineReducer.ts`, `PipelineContext.tsx`) — the spine of everything.
2. **Replay engine + player** (drive from existing `attempts[]`; honest `estimated` flags; Skip; no fake delay on cache hits).
3. **IA shell** (`App.tsx` 4-tab Workspace, `PipelineRail`, auto-focus).
4. **Spine components** (StageNode → PipelineSpine → ForkJoinLanes → RepairLoop → CriticCard → StageCard).
5. **Workspace tabs** (CodeView syntax highlighting, DeviceFrame, keep AppStateViewer).
6. **Chat refactor** (LoopStatusChip, DoneSummaryCard).
7. **Visual/motion pass** (tokens, edge-flow, pulse-travel, skeletons).
8. **Phase 2** (SSE backend + `onEvent` + `generateStream`) — swaps the data source under the unchanged reducer.

---

## 8. Risks & open questions

- **Replay honesty:** pre-verify timings are estimated in Phase 1. Mitigation: `estimated` flag + dimmed/`~` rendering; real timings arrive in Phase 2.
- **Determinism/cache:** instant cached results must not be padded with fake animation. Player special-cases single-pass/cache-hit → near-instant done.
- **`attempts[]` only exists in enforce mode** (`VERIFY_MODE=enforce`). In off/shadow mode the replay degrades to a minimal 3-node spine (Generate → (Verify, shadow) → Done). Confirm target VERIFY_MODE for the demo.
- **DartPad iframe** can't support click-to-edit cheaply — deferred to a later milestone.
- **Phase 5 spine** depends on `FLOWCRAFT_PHASE5`; default standard layout otherwise.
- **Open:** Korean/English copy for stage labels (current UI is Korean); confirm tone for `activeLabel` strings.
