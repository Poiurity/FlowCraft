// Golden regression suite for the Phase 0 compile-guarantee fixes.
// Each test pins a previously-shipping bug where Layer A passed (or codegen
// emitted) uncompilable / visibly-wrong Dart on the most common widget (Text).
// Substring-level assertions need no Dart compiler, so they run in default CI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StaticValidator } from '../services/verification/static-validator';
import { CodeGenerator } from '../services/code-generator';
import { widgetRegistry } from '../services/widget-registry/registry-manager';
import type { AppState } from '../models/appstate';
import type { VerifyContext } from '../services/verification/types';

function ctx(): VerifyContext {
  const snap = widgetRegistry.cloneDefinitions();
  return { registryVersion: snap.registryVersion, registrySnapshot: snap, source: 'live', requestId: 'golden', attempt: 0 };
}

function appWith(body: any, vars: any[] = []): AppState {
  return {
    appName: 'Golden',
    theme: { primaryColor: '#2196F3', brightness: 'light' },
    navigation: { type: 'stack', initialRoute: '/' },
    screens: [{ id: 'home', name: 'Home', route: '/', body, screenState: { variables: vars } }],
  } as AppState;
}

function gen(state: AppState): string {
  return new CodeGenerator().generate(state, widgetRegistry.cloneDefinitions());
}

const validator = new StaticValidator();

// ── 1) props.content blind spot ──────────────────────────────────────────────
describe('golden: Text content binding is validated', () => {
  test('undeclared {{var}} in Text content fires C1 (was: passed, then compile error)', async () => {
    const state = appWith({ type: 'text', props: { content: '{{missingVar}}' } });
    const result = await validator.verify(state, '', ctx());
    assert.ok(
      result.errors.some(e => e.code === 'C1'),
      `expected C1 for content binding, got ${result.errors.map(e => e.code).join(',')}`,
    );
  });

  test('declared {{var}} in Text content is clean', async () => {
    const state = appWith({ type: 'text', props: { content: '{{count}}' } }, [{ name: 'count', type: 'int', initialValue: 0 }]);
    const result = await validator.verify(state, '', ctx());
    assert.equal(result.errors.filter(e => e.code === 'C1').length, 0);
  });
});

// ── 2) esc('$') over-escaping ─────────────────────────────────────────────────
describe('golden: currency text is single-escaped', () => {
  test("literal '$' becomes '\\$', never a triple-backslash", () => {
    const code = gen(appWith({ type: 'text', props: { content: 'Total: $5.00' } }));
    assert.ok(code.includes('Total: \\$5.00'), 'price should be single-escaped \\$');
    assert.ok(!code.includes('\\\\\\$'), 'must not emit the over-escaped triple-backslash $');
  });
});

// ── 3) literal escaping inside a bound string ────────────────────────────────
describe('golden: bound Text escapes its literal segments', () => {
  test("apostrophe in bound content is escaped and the binding still interpolates", () => {
    const code = gen(appWith(
      { type: 'text', props: { content: "It's {{count}}" } },
      [{ name: 'count', type: 'int', initialValue: 0 }],
    ));
    assert.ok(code.includes("It\\'s "), 'apostrophe in the literal segment must be escaped');
    assert.ok(code.includes('${_count}'), 'binding segment must still interpolate');
    assert.ok(!code.includes("'It's "), 'must not emit an unescaped apostrophe that terminates the string');
  });
});

// ── 5) setValue / clearField are real actions (inline closures) ──────────────
describe('golden: setValue / clearField generate working inline closures', () => {
  test('setValue with a literal emits a setState assignment, coerced to the var type', () => {
    const code = gen(appWith(
      { type: 'button', props: { label: 'Activate', action: { type: 'setValue', fieldName: 'status', value: 'active' } } },
      [{ name: 'status', type: 'string', initialValue: '' }],
    ));
    assert.ok(code.includes("setState(() => _status = 'active')"), `expected inline setState assignment, got: ${code.split('\n').filter(l => l.includes('status')).join(' | ')}`);
    assert.ok(!code.includes('_setValue'), 'must not reference an undeclared _setValue method');
  });

  test('clearField resets a string field and its controller', () => {
    const code = gen(appWith(
      { type: 'button', props: { label: 'Clear', action: { type: 'clearField', fieldName: 'q' } } },
      [{ name: 'q', type: 'string', initialValue: '' }],
    ));
    assert.ok(code.includes("_q = ''"), 'should reset the string var');
    assert.ok(code.includes('_qController.clear()'), 'should clear the controller');
    assert.ok(!code.includes('_clearField'), 'must not reference an undeclared _clearField method');
  });
});

