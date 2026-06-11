import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StaticValidator } from '../services/verification/static-validator';
import { widgetRegistry, HARDCODED_WIDGETS } from '../services/widget-registry/registry-manager';
import { HARDCODED_NODE_TYPES } from '../services/verification/knowledge/known-widgets';
import { TEXT_CONTENT_PROP, bindingPropsFor } from '../services/codegen-shared/binding-props';
import type { VerifyContext, RegistrySnapshot } from '../services/verification/types';
import type { WidgetDefinition } from '../services/widget-registry/types';
import type { AppState } from '../models/appstate';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCtx(source: 'live' | 'import' = 'live'): VerifyContext {
  const snap = widgetRegistry.cloneDefinitions();
  return {
    registryVersion: snap.registryVersion,
    registrySnapshot: snap,
    source,
    requestId: 'test',
    attempt: 0,
  };
}

// Frozen snapshot with datePicker poison entry — C11 test fixture.
// datePicker was removed from registry.json; kept here to verify C11 detection.
function makePoisonedCtx(): VerifyContext {
  const base = widgetRegistry.cloneDefinitions();
  const poison: WidgetDefinition = {
    name: 'datePicker',
    dartWidget: 'DatePicker',     // NOT in the known-safe allowlist → C11
    category: 'input',
    props: [],
  };
  const extra = new Map<string, WidgetDefinition>([[poison.name, poison]]);
  const poisonedSnap: RegistrySnapshot = {
    values(): IterableIterator<WidgetDefinition> {
      return (function* () {
        yield* base.values();
        yield* extra.values();
      })();
    },
    hasWidget(type: string): boolean { return type === 'datePicker' || base.hasWidget(type); },
    getDefinition(type: string): WidgetDefinition | null { return extra.get(type) ?? base.getDefinition(type); },
    hardcodedWidgets: base.hardcodedWidgets,
    registryVersion: base.registryVersion + '-poison',
  };
  return {
    registryVersion: poisonedSnap.registryVersion,
    registrySnapshot: poisonedSnap,
    source: 'import',
    requestId: 'test-poison',
    attempt: 0,
  };
}

function validBase(): AppState {
  return {
    appName: 'TestApp',
    theme: { primaryColor: '#2196F3', brightness: 'light' },
    navigation: { type: 'stack', initialRoute: '/' },
    screens: [
      {
        id: 'home',
        name: 'Home',
        route: '/',
        body: { type: 'column', props: {}, children: [] },
        screenState: { variables: [] },
      },
    ],
  };
}

const validator = new StaticValidator();

// ── Lockstep test §5.4 ────────────────────────────────────────────────────

describe('lockstep', () => {
  test('HARDCODED_NODE_TYPES matches HARDCODED_WIDGETS from registry-manager', () => {
    assert.deepEqual(
      [...HARDCODED_NODE_TYPES].sort(),
      [...HARDCODED_WIDGETS].sort(),
      'HARDCODED_NODE_TYPES must equal HARDCODED_WIDGETS'
    );
  });

  test('Text binding manifest lists the prop codegen actually renders (content)', () => {
    // If wText interpolates a prop not in the manifest, the validator goes blind
    // to it — the exact drift this manifest exists to prevent.
    assert.ok(
      bindingPropsFor('text').textBindingProps.includes(TEXT_CONTENT_PROP),
      `manifest must include '${TEXT_CONTENT_PROP}' (the prop wText renders)`
    );
  });
});

// ── C1 — undeclared state var ref ─────────────────────────────────────────

describe('C1', () => {
  test('fires when text binding references undeclared var', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'text',
      props: { text: '{{count}}' },
    };
    const result = await validator.verify(state, '', makeCtx());
    const c1 = result.errors.filter(e => e.code === 'C1');
    assert.equal(c1.length, 1);
    assert.ok(c1[0].message.includes('count'));
  });

  test('no error when var is declared', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'count', type: 'int', initialValue: 0 }] };
    state.screens[0].body = { type: 'text', props: { text: '{{count}}' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C1').length, 0);
  });

  // Regression: the production binding site is props.content, not props.text.
  test('fires for undeclared var in Text content prop (the real codegen site)', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { content: '{{count}}' } };
    const result = await validator.verify(state, '', makeCtx());
    const c1 = result.errors.filter(e => e.code === 'C1');
    assert.equal(c1.length, 1, `expected one C1 for content binding, got ${result.errors.map(e => e.code).join(',')}`);
    assert.ok(c1[0].message.includes('count'));
  });
});

// ── C1-dotted — member access binding ────────────────────────────────────

describe('member access (C1)', () => {
  test('unsupported member access on a declared var is now a C1 error', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'user', type: 'string', initialValue: '' }] };
    state.screens[0].body = { type: 'text', props: { text: '{{user.name}}' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C1'), 'member access on a scalar must be a hard error');
  });

  test('error for dotted binding on undeclared var head', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { text: '{{order.total}}' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C1'), 'should emit C1 for undeclared head');
  });
});

