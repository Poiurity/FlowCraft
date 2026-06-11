// Phase 5 tests — PlanValidator (P1–P7), normalizePlan, composePlan, C13, C14, customCode codegen.
// All pure-TS: no LLM calls, no dart-services required.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePlan, normalizePlan, composePlan, MAX_SEGMENTS,
  type SegmentSpec, type SegmentPlan,
} from '../services/agents/planner-agent';
import { StaticValidator } from '../services/verification/static-validator';
import { CodeGenerator } from '../services/code-generator';
import { widgetRegistry } from '../services/widget-registry/registry-manager';
import type { VerifyContext } from '../services/verification/types';
import type { AppState } from '../models/appstate';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(): VerifyContext {
  const snap = widgetRegistry.cloneDefinitions();
  return {
    registryVersion: snap.registryVersion,
    registrySnapshot: snap,
    source: 'live',
    requestId: 'test-phase5',
    attempt: 0,
  };
}

function minimalState(overrides: Partial<AppState> = {}): AppState {
  return {
    appName: 'TestApp',
    theme: { primaryColor: '#2196F3', brightness: 'light' },
    navigation: { type: 'stack', initialRoute: '/' },
    screens: [{
      id: 'home', name: 'HomeScreen', route: '/',
      body: { type: 'text', props: { content: 'Hello' } },
    }],
    ...overrides,
  };
}

function makeBasePlan(overrides: Partial<SegmentPlan> = {}): SegmentPlan {
  return {
    appName: 'TestApp',
    navigationStyle: 'stack',
    segments: [
      { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'Main screen', requiredWidgets: [], navTargets: ['detail'] },
      { screenId: 'detail', screenName: 'DetailScreen', route: '/detail', role: 'detail', responsibility: 'Detail view', requiredWidgets: [], navTargets: [] },
    ],
    ...overrides,
  };
}

// ── validatePlan ──────────────────────────────────────────────────────────────

describe('validatePlan — P1: unique screenIds', () => {
  test('P1 ok: all ids unique', () => {
    const errs = validatePlan(makeBasePlan());
    assert.equal(errs.filter(e => e.code === 'P1').length, 0);
  });

  test('P1 fail: duplicate screenId', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
        { screenId: 'home', screenName: 'OtherScreen', route: '/other', role: 'other', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P1'), 'P1 not raised');
  });
});

describe('validatePlan — P2: unique routes', () => {
  test('P2 fail: duplicate route', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
        { screenId: 'other', screenName: 'OtherScreen', route: '/', role: 'other', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P2'), 'P2 not raised');
  });
});

describe('validatePlan — P3: unique screen names', () => {
  test('P3 fail: duplicate screenName', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
        { screenId: 'other', screenName: 'HomeScreen', route: '/other', role: 'other', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P3'), 'P3 not raised');
  });
});

describe('validatePlan — P4: resolvable nav targets', () => {
  test('P4 ok: navTarget exists', () => {
    const errs = validatePlan(makeBasePlan());
    assert.equal(errs.filter(e => e.code === 'P4').length, 0);
  });

  test('P4 fail: navTarget references unknown screenId', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: ['ghost'] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P4'), 'P4 not raised');
  });
});

describe('validatePlan — P5: PascalCase names and / prefix routes', () => {
  test('P5 fail: lowercase screenName', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'homeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P5'), 'P5 not raised for lowercase');
  });

  test('P5 fail: route without leading /', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: 'home', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P5'), 'P5 not raised for missing /');
  });
});

describe('validatePlan — P6: reachability', () => {
  test('P6 ok: all screens reachable', () => {
    const errs = validatePlan(makeBasePlan());
    assert.equal(errs.filter(e => e.code === 'P6').length, 0);
  });

  test('P6 fail: orphaned screen unreachable from entry', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
        { screenId: 'orphan', screenName: 'OrphanScreen', route: '/orphan', role: 'other', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const errs = validatePlan(plan);
    assert.ok(errs.some(e => e.code === 'P6'), 'P6 not raised for orphan');
  });
});