// ── 6) navigate resolves screenId → its real route ───────────────────────────
describe('golden: navigate resolves through the shared resolver', () => {
  test('a bare screenId navigates to that screen\'s actual route, not "/" + id', () => {
    const state: AppState = {
      appName: 'Nav', theme: { primaryColor: '#2196F3', brightness: 'light' },
      navigation: { type: 'stack', initialRoute: '/' },
      screens: [
        { id: 'home', name: 'Home', route: '/', screenState: { variables: [] },
          body: { type: 'button', props: { label: 'Go', action: { type: 'navigate', target: 'detail' } } } },
        { id: 'detail', name: 'Detail', route: '/detail-page', screenState: { variables: [] },
          body: { type: 'column', props: {}, children: [] } },
      ],
    } as AppState;
    const code = gen(state);
    assert.ok(code.includes("Navigator.pushNamed(context, '/detail-page')"), `expected resolved route, got: ${code.split('\n').filter(l => l.includes('pushNamed')).join(' | ')}`);
    assert.ok(!code.includes("pushNamed(context, '/detail')"), 'must not emit the naive "/" + id route');
  });

  test('an unresolvable target emits the flaggable sentinel route', () => {
    const code = gen(appWith({ type: 'button', props: { label: 'X', action: { type: 'navigate', target: 'nowhere' } } }));
    assert.ok(code.includes("pushNamed(context, '/__unresolved__')"), 'unresolvable nav should emit the sentinel');
  });
});

// ── 8) seeded lists render populated (initialValue honored, type-coerced) ─────
describe('golden: seeded lists', () => {
  test('stringList initialValue emits a populated, escaped literal', () => {
    const code = gen(appWith({ type: 'column', props: {}, children: [] },
      [{ name: 'tags', type: 'stringList', initialValue: ['a', "b's", '$c'] }]));
    assert.ok(code.includes("final List<String> _tags = ['a', 'b\\'s', '\\$c']"), `got: ${code.split('\n').find(l => l.includes('_tags'))}`);
  });

  test('itemList initialValue emits rows with values coerced to declared field types', () => {
    const code = gen(appWith({ type: 'column', props: {}, children: [] },
      [{ name: 'products', type: 'itemList',
         itemFields: [{ name: 'title', type: 'string' }, { name: 'price', type: 'double' }, { name: 'sale', type: 'bool' }],
         initialValue: [{ title: 'Pen', price: '3', sale: 'true' }] }]));
    const line = code.split('\n').find(l => l.includes('_products')) ?? '';
    assert.ok(line.includes("'title': 'Pen'"), `string field: ${line}`);
    assert.ok(line.includes("'price': 3.0"), `double coercion: ${line}`);
    assert.ok(line.includes("'sale': true"), `bool coercion: ${line}`);
  });
});

// ── 10) dialog / snackbar actions ────────────────────────────────────────────
describe('golden: dialog / snackbar actions', () => {
  test('showSnackBar lowers to a ScaffoldMessenger snackbar', () => {
    const code = gen(appWith({ type: 'button', props: { label: 'Save', action: { type: 'showSnackBar', message: "Saved! It's done" } } }));
    assert.ok(code.includes("ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Saved! It\\'s done')))"), `got: ${code.split('\n').find(l => l.includes('SnackBar'))}`);
  });

  test('showDialog lowers to an AlertDialog with an OK button', () => {
    const code = gen(appWith({ type: 'button', props: { label: 'Info', action: { type: 'showDialog', title: 'Heads up', message: 'Are you sure?' } } }));
    const line = code.split('\n').find(l => l.includes('AlertDialog')) ?? '';
    assert.ok(line.includes("showDialog(context: context"), 'must call showDialog');
    assert.ok(line.includes("title: Text('Heads up')"), 'dialog title');
    assert.ok(line.includes("content: Text('Are you sure?')"), 'dialog content');
    assert.ok(line.includes('Navigator.pop(ctx)'), 'OK button dismisses');
  });
});

