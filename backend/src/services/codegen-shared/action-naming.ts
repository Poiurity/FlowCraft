// Extracted verbatim from code-generator.ts (L397-425) so the validator and codegen
// share an identical symbol — C3b error codes are symbol-equal to emission sites.
import type { WidgetNode } from '../../models/appstate';
import type { Action } from '../../models/appstate';
import type { Screen, StateVariable } from '../../models/appstate';

// L962 — actions that require an `index` parameter in the handler signature.
export const INDEX_REQUIRED = new Set(['removeItem', 'toggleItemField']);

// L420-425 — method name key (valueFrom intentionally excluded from the name).
export function actionMethodName(a: Action): string {
  const parts: string[] = [a.type];
  if (a.listName) parts.push(a.listName);
  if (a.fieldName) parts.push(a.fieldName);
  return '_' + parts.map((p, i) =>
    i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
  ).join('');
}

// L397-418 — collects all action values from an AppState widget tree (children AND props-embedded nodes).
export function collectActions(node: WidgetNode): Action[] {
  const results: Action[] = [];
  if (node.props?.action) results.push(node.props.action);
  if (node.props?.onToggle) results.push(node.props.onToggle);
  if (node.props?.onDismissed) results.push(node.props.onDismissed);
  if (node.props?.onTap) results.push(node.props.onTap);
  if (node.props?.onSubmit) results.push(node.props.onSubmit);

  for (const val of Object.values(node.props || {})) {
    if (val && typeof val === 'object' && 'type' in val && typeof (val as any).type === 'string') {
      results.push(...collectActions(val as WidgetNode));
    }
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...collectActions(child));
    }
  }
  return results;
}

// §6.0.5 — bug-for-bug mirror of generateActionHandlers: dedup-key → per-type gate → method name.
// Returns the set of Dart method names generateActionHandlers would emit, plus collision names.
export function declaredHandlerMethods(
  screen: Screen,
  vars: StateVariable[],
): { declared: Set<string>; collisions: Set<string> } {
  const actions = collectActions(screen.body);
  if (screen.fab?.action) actions.push(screen.fab.action);

  const emittedByDedup = new Map<string, Action>();
  for (const a of actions) {
    if (!a || a.type === 'navigate' || a.type === 'pop' || a.type === 'none') continue;
    const k = `${a.type}_${a.listName || ''}_${a.fieldName || ''}_${a.valueFrom || ''}`;
    if (emittedByDedup.has(k)) continue;
    if (!bodyWouldEmit(a, vars)) continue;
    emittedByDedup.set(k, a);
  }

  const nameCount = new Map<string, number>();
  const declared = new Set<string>();
  for (const a of emittedByDedup.values()) {
    const n = actionMethodName(a);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    declared.add(n);
  }

  const collisions = new Set(
    [...nameCount].filter(([, c]) => c > 1).map(([n]) => n),
  );
  return { declared, collisions };
}

// Mirrors the per-type emission guards in generateActionHandlers (L301-392).
function bodyWouldEmit(a: Action, vars: StateVariable[]): boolean {
  if (a.type === 'addItem') {
    const listVar = vars.find(v => v.name === a.listName);
    if (listVar?.type === 'itemList' && a.itemTemplate) return true;
    if (listVar?.type === 'stringList') return true;
    return false;
  }
  if (a.type === 'removeItem') return !!a.listName;
  if (a.type === 'toggleItemField') return !!(a.listName && a.fieldName);
  if (a.type === 'increment') return !!a.fieldName;
  if (a.type === 'decrement') return !!a.fieldName;
  // setValue / clearField — no case in generateActionHandlers → never declared
  return false;
}
