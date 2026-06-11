# FlowCraft

**Natural language → working Flutter app, verified and self-healing.**

Describe an app in plain text. FlowCraft turns it into a structured app model, generates Flutter code deterministically, verifies the output against 20 error categories, and automatically repairs errors before they reach the user — up to twice per request. The whole pipeline streams to the UI live, so you can watch each agent reason and act.

---

## How it works

```
User prompt  ──────────────────────────────────► (streamed live to the Activity tab)
    │
    ▼
┌─────────────┐
│  Clarifier  │  Classifies intent (create / modifyStructure / modifyDesign /
└──────┬──────┘  modifyBoth) and enriches the prompt into a spec
       ▼
┌─────────────┐
│   Widget    │  Stages definitions for any non-built-in widgets the spec needs
│  Extender   │
└──────┬──────┘
       ▼
┌─────────────┐     ┌─────────────┐
│  Structure  │  ∥  │   Design    │  Run in parallel (create / modifyBoth):
│   Agent     │     │   Agent     │  screens · state · actions  /  theme · colors
└──────┬──────┘     └──────┬──────┘
       └─────────┬──────────┘
                 ▼
         ┌──────────────┐
         │   AppState   │  Single typed JSON model — no Dart yet
         └──────┬───────┘
                ▼
         ┌──────────────┐
         │ CodeGenerator│  Deterministic generator → main.dart
         └──────┬───────┘
                ▼
         ┌──────────────┐
         │    Verify    │  StaticValidator (Layer A, C1–C20)
         └──────┬───────┘   + optional RemoteAnalyzer (Layer B, real dart analyze)
          ok?  / \  errors?
              /   \
    ┌────────┐     ┌──────────────┐
    │ Critic │     │ RepairAgent  │  Patches AppState, re-verifies (max 2 attempts)
    └───┬────┘     └──────┬───────┘
        │             ok? / \ still errors?
        ▼                /   \
     SUCCESS       (loop)   DEGRADE  ← ships the most-compilable candidate
```

For multi-screen apps there is a gated **PlannerAgent** path (Phase 5) that decomposes the
request into segments and composes them; it stays behind a flag because it needs the remote
analyzer as a backstop.

**Two core design principles:**

1. **AI agents never write Flutter code directly.** They only produce `AppState` — a typed JSON model describing screens, widgets, navigation, state, and actions. The `CodeGenerator` turns AppState into `main.dart` deterministically, so the output is predictable and verifiable. Raw-code generation drifts and breaks across calls; a shared structured state keeps every agent's output validatable and composable.

2. **Every generated app is verified before delivery.** The closed-loop pipeline catches errors that would not compile or would misbehave (undeclared/mis-typed bindings, illegal widget nesting, dangling navigation, reserved identifiers, …) and attempts automatic repair. A `CriticAgent` then scores intent fidelity and can trigger one regeneration if core features are missing. Output isn't just plausible — it's guaranteed to compile.

---

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenAI API key

### Backend

```bash
cd backend
cp .env.example .env       # add OPENAI_API_KEY; set VERIFY_MODE=enforce for the closed loop
npm install
npm run dev                # http://localhost:3001
```

> The live streaming endpoint (`POST /api/generate/stream`) always runs the full closed-loop
> verify→repair pipeline. The non-streaming `POST /api/generate` runs it when `VERIFY_MODE=enforce`.

### Frontend

```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

Open `http://localhost:5173`, type a prompt like *"a todo list app with a dark theme"*, and hit send.
The UI is bilingual (한국어 / English) via a header toggle, and the **Activity** tab streams each
stage's reasoning and decisions in real time.

---

## API Reference

### `POST /api/generate/stream` (primary, SSE)

Streams `PipelineEvent`s as the pipeline runs, then a final `result` event with the `GenerateResponse`.

```json
{ "prompt": "a shopping list app", "sessionId": "optional", "lang": "ko | en" }
```

Each event narrates a stage (`run` / `stage` / `verify` / `repair` / `critic`), carrying status,
timing, a one-line agent `thinking` summary, and decision `rows`.

### `POST /api/generate`

Non-streaming generate/modify. Same body (`prompt`, `sessionId?`, `lang?`).