// ── Computed bindings — .length / .isEmpty / .isNotEmpty ──────────────────────

describe('computed bindings', () => {
  test('{{list.length}} on a list var is valid (no error)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'tasks', type: 'itemList', initialValue: [], itemFields: [] }] };
    state.screens[0].body = { type: 'text', props: { content: 'You have {{tasks.length}} tasks' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C1').length, 0, `unexpected C1: ${result.errors.map(e => e.code).join(',')}`);
  });

  test('.length on a non-list/non-string var (int) is rejected as C1', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'count', type: 'int', initialValue: 0 }] };
    state.screens[0].body = { type: 'text', props: { content: '{{count.length}}' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C1'), '.length on int must be rejected');
  });
});

// ── C18 — visibleWhen ─────────────────────────────────────────────────────────

describe('C18', () => {
  test('valid visibleWhen (isNotEmpty on a list) passes', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].body = { type: 'text', props: { content: 'Has items', visibleWhen: { var: 'items', op: 'isNotEmpty' } } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C18').length, 0);
  });

  test('isTrue on a non-bool var fires C18', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].body = { type: 'text', props: { content: 'X', visibleWhen: { var: 'items', op: 'isTrue' } } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C18'), 'isTrue on a list var must be C18');
  });

  test('visibleWhen on an undeclared var fires C18', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { content: 'X', visibleWhen: { var: 'ghost', op: 'isEmpty' } } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C18'));
  });
});

// ── C2 — dangling dataSource ──────────────────────────────────────────────

describe('C2', () => {
  test('fires when listView.dataSource references missing var', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'listView',
      props: { dataSource: 'items' },
      children: [{ type: 'text', props: { text: '{{item}}' } }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C2'));
  });
});

// ── C3b — setValue / clearField no handler ───────────────────────────────

describe('C3b', () => {
  // setValue / clearField are now real inline-closure actions — no longer C3b traps.
  test('setValue with a declared target is clean (no C3b)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'status', type: 'string', initialValue: '' }] };
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Set', action: { type: 'setValue', fieldName: 'status', value: 'active' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C3b').length, 0, `unexpected C3b: ${result.errors.map(e => e.code).join(',')}`);
  });

  test('setValue with an undeclared target fires C1', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Set', action: { type: 'setValue', fieldName: 'ghost', value: 'x' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C1'), 'undeclared setValue target should be C1');
  });

  test('clearField with a declared target is clean (no C3b)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'q', type: 'string', initialValue: '' }] };
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Clear', action: { type: 'clearField', fieldName: 'q' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C3b').length, 0);
  });

  test('showSnackBar / showDialog are clean inline actions (no errors)', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'column', props: {}, children: [
        { type: 'button', props: { label: 'Toast', action: { type: 'showSnackBar', message: 'Saved' } } },
        { type: 'button', props: { label: 'Ask', action: { type: 'showDialog', message: 'Sure?' } } },
      ],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.ok, true, `unexpected errors: ${result.errors.map(e => e.code).join(',')}`);
  });

  // appBar mutation actions are now collected like body actions (Phase 2b).
  test('appBar addItem to a valid list is no longer C3b', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [
      { name: 'items', type: 'stringList', initialValue: [] },
      { name: 'q', type: 'string', initialValue: '' },
    ] };
    state.screens[0].appBar = {
      title: 'Test',
      actions: [{ icon: 'add', action: { type: 'addItem', listName: 'items', valueFrom: 'q' } }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C3b').length, 0,
      `appBar addItem should be collected, not C3b — got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('appBar removeItem is still blocked — no item scope (C4)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].appBar = {
      title: 'Test',
      actions: [{ icon: 'delete', action: { type: 'removeItem', listName: 'items' } }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C4'), 'appBar removeItem requires item scope → C4');
  });
});

// ── C15 — typed-binding / mutation target type mismatch ──────────────────────

describe('C15', () => {
  test('fires when increment targets a string var', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'name', type: 'string', initialValue: '' }] };
    state.screens[0].body = {
      type: 'button',
      props: { label: '+', action: { type: 'increment', fieldName: 'name' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C15'), `expected C15, got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('no C15 when increment targets an int var', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'count', type: 'int', initialValue: 0 }] };
    state.screens[0].body = {
      type: 'button',
      props: { label: '+', action: { type: 'increment', fieldName: 'count' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C15').length, 0);
  });

  test('fires when checkbox is bound to a non-bool var', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'qty', type: 'int', initialValue: 0 }] };
    state.screens[0].body = { type: 'checkbox', props: { boundTo: 'qty' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C15'), `expected C15, got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('no C15 when switch is bound to a bool var', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'on', type: 'bool', initialValue: false }] };
    state.screens[0].body = { type: 'switch', props: { boundTo: 'on' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C15').length, 0);
  });

  test('fires when clearFields names a non-string var', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [
        { name: 'todos', type: 'stringList', initialValue: [] },
        { name: 'text', type: 'string', initialValue: '' },
        { name: 'count', type: 'int', initialValue: 0 },
      ],
    };
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Add', action: { type: 'addItem', listName: 'todos', valueFrom: 'text', clearFields: ['text', 'count'] } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C15'), `expected C15 for clearFields int, got ${result.errors.map(e => e.code).join(',')}`);
  });
});