// ── 9) computed bindings + visibleWhen lower to real Dart ────────────────────
describe('golden: computed bindings + visibleWhen', () => {
  test('{{list.length}} lowers to _list.length interpolation', () => {
    const code = gen(appWith({ type: 'text', props: { content: '{{tasks.length}} left' } },
      [{ name: 'tasks', type: 'itemList', initialValue: [], itemFields: [] }]));
    assert.ok(code.includes('${_tasks.length}'), `got: ${code.split('\n').find(l => l.includes('tasks.length')) ?? code.split('\n').find(l => l.includes('left'))}`);
  });

  test('visibleWhen wraps the node in a Visibility with the lowered predicate', () => {
    const code = gen(appWith(
      { type: 'column', props: {}, children: [
        { type: 'text', props: { content: 'No items yet', visibleWhen: { var: 'items', op: 'isEmpty' } } },
      ] },
      [{ name: 'items', type: 'stringList', initialValue: [] }]));
    assert.ok(code.includes('Visibility('), 'must wrap in Visibility');
    assert.ok(code.includes('visible: _items.isEmpty'), `predicate not lowered: ${code.split('\n').filter(l => l.includes('visible')).join(' | ')}`);
  });
});

// ── 7) tabs navigation is actually generated (was silently degraded to stack) ──
describe('golden: tabs navigation builds a real TabBar', () => {
  test('navigation.type "tabs" emits DefaultTabController + TabBar + TabBarView', () => {
    const state: AppState = {
      appName: 'Tabbed', theme: { primaryColor: '#2196F3', brightness: 'light' },
      navigation: {
        type: 'tabs', initialRoute: '/',
        bottomNavItems: [
          { icon: 'home', label: 'Home', screenId: 'home' },
          { icon: 'settings', label: 'Settings', screenId: 'settings' },
        ],
      },
      screens: [
        { id: 'home', name: 'Home', route: '/', screenState: { variables: [] }, body: { type: 'column', props: {}, children: [] } },
        { id: 'settings', name: 'Settings', route: '/settings', screenState: { variables: [] }, body: { type: 'column', props: {}, children: [] } },
      ],
    } as AppState;
    const code = gen(state);
    assert.ok(code.includes('DefaultTabController('), 'must use DefaultTabController');
    assert.ok(code.includes('length: 2'), 'controller length must match item count');
    assert.ok(code.includes('TabBar(tabs: ['), 'must build a TabBar');
    assert.ok(code.includes('TabBarView(children: ['), 'must build a TabBarView');
    assert.ok(code.includes('home: const MainNavigation()'), 'app must route to MainNavigation, not a plain routes table');
  });
});

// ── 4) duplicate `style:` arg ─────────────────────────────────────────────────
describe('golden: style + conditionalDecoration emit one style arg', () => {
  test('a styled, strikethrough-on-done list item has exactly one style: TextStyle(', () => {
    const body = {
      type: 'listView',
      props: { dataSource: 'todos' },
      children: [{
        type: 'text',
        props: { content: '{{item.title}}', style: { fontSize: 16 }, conditionalDecoration: { field: 'done' } },
      }],
    };
    const code = gen(appWith(body, [{
      name: 'todos', type: 'itemList', initialValue: [],
      itemFields: [{ name: 'title', type: 'string' }, { name: 'done', type: 'bool' }],
    }]));
    const styleCount = (code.match(/style: TextStyle\(/g) || []).length;
    assert.equal(styleCount, 1, `expected exactly one 'style: TextStyle(' arg, found ${styleCount}`);
    assert.ok(code.includes('TextDecoration.lineThrough'), 'conditional decoration must be present');
    assert.ok(code.includes('fontSize: r(16)'), 'static fontSize must be folded into the single TextStyle');
  });
});