**Response (`GenerateResponse`)**
```json
{
  "sessionId": "uuid",
  "appState": { ... },
  "code": "import 'package:flutter/material.dart';\n...",
  "changelog": { "summary": "Todo app created.", "changes": ["Home screen", "  - 2 buttons"], "usageTips": ["Tap the checkbox to toggle complete"] },
  "degraded": false,
  "degradeReason": null,
  "fidelity": 92,
  "finalState": "SUCCESS",
  "attempts": [ { "attempt": 0, "source": "initial", "ok": true, "errorCodes": [], "durationMs": 120 } ]
}
```

`changelog` and the degrade reason are localized to `lang`. When `degraded: true`, `appState`/`code`
may reflect a prior valid state; `degradeReason` is one of `no_progress`, `oscillation`, `wall_clock`,
`budget_exhausted`, `unrepairable`, `structure_empty`, `degrade-prior`, `phase5_compose_failed`.

### Other endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/state/:sessionId` | Retrieve the current AppState for a session |
| `POST /api/state` | Import a hand-edited AppState (`400` schema error · `422` validator errors · `200` valid) |
| `DELETE /api/state/:sessionId` | Clear a session |
| `GET /api/shadow-stats` | Verification histograms (shadow mode) |
| `GET /api/loop-stats` | Closed-loop outcome telemetry (degrade/repair/reloop rates) |

---

## Verification Modes

Set `VERIFY_MODE` in your environment:

| Mode | Behavior |
|------|----------|
| `off` (default) | No verification on `POST /api/generate`. (The SSE endpoint always runs the loop.) |
| `shadow` | Verify after every response (fire-and-forget). Results at `/api/shadow-stats`. Zero latency impact. |
| `enforce` | Full closed-loop on every path. Errors trigger the RepairAgent; failed repairs degrade gracefully. |

Layer B (`RemoteAnalyzer`) activates automatically when `DART_SERVICES_URL` is set, adding a real
`dart analyze` pass on top of Layer A.

---

## Verification Error Codes

`StaticValidator` (Layer A) is the shared source of truth for what is renderable. Codegen and the
validator import the same manifests (bindable props, hardcoded widget set, nav resolver) so the two
layers cannot drift.

