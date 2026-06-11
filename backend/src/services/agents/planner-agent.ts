// Phase 5 — PlannerAgent.
// Inserts a PLAN state between CLARIFY and EXTEND, emitting a SegmentSpec[].
// Pure helpers (validatePlan, normalizePlan, composePlan) are unit-testable.

import { BaseAgent } from './base-agent.js';
import { AppStateSchema } from '../../models/appstate.js';
import type { AppState, Screen, Theme, Navigation } from '../../models/appstate.js';

export const MAX_SEGMENTS = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SegmentSpec {
  screenId: string;
  screenName: string;
  route: string;
  role: 'entry' | 'detail' | 'modal' | 'settings' | 'other';
  responsibility: string;
  requiredWidgets: string[];
  navTargets: string[];   // screenIds this segment can navigate to
}

export interface SegmentPlan {
  appName: string;
  segments: SegmentSpec[];
  navigationStyle: 'stack' | 'bottomNav' | 'tabs';
}

export interface PlanValidationError {
  code: string;   // P1..P7
  message: string;
}

// ── PlanValidator (P1–P7) ─────────────────────────────────────────────────────

export function validatePlan(plan: SegmentPlan): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const { segments, navigationStyle } = plan;

  // P7: segment cap
  if (segments.length > MAX_SEGMENTS) {
    errors.push({ code: 'P7', message: `Segment count ${segments.length} exceeds MAX_SEGMENTS=${MAX_SEGMENTS}` });
  }

  // P1: unique screenIds
  const ids = new Set<string>();
  for (const s of segments) {
    if (ids.has(s.screenId)) {
      errors.push({ code: 'P1', message: `Duplicate screenId '${s.screenId}'` });
    }
    ids.add(s.screenId);
  }

  // P2: unique routes
  const routes = new Set<string>();
  for (const s of segments) {
    if (routes.has(s.route)) {
      errors.push({ code: 'P2', message: `Duplicate route '${s.route}'` });
    }
    routes.add(s.route);
  }

  // P3: unique screen names
  const names = new Set<string>();
  for (const s of segments) {
    if (names.has(s.screenName)) {
      errors.push({ code: 'P3', message: `Duplicate screenName '${s.screenName}'` });
    }
    names.add(s.screenName);
  }

  // P5: valid PascalCase screen names and routes starting with '/'
  for (const s of segments) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(s.screenName)) {
      errors.push({ code: 'P5', message: `screenName '${s.screenName}' is not valid PascalCase` });
    }
    if (!s.route.startsWith('/')) {
      errors.push({ code: 'P5', message: `route '${s.route}' for segment '${s.screenId}' must start with '/'` });
    }
  }

  // P4: resolvable nav targets (each navTarget must match a known screenId)
  for (const s of segments) {
    for (const t of s.navTargets) {
      if (!ids.has(t)) {
        errors.push({ code: 'P4', message: `navTarget '${t}' in segment '${s.screenId}' does not match any screenId` });
      }
    }
  }

  // P6: reachability — every non-entry segment reachable from entry (segments[0])
  if (segments.length > 1) {
    const entryId = segments[0].screenId;
    const reachable = new Set<string>([entryId]);
    const queue: string[] = [entryId];
    const navMap = new Map<string, string[]>(segments.map(s => [s.screenId, s.navTargets]));

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const t of navMap.get(cur) ?? []) {
        if (!reachable.has(t)) {
          reachable.add(t);
          queue.push(t);
        }
      }
    }

    for (const s of segments) {
      if (!reachable.has(s.screenId)) {
        errors.push({ code: 'P6', message: `Segment '${s.screenId}' is not reachable from entry '${entryId}'` });
      }
    }
  }

  return errors;
}

// ── normalizePlan ─────────────────────────────────────────────────────────────
// Normalizes identifiers deterministically to preserve cache key stability.

export function normalizePlan(plan: SegmentPlan): SegmentPlan {
  const usedRoutes = new Set<string>();
  const usedNames = new Set<string>();

  const segments = plan.segments.map((s, i) => {
    // Routes start with '/'
    let route = s.route.startsWith('/') ? s.route : `/${s.route}`;
    // Entry segment always gets '/'
    if (i === 0) route = '/';
    if (usedRoutes.has(route)) route = `${route}-${i}`;
    usedRoutes.add(route);

    // PascalCase screen names
    let screenName = s.screenName;
    if (!/^[A-Z]/.test(screenName)) {
      screenName = screenName.charAt(0).toUpperCase() + screenName.slice(1);
    }
    // Dedupe suffix
    if (usedNames.has(screenName)) screenName = `${screenName}${i}`;
    usedNames.add(screenName);

    return { ...s, route, screenName };
  });

  return { ...plan, segments };
}