// ── C4 — item scope ───────────────────────────────────────────────────────

describe('C4', () => {
  test('fires when {{item}} used outside listView', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { text: '{{item}}' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C4'));
  });

  test('no C4 when {{item}} used inside dataSource listView', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].body = {
      type: 'listView',
      props: { dataSource: 'items' },
      children: [{ type: 'text', props: { text: '{{item}}' } }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C4').length, 0);
  });

  test('fires for removeItem outside item scope', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Remove', action: { type: 'removeItem', listName: 'items' } },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C4'));
  });
});

// ── C5 — unknown widget type ─────────────────────────────────────────────

describe('C5', () => {
  test('fires for unknown widget type', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'unknownWidget123', props: {} };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C5'));
  });

  test('no C5 for hardcoded widget types', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { text: 'Hello' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C5').length, 0);
  });
});

// ── C11 — datePicker poison (frozen snapshot) ─────────────────────────────
// datePicker was removed from registry.json; the test uses a manually-constructed
// snapshot to verify that C11 fires for any registry widget with a non-allowlisted
// dartWidget value. The snapshot is frozen so live registry changes don't affect it.

describe('C11', () => {
  test('fires for datePicker dartWidget=DatePicker (frozen snapshot)', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'datePicker', props: {} };
    const result = await validator.verify(state, '', makePoisonedCtx());
    // datePicker IS in poisoned snapshot (no C5), but dartWidget=DatePicker → C11
    assert.ok(
      result.errors.some(e => e.code === 'C11'),
      `Expected C11, got errors: ${result.errors.map(e => e.code).join(',')}`
    );
  });
});

// ── C6 — expanded outside flex ───────────────────────────────────────────

describe('C6', () => {
  test('fires for expanded directly under listTile (not a flex parent)', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'listTile',
      props: {},
      children: [{ type: 'expanded', props: {}, children: [{ type: 'text', props: { text: 'x' } }] }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C6'));
  });

  test('no C6 for expanded directly under column', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'column',
      props: {},
      children: [{ type: 'expanded', props: {}, children: [{ type: 'text', props: { text: 'x' } }] }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C6').length, 0);
  });
});

// ── C8 — 7-char hex color (canonical example) ────────────────────────────

describe('C8', () => {
  test('warning for 7-char hex color (codegen falls back to Colors.blue)', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'container',
      props: { color: '#abcdef0' }, // 7 chars after # → neither HEX6 nor HEX8
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.warnings.some(e => e.code === 'C8'));
  });

  test('no C8 warning for valid 6-char hex', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'container', props: { color: '#abcdef' } };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.warnings.filter(e => e.code === 'C8').length, 0);
  });
});

// ── C9 — screen name (import path) ───────────────────────────────────────

describe('C9', () => {
  test('fires for reserved word screen name (import path)', async () => {
    const state = validBase();
    state.screens[0].name = 'Switch'; // DART_CORE_COLLISIONS
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.ok(result.errors.some(e => e.code === 'C9'));
  });
});

// ── C10 — invalid state var identifier ───────────────────────────────────

describe('C10', () => {
  test('fires when var name starts with a digit (produces invalid Dart identifier)', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [{ name: '1count', type: 'int', initialValue: 0 }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(
      result.errors.some(e => e.code === 'C10'),
      `Expected C10, got: ${result.errors.map(e => e.code).join(',')}`
    );
  });

  test('no C10 for valid var name', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [{ name: 'count', type: 'int', initialValue: 0 }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C10').length, 0);
  });
});

// ── C12 — duplicate screen identifiers ───────────────────────────────────

