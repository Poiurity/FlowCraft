// Extracted from code-generator.ts fixFlexChild (L670-703) and unwrapExpandedIfNeeded (L713-721).
// Imported by CodeGenerator and StaticValidator (C6 parity).
import type { WidgetNode } from '../../models/appstate';

// §C.4 — parent-aware predicate replacing the child-only signature.
// Mirrors the call-site slot set (L737/751/764/781/926 = container,padding,sizedBox,card,center).
export const SINGLE_CHILD_UNWRAP_SLOTS = new Set([
  'container', 'padding', 'sizedBox', 'card', 'center',
]);

// Returns true when an `expanded` / `spacer` child is structurally valid in this parent context.
// CodeGenerator auto-wraps when parentType ∈ {Column,Row} and auto-unwraps when parentType ∈ SINGLE_CHILD_UNWRAP_SLOTS.
export function expandedIsValid(parentType: string, childType: string): boolean {
  if (!childType || (childType !== 'expanded' && childType !== 'spacer')) return true; // not our concern
  if (parentType === 'column' || parentType === 'row') return true; // direct Flex child → legal
  if (SINGLE_CHILD_UNWRAP_SLOTS.has(parentType)) return true;       // codegen auto-unwraps → never reaches Dart as Expanded
  return false;
}

// Mirrors fixFlexChild (L670-703): returns true when codegen would auto-wrap `child` in an Expanded.
export function wouldWrapInExpanded(parentType: string, child: WidgetNode): boolean {
  const SCROLLABLE = new Set(['listView', 'gridView']);
  const NEEDS_WIDTH = new Set(['textField']);

  if (parentType === 'Column' && SCROLLABLE.has(child.type)) return true;
  if (parentType === 'Column' && child.type === 'column' && hasExpandedChild(child)) return true;
  if (parentType === 'Row' && NEEDS_WIDTH.has(child.type)) return true;
  if (parentType === 'Row' && child.type === 'row' && hasExpandedChild(child)) return true;
  if (parentType === 'Row' && child.type === 'listView' && child.props?.scrollDirection !== 'horizontal') return true;
  return false;
}

export function hasExpandedChild(node: WidgetNode): boolean {
  return (node.children ?? []).some(c => c.type === 'expanded' || c.type === 'spacer');
}
