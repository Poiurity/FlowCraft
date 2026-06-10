// Shared positional addressing for AppState nodes.
// Used by StaticValidator (emit locations) and RepairAgent (patch targets) — must never drift.

export type NodePath = string;

// Grammar:
//   path    := segment ('.' segment)*
//   segment := key | index
//   key     := identifier
//   index   := '[' DIGITS ']'

export function tokenize(path: NodePath): (string | number)[] {
  const tokens: (string | number)[] = [];
  const parts = path.split('.');
  for (const part of parts) {
    if (!part) continue;
    // A part may be "foo[0]" or "foo[0][1]" — split on array indices
    let rest = part;
    const keyMatch = rest.match(/^([^\[]+)/);
    if (keyMatch) {
      tokens.push(keyMatch[1]);
      rest = rest.slice(keyMatch[1].length);
    }
    const idxRe = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = idxRe.exec(rest)) !== null) {
      tokens.push(parseInt(m[1], 10));
    }
  }
  return tokens;
}

type ResolveOk = { parent: unknown; key: string | number; exists: boolean };
type ResolveErr = { error: 'unresolvable'; at: string };
type ResolveResult = ResolveOk | ResolveErr;

export function resolvePath(root: unknown, path: NodePath): ResolveResult {
  const tokens = tokenize(path);
  if (tokens.length === 0) return { error: 'unresolvable', at: '(empty)' };

  let cur: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return { error: 'unresolvable', at: String(t) };
    }
    cur = (cur as any)[t];
  }

  const last = tokens[tokens.length - 1];
  if (cur === null || cur === undefined || typeof cur !== 'object') {
    return { error: 'unresolvable', at: String(last) };
  }
  const exists = Object.prototype.hasOwnProperty.call(cur, last) ||
    (Array.isArray(cur) && typeof last === 'number' && last >= 0 && last < (cur as unknown[]).length);
  return { parent: cur, key: last, exists };
}

export function sliceAtPath(root: unknown, path: NodePath): unknown {
  const r = resolvePath(root, path);
  if ('error' in r) return undefined;
  return (r.parent as any)[r.key];
}

export function isWithinEditable(patchPath: NodePath, editablePaths: NodePath[]): boolean {
  return editablePaths.some(ep =>
    patchPath === ep || patchPath.startsWith(ep + '.') || patchPath.startsWith(ep + '[')
  );
}

import type { RepairPatch } from './types';

// §C.5 — applyPatches ordering: group by containing array path, then apply removes/inserts
// in descending integer index order within each array (prevents index shift issues).
export function applyPatches(
  state: unknown,
  patches: RepairPatch[],
  editablePaths: NodePath[],
): { next: unknown; applied: RepairPatch[]; dropped: { patch: RepairPatch; reason: string }[] } {
  const applied: RepairPatch[] = [];
  const dropped: { patch: RepairPatch; reason: string }[] = [];

  // Deep clone to avoid mutating the original
  let next = JSON.parse(JSON.stringify(state));

  // Separate set/insert-create/remove/insert ops; sort removes & inserts by array + descending index
  const setOps = patches.filter(p => p.op === 'set' || p.op === 'insert-create');
  const indexOps = patches.filter(p => p.op === 'remove' || p.op === 'insert');

  // Group index ops by parent array path, apply descending
  type IndexGroup = { arrayPath: string; patches: (typeof patches[number] & { idx: number })[] };
  const groups = new Map<string, IndexGroup>();

  for (const patch of indexOps) {
    const tokens = tokenize(patch.path);
    if (tokens.length === 0) { dropped.push({ patch, reason: 'empty path' }); continue; }
    const last = tokens[tokens.length - 1];
    if (typeof last !== 'number') { dropped.push({ patch, reason: 'non-array index op' }); continue; }
    const arrayPath = tokens.slice(0, -1).join('.').replace(/\.\[/g, '[');
    if (!groups.has(arrayPath)) groups.set(arrayPath, { arrayPath, patches: [] });
    groups.get(arrayPath)!.patches.push({ ...patch, idx: last });
  }

  // Apply set ops first
  for (const patch of setOps) {
    if (!isWithinEditable(patch.path, editablePaths)) {
      dropped.push({ patch, reason: 'outside editablePaths' }); continue;
    }
    const r = resolvePath(next, patch.path);
    if ('error' in r) { dropped.push({ patch, reason: `unresolvable at ${r.at}` }); continue; }
    (r.parent as any)[r.key] = patch.value;
    applied.push(patch);
  }

  // Apply index ops grouped by array, descending index
  for (const group of groups.values()) {
    group.patches.sort((a, b) => b.idx - a.idx);
    for (const patch of group.patches) {
      if (!isWithinEditable(patch.path, editablePaths)) {
        dropped.push({ patch, reason: 'outside editablePaths' }); continue;
      }
      const r = resolvePath(next, patch.path);
      if ('error' in r) { dropped.push({ patch, reason: `unresolvable at ${r.at}` }); continue; }
      const arr = r.parent as unknown[];
      if (!Array.isArray(arr)) { dropped.push({ patch, reason: 'parent not an array' }); continue; }
      if (patch.op === 'remove') {
        arr.splice(patch.idx, 1);
      } else if (patch.op === 'insert') {
        const idx = patch.index !== undefined ? patch.index : arr.length;
        if (idx > arr.length) { dropped.push({ patch, reason: 'insert index out of bounds' }); continue; }
        arr.splice(idx, 0, patch.value);
      }
      applied.push(patch);
    }
  }

  return { next, applied, dropped };
}
