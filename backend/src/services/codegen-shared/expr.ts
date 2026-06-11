// Shared, CLOSED expression grammar for computed bindings and visibility.
//
// One resolver imported by both codegen (which lowers to Dart) and the validator
// (which accepts/rejects), so the two layers cannot diverge. The grammar is
// reject-by-default: only the explicit accessors/ops below are valid. Arithmetic
// and comparisons-with-values are intentionally NOT included yet.

export type VarLookup = (name: string) => string | undefined;

// Types that expose `.length` / `.isEmpty` / `.isNotEmpty`.
const HAS_LENGTH_EMPTY = new Set(['string', 'stringList', 'itemList']);

export interface ComputedResult { dart: string; type: 'int' | 'bool'; }

/**
 * Resolve a dotted text-binding expression like `tasks.length` / `q.isEmpty`.
 * Returns the lowered Dart + result type, or null if it is not a (valid)
 * computed access (caller then treats it as a plain/invalid ref).
 */
export function resolveComputed(expr: string, lookup: VarLookup): ComputedResult | null {
  const dot = expr.indexOf('.');
  if (dot < 0) return null;
  const head = expr.slice(0, dot);
  const accessor = expr.slice(dot + 1);
  const vt = lookup(head);
  if (!vt) return null;
  if (accessor === 'length' && HAS_LENGTH_EMPTY.has(vt)) return { dart: `_${head}.length`, type: 'int' };
  if ((accessor === 'isEmpty' || accessor === 'isNotEmpty') && HAS_LENGTH_EMPTY.has(vt)) {
    return { dart: `_${head}.${accessor}`, type: 'bool' };
  }
  return null;
}

export const VISIBLE_OPS = ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'] as const;
export type VisibleOp = (typeof VISIBLE_OPS)[number];

/**
 * Lower a `visibleWhen` predicate { var, op } to a Dart bool expression, or null
 * if the predicate is malformed or the op is incompatible with the var's type.
 */
export function resolveVisibleWhen(pred: any, lookup: VarLookup): { dart: string } | null {
  if (!pred || typeof pred !== 'object' || typeof pred.var !== 'string') return null;
  const vt = lookup(pred.var);
  if (!vt) return null;
  const v = `_${pred.var}`;
  switch (pred.op) {
    case 'isEmpty': return HAS_LENGTH_EMPTY.has(vt) ? { dart: `${v}.isEmpty` } : null;
    case 'isNotEmpty': return HAS_LENGTH_EMPTY.has(vt) ? { dart: `${v}.isNotEmpty` } : null;
    case 'isTrue': return vt === 'bool' ? { dart: v } : null;
    case 'isFalse': return vt === 'bool' ? { dart: `!${v}` } : null;
    default: return null;
  }
}
