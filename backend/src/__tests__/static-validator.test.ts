import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StaticValidator } from '../services/verification/static-validator';
import { widgetRegistry, HARDCODED_WIDGETS } from '../services/widget-registry/registry-manager';
import { HARDCODED_NODE_TYPES } from '../services/verification/knowledge/known-widgets';
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
});

// ── C1-dotted — member access binding ────────────────────────────────────

describe('C1-dotted', () => {
  test('warning for dotted binding on declared var', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'user', type: 'string', initialValue: '' }] };
    state.screens[0].body = { type: 'text', props: { text: '{{user.name}}' } };
    const result = await validator.verify(state, '', makeCtx());
    const dotted = result.warnings.filter(e => e.code === 'C1-dotted');
    assert.equal(dotted.length, 1);
  });

  test('error for dotted binding on undeclared var head', async () => {
    const state = validBase();
    state.screens[0].body = { type: 'text', props: { text: '{{order.total}}' } };
    const result = await validator.verify(state, '', makeCtx());
    const c1 = result.errors.filter(e => e.code === 'C1');
    assert.ok(c1.length > 0, 'should emit C1 for undeclared head');
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
  test('fires for setValue action (no generateActionHandlers branch)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'q', type: 'string', initialValue: '' }] };
    state.screens[0].body = {
      type: 'button',
      props: {
        label: 'Reset',
        action: { type: 'setValue', fieldName: 'q', valueFrom: '' },
      },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C3b'), 'should flag setValue as C3b');
  });

  test('fires for clearField action', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'q', type: 'string', initialValue: '' }] };
    state.screens[0].body = {
      type: 'button',
      props: {
        label: 'Clear',
        action: { type: 'clearField', fieldName: 'q' },
      },
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C3b'));
  });

  test('fires for appBar action (collectActions never visits appBar)', async () => {
    const state = validBase();
    state.screens[0].screenState = { variables: [{ name: 'items', type: 'stringList', initialValue: [] }] };
    state.screens[0].appBar = {
      title: 'Test',
      actions: [{ icon: 'add', action: { type: 'addItem', listName: 'items', valueFrom: 'q' } }],
    };
    const result = await validator.verify(state, '', makeCtx());
    assert.ok(result.errors.some(e => e.code === 'C3b'), 'appBar addItem should be C3b');
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
  test('navigate action on import path does not fire C3 (import-only path)', async () => {
    const state = validBase();
    state.screens[0].body = {
      type: 'button',
      props: {
        label: 'Go',
        action: { type: 'navigate', target: '/other' },
      },
    };
    const result = await validator.verify(state, '', makeCtx('import'));
    assert.equal(
      result.errors.filter(e => e.code === 'C3' || e.code === 'C3a').length,
      0,
      'navigate action must not produce C3 on import path'
    );
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