describe('validatePlan — P7: segment cap', () => {
  test('P7 ok: exactly MAX_SEGMENTS', () => {
    const segments: SegmentSpec[] = Array.from({ length: MAX_SEGMENTS }, (_, i) => ({
      screenId: `s${i}`,
      screenName: `Screen${i}`,
      route: i === 0 ? '/' : `/s${i}`,
      role: i === 0 ? 'entry' : 'other',
      responsibility: `r${i}`,
      requiredWidgets: [],
      navTargets: i < MAX_SEGMENTS - 1 ? [`s${i + 1}`] : [],
    }));
    const errs = validatePlan({ appName: 'A', navigationStyle: 'stack', segments });
    assert.equal(errs.filter(e => e.code === 'P7').length, 0);
  });

  test('P7 fail: exceeds MAX_SEGMENTS', () => {
    const segments: SegmentSpec[] = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({
      screenId: `s${i}`,
      screenName: `Screen${i}`,
      route: i === 0 ? '/' : `/s${i}`,
      role: i === 0 ? 'entry' : 'other',
      responsibility: `r${i}`,
      requiredWidgets: [],
      navTargets: [],
    }));
    const errs = validatePlan({ appName: 'A', navigationStyle: 'stack', segments });
    assert.ok(errs.some(e => e.code === 'P7'), 'P7 not raised');
  });
});

// ── normalizePlan ─────────────────────────────────────────────────────────────

describe('normalizePlan', () => {
  test('NP-1: entry route is forced to /', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/main', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const normalized = normalizePlan(plan);
    assert.equal(normalized.segments[0].route, '/');
  });

  test('NP-2: routes without / get prefix added', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'HomeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: ['detail'] },
        { screenId: 'detail', screenName: 'DetailScreen', route: 'detail', role: 'detail', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const normalized = normalizePlan(plan);
    assert.ok(normalized.segments[1].route.startsWith('/'), 'non-entry route should start with /');
  });

  test('NP-3: lowercase screenName gets capitalized', () => {
    const plan = makeBasePlan({
      segments: [
        { screenId: 'home', screenName: 'homeScreen', route: '/', role: 'entry', responsibility: 'r', requiredWidgets: [], navTargets: [] },
      ],
    });
    const normalized = normalizePlan(plan);
    assert.ok(/^[A-Z]/.test(normalized.segments[0].screenName), 'screenName not capitalized');
  });
});

// ── composePlan ───────────────────────────────────────────────────────────────

describe('composePlan', () => {
  const plan = makeBasePlan();
  const screens = [
    { id: 'home', name: 'HomeScreen', route: '/', body: { type: 'text', props: { content: 'Hello' } } },
    { id: 'detail', name: 'DetailScreen', route: '/detail', body: { type: 'text', props: { content: 'Detail' } } },
  ];
  const theme = { primaryColor: '#2196F3', brightness: 'light' as const };

  test('CP-1: composed appName comes from plan', () => {
    const composed = composePlan(screens, plan, theme);
    assert.equal(composed.appName, plan.appName);
  });

  test('CP-2: all screens preserved', () => {
    const composed = composePlan(screens, plan, theme);
    assert.equal(composed.screens.length, 2);
  });

  test('CP-3: stack navigation defaults to type=stack', () => {
    const composed = composePlan(screens, plan, theme);
    assert.equal(composed.navigation.type, 'stack');
  });

  test('CP-4: bottomNav plan emits bottomNav navigation', () => {
    const bnPlan = makeBasePlan({ navigationStyle: 'bottomNav' });
    const composed = composePlan(screens, bnPlan, theme);
    assert.equal(composed.navigation.type, 'bottomNav');
  });
});

// ── C13 / C14 — StaticValidator ──────────────────────────────────────────────

