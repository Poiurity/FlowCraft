// Single source of truth for resolving a navigate action's `target` to a route.
//
// A navigate target may be authored as a screenId ('detail') or a literal route
// ('/detail'). Codegen and the validator MUST agree on resolution, or the
// validator certifies a navigate that crashes at runtime ("no route"). Both
// import this resolver; the C16 check is exactly "resolveNavRoute === UNRESOLVED".

// Deterministic sentinel for an unresolvable target. Codegen emits it instead of
// guessing a plausible route, so an unresolved nav is caught by C16 (not hidden).
export const NAV_UNRESOLVED = '/__unresolved__';

/** Resolve a navigate target to a concrete route, or NAV_UNRESOLVED. */
export function resolveNavRoute(target: string, screenIdToRoute: Map<string, string>): string {
  if (!target) return NAV_UNRESOLVED;
  // 1) screenId → its route
  const byId = screenIdToRoute.get(target);
  if (byId !== undefined) return byId;
  // 2) literal route (exact, or with a leading slash added)
  const routes = new Set(screenIdToRoute.values());
  if (routes.has(target)) return target;
  const normalized = target.startsWith('/') ? target : '/' + target;
  if (routes.has(normalized)) return normalized;
  return NAV_UNRESOLVED;
}

/** Build the screenId → route map from an AppState's screens. */
export function buildScreenIdToRoute(screens: ReadonlyArray<{ id: string; route: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of screens) m.set(s.id, s.route);
  return m;
}
