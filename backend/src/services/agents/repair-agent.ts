import { BaseAgent } from './base-agent';
import { AppStateSchema } from '../../models/appstate';
import { applyPatches } from '../verification/node-path';
import type { RepairInput, RepairResult, RepairPatch, RegistrySnapshot, ValidationError } from '../verification/types';

const REPAIR_SYSTEM_PROMPT = `You are FlowCraft's Repair Agent. You receive an AppState JSON and a list of validation errors and must produce targeted JSON patches that fix them.

ERROR CODE REFERENCE:
C1       - {{varName}} references a variable not declared in screenState.variables
C1-dotted - {{var.field}} — var is not an itemList type; member access is invalid
C2       - listView.props.dataSource references a variable that doesn't exist or is wrong type (must be stringList or itemList)
C3       - Action references a state variable that doesn't exist
C3b      - Handler method was never declared (setValue/clearField produce no handler; appBar actions never collected)
C4       - item.field access outside a listView's item scope
C5       - Unknown widget type used (not in registry or hardcoded list)
C6       - Expanded widget in invalid position (only valid directly inside row or column)
C7       - Registry widget definition is malformed (missing required fields)
C8       - Prop value is implausible (negative dimension, out-of-range color, etc.)
C9       - Screen name not PascalCase OR uses a Dart reserved identifier
C10      - State variable name collides with a Dart reserved identifier
C11      - Registry widget uses a Flutter widget not in the known safe allowlist
C12      - Duplicate identifier (two screens with same name, variable collision, etc.)

PATCH OP TYPES:
- "set"           — set the node at path to value (creating a missing key is allowed)
- "remove"        — delete the node at path (array element or object key)
- "insert"        — insert value into array at path, at integer index (append if omitted)
- "insert-create" — set a missing array key to [value] (for brand-new arrays)

PATH FORMAT: Dot/bracket notation into AppState.
Examples:
  "screens[0].screenState.variables[1].name"
  "screens[0].body.children[2].props.dataSource"
  "screens[0].appBar.actions[0].action.type"

REPAIR RULES:
- Emit patches ONLY for paths at or under the provided error locations.
- For C3b (appBar action): move the action onto a body widget or change its type to navigate/pop.
- For C3b (setValue/clearField): replace type with "none" or a supported action.
- For C11 (datePicker → DatePicker): emit ALL of these together:
    1. Set node type to "textField".
    2. Replace node props with { "label": "Date", "hint": "YYYY-MM-DD", "boundTo": "<that var>" }.
    3. Set the bound state variable's type to "string" (or create it).
- For C1-dotted: change {{x.y}} binding to a scalar var {{x}} or, inside a listView, {{item.y}}.
- Prefer "set" over "remove". Never delete an entire screen or body.
- If ALL errors are genuinely contradictory and unfixable, set unrepairable=true.

Respond ONLY with the repair_appstate function call.`;

// §4.4 — simplified schema matching the design spec exactly.
const REPAIR_PARAMS = {
  type: 'object',
  required: ['patches', 'repairNotes', 'unrepairable'],
  properties: {
    patches: {
      type: 'array',
      description: 'Minimal patch set to resolve all listed errors.',
      items: {
        type: 'object',
        required: ['op', 'path'],
        properties: {
          op: { type: 'string', enum: ['set', 'remove', 'insert', 'insert-create'] },
          path: { type: 'string', description: 'Dot/bracket path into appState' },
          value: { description: 'New value for set/insert/insert-create; omit for remove' },
          index: { type: 'integer', description: 'Array position for insert; omit to append' },
        },
      },
    },
    repairNotes: { type: 'string', description: 'Brief explanation of changes.' },
    unrepairable: { type: 'boolean', description: 'True only when errors are logically contradictory.' },
  },
};

// §6.10 — editablePaths: closure of error.location ∪ repairTargetPaths(error)
function computeEditablePaths(errors: ValidationError[]): string[] {
  const paths = new Set<string>();

  for (const e of errors) {
    const np = e.location?.nodePath;
    if (np) paths.add(np);

    // C3b appBar: open body + appBar for the screen so action can be moved
    if ((e.code === 'C3b' || e.code === 'C3b-collision') && np) {
      const m = np.match(/^(screens\[\d+\])/);
      if (m) { paths.add(`${m[1]}.body`); paths.add(`${m[1]}.appBar`); }
    }

    // C11 poison widget: open screenState.variables so boundTo var can be retyped
    if (e.code === 'C11' && np) {
      const m = np.match(/^(screens\[\d+\])/);
      if (m) paths.add(`${m[1]}.screenState.variables`);
    }
  }

  // Fallback: allow all top-level AppState fields when errors carry no nodePath
  return paths.size > 0
    ? [...paths]
    : ['screens', 'appName', 'navigation', 'theme'];
}

export class RepairAgent extends BaseAgent {
  async repair(input: RepairInput, _snap: RegistrySnapshot): Promise<RepairResult> {
    if (input.errors.length === 0) {
      return { appState: input.appState, repairNotes: 'no errors to fix', unrepairable: false };
    }

    const topErrors = input.errors.filter(e => e.severity === 'error').slice(0, 8);
    const errSummary = topErrors
      .map(e => `[${e.code}] ${e.message}${e.location?.nodePath ? ` at: ${e.location.nodePath}` : ''}`)
      .join('\n');

    const userMessage = [
      `AppState to repair (repair attempt #${input.attempt}):`,
      '```json',
      JSON.stringify(input.appState, null, 2),
      '```',
      '',
      `Original user prompt: "${input.originalPrompt}"`,
      '',
      'Errors that MUST be fixed:',
      errSummary,
      '',
      'Emit the minimum patch set to resolve ALL listed errors.',
    ].join('\n');

    let out: any;
    try {
      out = await this.callFunctionWithRetry(
        REPAIR_SYSTEM_PROMPT,
        userMessage,
        'repair_appstate',
        REPAIR_PARAMS,
        { model: 'gpt-4o-mini', fallbackModel: 'gpt-4o', maxRetries: 1, temperature: 0.05 },
      );
    } catch (e: any) {
      console.error('[RepairAgent] callFunctionWithRetry failed:', e.message);
      return { appState: input.appState, repairNotes: `LLM call failed: ${e.message}`, unrepairable: false };
    }

    const notes: string = out.repairNotes ?? '';

    if (out.unrepairable === true) {
      return { appState: input.appState, repairNotes: notes || 'unrepairable', unrepairable: true };
    }

    const patches: RepairPatch[] = Array.isArray(out.patches) ? out.patches : [];
    if (patches.length === 0) {
      console.warn('[RepairAgent] no patches produced');
      return { appState: input.appState, repairNotes: notes || 'no patches produced', unrepairable: false };
    }

    const editablePaths = computeEditablePaths(topErrors);
    try {
      const { next, applied, dropped } = applyPatches(
        input.appState as Record<string, unknown>,
        patches,
        editablePaths,
      );
      if (dropped.length > 0) {
        console.warn(`[RepairAgent] ${dropped.length} patch(es) dropped:`, dropped.map(d => `${d.patch.path}: ${d.reason}`));
      }
      const validated = AppStateSchema.parse(next);
      return {
        appState: validated,
        repairNotes: notes || `applied ${applied.length}/${patches.length} patch(es)`,
        unrepairable: false,
        _meta: { patchesApplied: applied.length, patchesDropped: dropped.length },
      } as RepairResult & { _meta: any };
    } catch (e: any) {
      console.warn('[RepairAgent] patch application failed:', e.message);
      return { appState: input.appState, repairNotes: `patches rejected: ${notes}`, unrepairable: false };
    }
  }
}
