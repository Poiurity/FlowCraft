# FlowCraft

**Natural language → working Flutter app, verified and self-healing.**

Describe an app in plain text. FlowCraft turns it into a structured app model, generates Flutter code deterministically, verifies the output against 13 error categories, and automatically repairs errors before they reach the user — up to twice per request.

---

## How it works

```
User prompt
    │
    ▼
┌─────────────┐
│  Clarifier  │  Enriches prompt, identifies intent and required widgets
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Structure  │     │   Design    │  Run in parallel for create / modifyBoth
│   Agent     │     │   Agent     │
└──────┬──────┘     └──────┬──────┘
       └─────────┬──────────┘
                 ▼
         ┌──────────────┐
         │   AppState   │  Structured JSON model — no code yet
         └──────┬───────┘
                ▼
         ┌──────────────┐
         │ CodeGenerator│  Deterministic template → main.dart
         └──────┬───────┘
                ▼
         ┌──────────────┐
         │    Verify    │  StaticValidator (Layer A) + optional RemoteAnalyzer (Layer B)
         └──────┬───────┘
          ok?  / \  errors?
              /   \
    ┌────────┐     ┌──────────────┐
    │ Critic │     │ RepairAgent  │  Patches AppState (max 2 attempts)
    └────────┘     └──────┬───────┘
    fidelity          re-verify
    scoring               │
         \           ok? / \ still errors?
          \             /   \
           ▼    ┌──────┐   ┌──────────┐
         SUCCESS│CRITIC│   │ DEGRADE  │  Return best attempt or prior state
                └──────┘   └──────────┘
```

**Two core design principles:**

1. **AI agents never write Flutter code directly.** They only produce `AppState` — a typed JSON model describing screens, widgets, navigation, and state. The `CodeGenerator` turns AppState into `main.dart` deterministically, so the output is predictable and verifiable.

2. **Every generated app is verified before delivery.** The closed-loop pipeline catches semantic errors (undeclared variables, illegal widget nesting, reserved identifiers, etc.) and attempts automatic repair. A `CriticAgent` then scores intent fidelity and can trigger one regeneration if core features are missing.

---

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenAI API key

### Backend

```bash
cd backend
cp .env.example .env   # Add OPENAI_API_KEY
npm install
npm run dev            # Starts on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # Starts on http://localhost:5173
```

Open `http://localhost:5173`. Type a prompt like *"a todo list app with dark theme"* and hit send.

---

## API Reference

### `POST /api/generate`

Generate or modify an app from a natural language prompt.

**Request**
```json
{
  "prompt": "a shopping list app with categories",
  "sessionId": "optional-existing-session-id"
}
```

**Response**
```json
{
  "sessionId": "uuid",
  "appState": { ... },
  "code": "import 'package:flutter/material.dart';\n...",
  "changelog": "Added 3 screens: Home, Categories, Cart",
  "degraded": false,
  "degradeReason": null,
  "attempts": [
    { "attempt": 0, "source": "initial", "ok": true, "errorCodes": [], "durationMs": 120 }
  ]
}
```

When `degraded: true`, the `appState` and `code` may reflect a prior valid state. `degradeReason` explains why: `oscillation`, `wall_clock`, `budget_exhausted`, `unrepairable`, or `structure_empty`.

### `GET /api/state/:sessionId`

Retrieve the current AppState for a session.

### `POST /api/state`

Import a manually edited AppState. In enforce mode, returns:
- `400` — JSON does not match the AppState schema (Zod parse error)
- `422` — Schema is valid but StaticValidator found errors (response includes `errors` array)
- `500` — Verification infrastructure failure
- `200` — Valid and stored

### `DELETE /api/state/:sessionId`

Clear a session.

### `GET /api/shadow-stats`

Returns accumulated verification histograms when running in shadow mode.

---

## Verification Modes

Set `VERIFY_MODE` in your environment:

| Mode | Behavior |
|------|----------|
| `off` (default) | No verification. Direct generation pipeline. |
| `shadow` | Verify after every response (fire-and-forget). Results visible at `/api/shadow-stats`. Zero latency impact. |
| `enforce` | Full closed-loop. Errors trigger RepairAgent. Failed repairs degrade gracefully. |

```bash
# Enable enforce mode
VERIFY_MODE=enforce npm run dev
```

---

## Verification Error Codes

The `StaticValidator` (Layer A) detects these errors in every generated AppState:

| Code | Category | Description |
|------|----------|-------------|
| `C1` | Binding | `{{varName}}` references a variable not declared in `screenState.variables` |
| `C1-dotted` | Binding | `{{var.field}}` member access on a non-itemList variable |
| `C2` | Binding | `listView.dataSource` references a missing or wrong-typed variable |
| `C3a` | Action | Action references a state variable that doesn't exist |
| `C3b` | Action | Handler method was never declared (setValue/clearField produce no handler; appBar actions are never collected) |
| `C3b-collision` | Action | Two widgets produce the same handler method name |
| `C4` | Scope | `{{item}}` or `removeItem` used outside a `listView` with a `dataSource` |
| `C5` | Widget | Unknown widget type (not in registry and not a hardcoded built-in) |
| `C6` | Layout | `expanded` widget used outside a `row` or `column` direct parent |
| `C7` | Registry | Widget definition in the registry is missing required fields |
| `C8` | Props | Implausible prop value (invalid hex color, negative dimension) — emitted as warning |
| `C9` | Identifier | Screen name collides with a Dart/Flutter reserved identifier |
| `C10` | Identifier | State variable name produces an invalid Dart identifier (`_${name}`) |
| `C11` | Registry | Registry widget maps to a Flutter widget not on the known-safe allowlist |
| `C12` | Identifier | Duplicate screen `id`, `route`, or `name` |
| `W-leading` | Warning | `appBar.leading` is set — codegen silently strips it |