// ── composePlan ───────────────────────────────────────────────────────────────
// Merges per-segment generated screens into a single AppState-compatible structure.

export function composePlan(
  segmentScreens: Screen[],
  plan: SegmentPlan,
  theme: Theme,
): { appName: string; theme: Theme; screens: Screen[]; navigation: Navigation } {
  return {
    appName: plan.appName,
    theme,
    screens: segmentScreens,
    navigation: buildNavigation(plan, segmentScreens),
  };
}

function buildNavigation(plan: SegmentPlan, screens: Screen[]): Navigation {
  if (plan.navigationStyle === 'bottomNav' && plan.segments.length > 1) {
    return {
      type: 'bottomNav',
      initialRoute: '/',
      bottomNavItems: plan.segments.map((spec, i) => ({
        icon: 'home',
        label: spec.screenName.replace(/Screen$/, '') || spec.screenName,
        screenId: spec.screenId,
      })),
    };
  }
  return { type: 'stack' as const, initialRoute: '/' };
}

// ── PlannerAgent ──────────────────────────────────────────────────────────────

const PLANNER_PROMPT = `You are FlowCraft's Planner Agent. Given a user's app description, plan the screen architecture.

OUTPUT a JSON plan with:
- appName: string (PascalCase, no spaces)
- navigationStyle: "stack" | "bottomNav" | "tabs"
- segments: array of screens (max ${MAX_SEGMENTS})

Each segment:
- screenId: kebab-case unique id (e.g. "home", "detail", "settings")
- screenName: PascalCase class name (e.g. "HomeScreen", "DetailScreen")
- route: route path starting with "/" (entry screen must be "/")
- role: "entry" | "detail" | "modal" | "settings" | "other"
- responsibility: one sentence describing what this screen does
- requiredWidgets: list of widget types needed (e.g. ["listView", "button"])
- navTargets: list of screenIds this screen can navigate to

RULES:
1. First segment must have route "/" (entry point)
2. All navTargets must be screenIds in this plan
3. Use "stack" navigation unless the app is clearly tab-based
4. Every non-entry screen must be reachable from entry via navTargets
5. Screen names must be valid PascalCase Dart identifiers
6. Minimize screens — combine related content before splitting

Respond ONLY with the function call.`;

function buildPlannerSchema(): Record<string, any> {
  return {
    type: 'object',
    properties: {
      appName: { type: 'string' },
      navigationStyle: { type: 'string', enum: ['stack', 'bottomNav', 'tabs'] },
      segments: {
        type: 'array',
        maxItems: MAX_SEGMENTS,
        items: {
          type: 'object',
          properties: {
            screenId: { type: 'string' },
            screenName: { type: 'string' },
            route: { type: 'string' },
            role: { type: 'string', enum: ['entry', 'detail', 'modal', 'settings', 'other'] },
            responsibility: { type: 'string' },
            requiredWidgets: { type: 'array', items: { type: 'string' } },
            navTargets: { type: 'array', items: { type: 'string' } },
          },
          required: ['screenId', 'screenName', 'route', 'role', 'responsibility', 'requiredWidgets', 'navTargets'],
        },
      },
    },
    required: ['appName', 'navigationStyle', 'segments'],
  };
}

export class PlannerAgent extends BaseAgent {
  async plan(enrichedPrompt: string): Promise<SegmentPlan> {
    const raw = await this.callFunction(
      PLANNER_PROMPT,
      enrichedPrompt,
      'generate_plan',
      buildPlannerSchema(),
    ) as SegmentPlan;

    // Normalize identifiers deterministically
    const normalized = normalizePlan(raw);

    // Validate and throw on P1–P7 violations
    const errs = validatePlan(normalized);
    if (errs.length > 0) {
      const msg = errs.map(e => `${e.code}: ${e.message}`).join('; ');
      throw new Error(`[PlannerAgent] Plan validation failed — ${msg}`);
    }

    return normalized;
  }
}