describe('StaticValidator C13/C14 (customCode)', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.FLOWCRAFT_PHASE5;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.FLOWCRAFT_PHASE5;
    } else {
      process.env.FLOWCRAFT_PHASE5 = savedEnv;
    }
  });

  test('C14: customCode node with gate closed → warning', async () => {
    delete process.env.FLOWCRAFT_PHASE5;
    const sv = new StaticValidator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text('hello')",
              interface: { stateDeps: [], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const result = await sv.verify(state, '', makeCtx());
    assert.ok(result.ok, 'C14 is a warning — ok should be true');
    assert.ok(result.warnings.some(w => w.code === 'C14'), 'C14 warning not emitted');
  });

  test('C14: gate open but no C14 warning', async () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    const sv = new StaticValidator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text('hello')",
              interface: { stateDeps: [], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const result = await sv.verify(state, '', makeCtx());
    assert.equal(result.warnings.filter(w => w.code === 'C14').length, 0, 'C14 should not fire when gate is open');
  });

  test('C13: stateDeps outside screen vars → error', async () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    const sv = new StaticValidator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text(_undeclared.toString())",
              interface: { stateDeps: ['undeclared'], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const result = await sv.verify(state, '', makeCtx());
    assert.equal(result.ok, false, 'C13 is an error — ok should be false');
    assert.ok(result.errors.some(e => e.code === 'C13'), 'C13 error not emitted');
  });

  test('C13: stateDeps within screen vars → no error', async () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    const sv = new StaticValidator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        screenState: { variables: [{ name: 'count', type: 'int', initialValue: 0 }] },
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text(_count.toString())",
              interface: { stateDeps: ['count'], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const result = await sv.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C13').length, 0, 'C13 should not fire for valid stateDeps');
  });

  test('C13: partial stateDeps missing → only missing ones reported', async () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    const sv = new StaticValidator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        screenState: { variables: [{ name: 'count', type: 'int', initialValue: 0 }] },
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text(_count.toString())",
              interface: { stateDeps: ['count', 'missing'], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const result = await sv.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C13'), 'C13 not emitted');
    const c13 = result.errors.find(e => e.code === 'C13')!;
    assert.ok((c13.context?.missingDeps as string[]).includes('missing'), 'missing dep not in context');
    assert.ok(!(c13.context?.missingDeps as string[]).includes('count'), 'declared dep should not be in missingDeps');
  });
});

// ── customCode CodeGenerator ──────────────────────────────────────────────────

describe('CodeGenerator — customCode case', () => {
  let savedPhase5: string | undefined;
  let savedCustomCode: string | undefined;

  beforeEach(() => {
    savedPhase5 = process.env.FLOWCRAFT_PHASE5;
    savedCustomCode = process.env.FLOWCRAFT_CUSTOMCODE;
  });

  afterEach(() => {
    if (savedPhase5 === undefined) delete process.env.FLOWCRAFT_PHASE5;
    else process.env.FLOWCRAFT_PHASE5 = savedPhase5;
    if (savedCustomCode === undefined) delete process.env.FLOWCRAFT_CUSTOMCODE;
    else process.env.FLOWCRAFT_CUSTOMCODE = savedCustomCode;
  });

  test('CG-1: gate closed → SizedBox.shrink()', () => {
    delete process.env.FLOWCRAFT_PHASE5;
    delete process.env.FLOWCRAFT_CUSTOMCODE;
    const cg = new CodeGenerator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text('hello')",
              interface: { stateDeps: [], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const snap = widgetRegistry.cloneDefinitions();
    const code = cg.generate(state, snap);
    assert.ok(code.includes('SizedBox.shrink()'), 'gate closed should emit SizedBox.shrink()');
  });

  test('CG-2: gate open → Builder wrapper with dart fragment', () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    process.env.FLOWCRAFT_CUSTOMCODE = '1';
    const cg = new CodeGenerator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text('hello')",
              interface: { stateDeps: [], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const snap = widgetRegistry.cloneDefinitions();
    const code = cg.generate(state, snap);
    assert.ok(code.includes('Builder('), 'gate open should emit Builder(');
    assert.ok(code.includes("Text('hello')"), 'dart fragment should appear in output');
  });

  test('CG-3: gate open with stateDeps → deps captured in Builder closure', () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    process.env.FLOWCRAFT_CUSTOMCODE = '1';
    const cg = new CodeGenerator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        screenState: { variables: [{ name: 'count', type: 'int', initialValue: 0 }] },
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text(_count.toString())",
              interface: { stateDeps: ['count'], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const snap = widgetRegistry.cloneDefinitions();
    const code = cg.generate(state, snap);
    assert.ok(code.includes('_dep_count'), 'stateDep count should appear in Builder closure');
  });

  test('CG-4: only PHASE5=1 without CUSTOMCODE=1 → SizedBox.shrink()', () => {
    process.env.FLOWCRAFT_PHASE5 = '1';
    delete process.env.FLOWCRAFT_CUSTOMCODE;
    const cg = new CodeGenerator();
    const state = minimalState({
      screens: [{
        id: 'home', name: 'HomeScreen', route: '/',
        body: {
          type: 'customCode',
          props: {
            custom: {
              dart: "Text('hello')",
              interface: { stateDeps: [], imports: [], returns: 'Widget', inputs: ['context'] },
            },
          },
        },
      }],
    });
    const snap = widgetRegistry.cloneDefinitions();
    const code = cg.generate(state, snap);
    assert.ok(code.includes('SizedBox.shrink()'), 'double gate: only PHASE5 without CUSTOMCODE → SizedBox.shrink()');
  });
});