Layer B (`RemoteAnalyzer`) activates automatically when `DART_SERVICES_URL` is set, providing additional analysis from a real Dart analysis server.

---

## AppState Schema

The `AppState` is the central intermediate representation. All AI agents write to it; the `CodeGenerator` reads from it.

```typescript
AppState {
  appName: string
  theme: {
    primaryColor: string    // hex color
    brightness: 'light' | 'dark'
  }
  navigation: {
    type: 'stack' | 'bottomNav' | 'drawer'
    initialRoute: string
  }
  screens: Screen[]
}

Screen {
  id: string
  name: string              // PascalCase, used as Dart class name
  route: string
  body: WidgetNode
  appBar?: AppBar
  fab?: FAB
  screenState?: {
    variables: StateVariable[]
  }
}

WidgetNode {
  type: string              // 'column' | 'button' | 'textField' | ...
  props: Record<string, unknown>
  children?: WidgetNode[]
}

StateVariable {
  name: string
  type: 'int' | 'string' | 'bool' | 'stringList' | 'itemList'
  initialValue: unknown
}
```

The registry (`registry.json`) extends this with custom widgets. New widgets discovered during generation are staged in memory via `stageDefinition` (never written to disk until explicitly committed through the learning compile-gate).

---

## Agent Architecture

| Agent | Model | Purpose |
|-------|-------|---------|
| `ClarifierAgent` | gpt-4o-mini | Enriches prompt, identifies intent (`create` / `modifyStructure` / `modifyDesign` / `modifyBoth`), lists required widgets |
| `WidgetExtenderAgent` | gpt-4o-mini | Stages definitions for any non-standard widgets identified by the Clarifier |
| `StructureAgent` | gpt-4o | Generates screen structure, navigation, and state from the enriched prompt |
| `DesignAgent` | gpt-4o-mini | Generates theme, colors, and visual style |
| `RepairAgent` | gpt-4o-mini → gpt-4o | Applies JSON patch ops to fix validation errors; uses model fallback on attempt 2 |
| `CriticAgent` | gpt-4o-mini | Scores intent fidelity (0–100) after a passing verification; recommends pass / warn / reloop |

All agents inherit from `BaseAgent` which provides `callFunctionWithRetry` — structured function calling with configurable retries, model fallback, and an optional validation hook.

---

## Closed-Loop Guarantees

- **Max 2 repair attempts** per request
- **Oscillation detection**: if the error multiset (keyed by `code@nodePath`) repeats or cycles, the loop stops and degrades
- **Wall-clock guard**: if less than 9 seconds remain in the 30-second budget, no new repair is started
- **Critic reloop**: at most 1 regeneration triggered by fidelity < 85 with missing core features
- **Degrade-prior**: if the user has a prior valid state and generation fails at any point, the prior state is returned unchanged (session state is not overwritten)

---

## Running Tests

```bash
cd backend
npm test
```

53 tests across three suites:

| Suite | Tests | Coverage |
|-------|-------|----------|
| `static-validator.test.ts` | 35 | All 13 error codes + happy path + lockstep invariant |
| `shadow-verifier.test.ts` | 6 | Mode detection, fire-and-forget, stats ring |
| `closed-loop.test.ts` | 12 | msKey oscillation, LoopResult shape, RepairAgent contract, 3-channel API |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js 20 + Express + TypeScript |
| AI | OpenAI GPT-4o / GPT-4o-mini (structured function calling) |
| Validation | Zod (schema) + StaticValidator (semantic) |
| Code gen | Handlebars templates → `main.dart` |
| Preview | DartPad embed (iframe) |
| Tests | Node.js built-in test runner + tsx |

---

## Project Structure

```
FlowCraft/
├── backend/
│   ├── src/
│   │   ├── models/          # AppState Zod schema
│   │   ├── routes/          # Express routes (api.ts)
│   │   └── services/
│   │       ├── agents/      # AI agents (clarifier, structure, design,
│   │       │                #   repair, critic, closed-loop-orchestrator)
│   │       ├── codegen-shared/  # Shared logic (colors, icons, flex rules)
│   │       ├── verification/    # StaticValidator, CompositeVerifier,
│   │       │                    #   VerificationCache, ShadowVerifier,
│   │       │                    #   RemoteAnalyzer, node-path, knowledge/
│   │       └── widget-registry/ # Registry manager + registry.json
│   └── __tests__/           # Test suites
├── frontend/                # React UI (chat, DartPad preview, AppState viewer)
└── docs/
    └── CLOSED_LOOP_DESIGN.md  # Full design spec for the verify-repair pipeline
```