| Code | Category | Description |
|------|----------|-------------|
| `C1` | Binding | Binding references an undeclared variable, **or** uses unsupported member access (only `.length` / `.isEmpty` / `.isNotEmpty` on string/list vars; `item.field` only inside a `dataSource` listView) |
| `C2` | Binding | `listView.dataSource` references a missing or wrong-typed variable |
| `C3a` | Action | Action references a nonexistent state variable / list field |
| `C3b` | Action | Handler method was never declared (e.g. an index-required action in the app bar, which has no item scope) |
| `C3b-collision` | Action | Two widgets produce the same handler method name |
| `C4` | Scope | `{{item}}` / `removeItem` / `toggleItemField` used outside a `dataSource` listView |
| `C5` | Widget | Unknown widget type (not in registry, not a hardcoded built-in) |
| `C6` | Layout | `expanded`/`spacer` outside a flex parent, or a data-bound listView with no item template |
| `C7` | Registry | Registry widget definition is missing required fields |
| `C8` | Props | Implausible prop value (invalid color/icon) — warning |
| `C9` | Identifier | Invalid/reserved screen name, or a `bottomNav`/`tabs` item pointing at an unknown screen id |
| `C10` | Identifier | State variable name produces an invalid Dart identifier |
| `C11` | Registry | Registry widget maps to a Flutter widget not on the known-safe allowlist |
| `C12` | Identifier | Duplicate screen `id`, `route`, or `name` |
| `C13` | Custom code | `customCode.stateDeps` references an undeclared variable (Phase 5) |
| `C14` | Custom code | `customCode` present but its feature gate is closed — warning (Phase 5) |
| `C15` | Type | Binding/mutation target has the wrong type (e.g. `increment` on a string, checkbox bound to an int, `clearFields` on a non-string) |
| `C16` | Navigation | `navigate` target does not resolve to any screen id or route |
| `C17` | Data | A seeded `itemList` value does not match its declared field type |
| `C18` | Visibility | `visibleWhen` predicate is invalid (undeclared var, or op incompatible with the var's type) |
| `C19` | Forms | `textField` validators config is invalid (unknown rule, or `minLength` without a numeric value) |
| `C20` | Forms | `dropdown`/`radioGroup` is missing a non-empty `options` array |
| `W-leading` | Warning | `appBar.leading` is set — codegen silently strips it |

---

## What it can build

Single-screen, in-memory Flutter apps (runs in a DartPad preview — no backend/persistence):

- **State & data** — `string` / `int` / `double` / `bool` / `stringList` / `itemList`; seeded lists render populated immediately
- **Interactions** — `addItem` / `removeItem` / `toggleItemField` / `increment` / `decrement` / `setValue` / `clearField`, plus `showSnackBar` / `showDialog` / `submitForm`
- **Bindings** — `{{var}}`, `{{item.field}}`, and computed `{{list.length}}` / `{{var.isEmpty}}`; `visibleWhen` toggles any widget's visibility
- **Forms** — `textField` validators (required / email / minLength) → `TextFormField`, `dropdown` / `radioGroup`, and a screen-level `Form` with submit gating
- **Navigation** — stack, bottom-tab, and tab-bar layouts
- **Theming** — full theme model (colors, brightness, typography, button/input/card/app-bar themes) via design-only edits

Multi-screen navigation, persistence, and network/async are gated behind feature flags / remote
verification and are not part of the default path.

---

## AppState Schema

The `AppState` is the central intermediate representation. All AI agents write to it; the `CodeGenerator` reads from it.

```typescript
AppState {
  appName: string
  theme: {                              // colors, brightness, typography, and
    primaryColor: string                //   per-component themes (appBar/card/button/input/text)
    brightness: 'light' | 'dark'
    // accentColor?, fontFamily?, scaffoldBackgroundColor?, defaultBorderRadius?, ...
  }
  navigation: { type: 'stack' | 'bottomNav' | 'tabs'; initialRoute: string; bottomNavItems?: [...] }
  screens: Screen[]
}

Screen {
  id: string
  name: string                          // PascalCase, used as the Dart class name
  route: string
  body: WidgetNode
  appBar?: AppBar; fab?: FAB
  screenState?: { variables: StateVariable[] }
}

WidgetNode {
  type: string                          // 'column' | 'button' | 'textField' | 'dropdown' | ...
  props: Record<string, unknown>        // incl. boundTo, validators, options, visibleWhen, action, ...
  children?: WidgetNode[]
}

StateVariable {
  name: string
  type: 'string' | 'int' | 'double' | 'bool' | 'stringList' | 'itemList'
  initialValue?: unknown                // seeded list literals are honored
  itemFields?: { name: string; type: string }[]   // for itemList
}

Action {
  type: 'navigate' | 'pop' | 'addItem' | 'removeItem' | 'toggleItemField'
      | 'increment' | 'decrement' | 'setValue' | 'clearField'
      | 'showSnackBar' | 'showDialog' | 'submitForm' | 'none'
  // target, listName, fieldName, valueFrom, value, clearFields, itemTemplate, message, title
}
```

The registry (`registry.json`) extends this with custom widgets. New widgets discovered during generation are staged in memory (never written to disk until explicitly committed through the learning compile-gate).

---

## Agent Architecture

| Agent | Model | Purpose |
|-------|-------|---------|
| `ClarifierAgent` | gpt-4o-mini | Classifies intent (`create` / `modifyStructure` / `modifyDesign` / `modifyBoth`), enriches the prompt, lists required widgets |
| `WidgetExtenderAgent` | gpt-4o-mini | Stages definitions for any non-standard widgets the Clarifier flags |
| `StructureAgent` | gpt-4o | Generates screen structure, state, and actions from the enriched prompt |
| `DesignAgent` | gpt-4o-mini | Generates theme, colors, and visual style |
| `PlannerAgent` | gpt-4o | (Phase 5, gated) Decomposes a request into multiple screen segments + a nav graph |
| `RepairAgent` | gpt-4o-mini → gpt-4o | Applies JSON patch ops to fix validation errors; model fallback on attempt 2 |
| `CriticAgent` | gpt-4o-mini | Scores intent fidelity (0–100) after a passing verification; recommends pass / warn / reloop |

All agents inherit from `BaseAgent` which provides structured function calling with retries, model fallback, and an optional validation hook. The `ClosedLoopOrchestrator` coordinates the loop and emits the live `PipelineEvent` stream (including each agent's `thinking` + decisions) over SSE.

---

## Closed-Loop Guarantees

- **Max 2 repair attempts** per request
- **Oscillation / no-progress detection**: if the error multiset (keyed by `code@nodePath`) repeats or cycles, the loop stops and degrades
- **Severity-weighted best candidate**: degrade always ships the most-compilable attempt (compile-fatal codes outweigh compile-but-degraded ones), never a worse-but-fewer-errors state
- **Wall-clock guard**: if less than 9 s remain in the 30 s budget, no new repair is started
- **Critic reloop**: at most 1 regeneration on low fidelity with missing core features
- **Degrade-prior**: if the user has a prior valid state and generation fails, the prior state is returned unchanged (session state is not overwritten)

---

## Running Tests

```bash
cd backend
npm test
```

159 tests across 9 suites — every codegen change is also checked end-to-end with a real
`flutter analyze` during development:

| Suite | Coverage |
|-------|----------|
| `static-validator.test.ts` | All C-codes (C1–C20) + the codegen↔validator lockstep invariant |
| `golden.test.ts` | Regression fixtures pinning compile-correctness (string escaping, single `style:`, computed bindings, forms, tabs, …) |
| `severity.test.ts` | Severity-weighted best-candidate scoring |
| `phase5.test.ts` | Planner P-rules, composePlan, customCode codegen |
| `remote-analyzer.test.ts` | Layer B + CompositeVerifier (cache-key soundness) |
| `loop-telemetry.test.ts` | Outcome aggregation |
| `activity.test.ts` | Per-agent activity-trace builders (ko/en) |
| `closed-loop.test.ts` / `shadow-verifier.test.ts` | Loop shape, oscillation, shadow mode |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript (pipeline-spine Activity view, DartPad preview, KO/EN i18n) |
| Backend | Node.js 20 + Express + TypeScript |
| AI | OpenAI GPT-4o / GPT-4o-mini (structured function calling) |
| Validation | Zod (schema) + StaticValidator (semantic, C1–C20) + optional `dart analyze` (Layer B) |
| Code gen | Deterministic TypeScript generator → `main.dart` |
| Streaming | Server-Sent Events (live `PipelineEvent` stream) |
| Preview | DartPad embed (iframe) |
| Tests | Node.js built-in test runner + tsx |

---

## Project Structure

```
FlowCraft/
├── backend/
│   ├── src/
│   │   ├── models/              # AppState Zod schema
│   │   ├── routes/              # Express routes (api.ts, incl. SSE + loop-stats)
│   │   └── services/
│   │       ├── agents/          # clarifier, widget-extender, structure, design, planner,
│   │       │                    #   repair, critic, closed-loop-orchestrator, pipeline-labels
│   │       ├── codegen-shared/  # shared manifests: binding-props, nav-resolve, expr,
│   │       │                    #   action-naming, color-table, icons, flex-rules
│   │       ├── verification/    # StaticValidator, CompositeVerifier, VerificationCache,
│   │       │                    #   RemoteAnalyzer, severity, loop-telemetry, knowledge/
│   │       ├── widget-registry/ # registry manager + registry.json
│   │       ├── change-explainer.ts   # localized changelog
│   │       └── pipeline-events.ts    # shared PipelineEvent contract
│   └── src/__tests__/           # 9 test suites
├── frontend/                    # React UI
│   └── src/
│       ├── components/          # PipelineSpine (Activity), StageNode/Card, DeviceFrame, …
│       ├── state/               # pipelineReducer + context
│       ├── services/            # api (SSE client), replay-engine, pipeline-events
│       ├── hooks/               # usePipelinePlayer
│       └── i18n/                # KO/EN dictionary + language context
├── docs/
│   ├── CLOSED_LOOP_DESIGN.md    # verify-repair pipeline spec
│   └── UI_REDESIGN_PLAN.md      # Activity-tab / pipeline-spine UI plan
└── ARCHITECTURE.md
```