describe('C12', () => {
  test('fires for duplicate screen names', async () => {
    const state = validBase();
    state.screens.push({
      id: 'settings',
      name: 'Home',           // same name as first screen
      route: '/settings',
      body: { type: 'column', props: {}, children: [] },
      screenState: { variables: [] },
    });
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(
      result.errors.some(e => e.code === 'C12'),
      `Expected C12, got: ${result.errors.map(e => e.code).join(',')}`
    );
  });

  test('fires for duplicate screen routes', async () => {
    const state = validBase();
    state.screens.push({
      id: 'settings',
      name: 'Settings',
      route: '/',              // same route as first screen
      body: { type: 'column', props: {}, children: [] },
      screenState: { variables: [] },
    });
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(
      result.errors.some(e => e.code === 'C12'),
      `Expected C12, got: ${result.errors.map(e => e.code).join(',')}`
    );
  });

  test('no C12 for unique screen names and routes', async () => {
    const state = validBase();
    state.screens.push({
      id: 'settings',
      name: 'Settings',
      route: '/settings',
      body: { type: 'column', props: {}, children: [] },
      screenState: { variables: [] },
    });
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C12').length, 0);
  });
});

// ── C3-navigate — import path allows navigate without error ───────────────
// On live path, navigate actions are stripped by structureAgent before validation.
// On import path, they survive; the validator should NOT emit C3 for navigate.

describe('C3-navigate', () => {
  test('navigate to a resolvable route produces no C3/C16', async () => {
    const state = validBase();
    state.screens.push({
      id: 'other', name: 'Other', route: '/other',
      body: { type: 'column', props: {}, children: [] }, screenState: { variables: [] },
    });
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Go', action: { type: 'navigate', target: '/other' } },
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.equal(
      result.errors.filter(e => ['C3', 'C3a', 'C16'].includes(e.code)).length, 0,
      'navigate to an existing route must not error',
    );
  });
});

// ── C9 (tabs) — tab item screenId integrity ──────────────────────────────────

describe('C9 tabs', () => {
  test('fires when a tabs item screenId matches no screen', async () => {
    const state = validBase();
    state.navigation = {
      type: 'tabs', initialRoute: '/',
      bottomNavItems: [{ icon: 'home', label: 'Home', screenId: 'ghost' }],
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.ok(result.errors.some(e => e.code === 'C9'), `expected C9, got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('no C9 when tabs items resolve to real screens', async () => {
    const state = validBase();
    state.navigation = {
      type: 'tabs', initialRoute: '/',
      bottomNavItems: [{ icon: 'home', label: 'Home', screenId: 'home' }],
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.equal(result.errors.filter(e => e.code === 'C9').length, 0);
  });
});

// ── C17 — seeded itemList value vs declared field type ───────────────────────

describe('C17', () => {
  test('fires when a seeded value mismatches its declared field type', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [{
        name: 'rows', type: 'itemList',
        itemFields: [{ name: 'qty', type: 'int' }],
        initialValue: [{ qty: 'not-a-number' }],
      }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C17'), `expected C17, got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('no C17 when seeded values match declared field types', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [{
        name: 'rows', type: 'itemList',
        itemFields: [{ name: 'qty', type: 'int' }, { name: 'done', type: 'bool' }],
        initialValue: [{ qty: 2, done: true }, { qty: 5, done: false }],
      }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.errors.filter(e => e.code === 'C17').length, 0);
  });
});

// ── C16 — navigate target resolution ─────────────────────────────────────────

describe('C16', () => {
  test('fires when navigate target matches no screen id or route', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Go', action: { type: 'navigate', target: '/ghost' } },
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.ok(result.errors.some(e => e.code === 'C16'), `expected C16, got ${result.errors.map(e => e.code).join(',')}`);
  });

  test('resolves a bare screenId to its route (no C16)', async () => {
    const state = validBase();
    state.screens.push({
      id: 'detail', name: 'Detail', route: '/detail-page',
      body: { type: 'column', props: {}, children: [] }, screenState: { variables: [] },
    });
    state.screens[0].body = {
      type: 'button',
      props: { label: 'Go', action: { type: 'navigate', target: 'detail' } },
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.equal(result.errors.filter(e => e.code === 'C16').length, 0);
  });
});

// ── W-leading — phantom site ─────────────────────────────────────────────

describe('W-leading', () => {
  test('warning when appBar.leading is present', async () => {
    const state = validBase();
    state.screens[0].appBar = {
      title: 'Test',
      leading: { icon: 'arrow_back' },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.warnings.some(e => e.code === 'W-leading'));
  });
});

// ── happy path ───────────────────────────────────────────────────────────

describe('happy path', () => {
  test('valid AppState returns ok=true with no errors', async () => {
    const state = validBase();
    state.screens[0].screenState = {
      variables: [
        { name: 'count', type: 'int', initialValue: 0 },
        { name: 'items', type: 'stringList', initialValue: [] },
      ],
    };
    state.screens[0].body = {
      type: 'column',
      props: {},
      children: [
        { type: 'text', props: { text: '{{count}}' } },
        {
          type: 'button',
          props: {
            label: 'Increment',
            action: { type: 'increment', fieldName: 'count' },
          },
        },
      ],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.map(e => `${e.code}: ${e.message}`).join('; ')}`);
  });
});
