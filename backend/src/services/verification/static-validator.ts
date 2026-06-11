// Layer A — StaticValidator: pure TypeScript, no Dart SDK required.
// Single-pass DFS over the post-sanitize AppState with a scope frame.
// C1–C14 + C1-dotted + C3b-collision. See CLOSED_LOOP_DESIGN.md §1.2.

import type { AppState, Screen, StateVariable, WidgetNode, Action } from '../../models/appstate';
import type { Verifier, VerifyContext, AnalyzeResult, ValidationError, SourceLocation } from './types';
import { buildCacheKey } from './verification-cache';
import { HARDCODED_NODE_TYPES, KNOWN_FLUTTER_WIDGETS } from './knowledge/known-widgets';
import { ALL_RESERVED, DART_RESERVED } from './knowledge/dart-reserved';
import { colorIsPlausible } from '../codegen-shared/color-table';
import { KNOWN_ICONS } from '../codegen-shared/known-icons';
import { nearestKnown } from '../codegen-shared/nearest';
import { expandedIsValid } from '../codegen-shared/flex-rules';
import { bindingPropsFor, HARDCODED_BIND_TYPES, isIncrementable, isClearable } from '../codegen-shared/binding-props';
import { resolveNavRoute, buildScreenIdToRoute, NAV_UNRESOLVED } from '../codegen-shared/nav-resolve';
import { resolveComputed, resolveVisibleWhen } from '../codegen-shared/expr';
import {
  collectActions,
  actionMethodName,
  declaredHandlerMethods,
} from '../codegen-shared/action-naming';

// ── Frame ──────────────────────────────────────────────────────────────────

interface Frame {
  screen: Screen;
  screenIdx: number;
  varNames: Set<string>;
  varByName: Map<string, StateVariable>;
  inItemScope: boolean;
  dataSourceList: string | null;
  itemFields: Set<string> | null;
  declaredHandlers: Set<string>;
  handlerCollisions: Set<string>;
  nodePath: string;
  parentType: string | null;
  screenIdToRoute: Map<string, string>;   // for navigate target resolution (C16)
}

// ── StaticValidator ────────────────────────────────────────────────────────

export class StaticValidator implements Verifier {
  isAvailable(): boolean { return true; }

  async verify(appState: AppState, code: string, ctx: VerifyContext): Promise<AnalyzeResult> {
    const t0 = Date.now();
    const cacheKey = buildCacheKey(appState, ctx.registryVersion);

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const emit = (e: ValidationError) => {
      if (e.severity === 'error') errors.push(e);
      else warnings.push(e);
    };

    // C12 — duplicate screen identifiers (multi-screen / import path)
    const screenIds = new Set<string>();
    const screenRoutes = new Set<string>();
    const screenNames = new Set<string>();
    for (const screen of appState.screens ?? []) {
      if (screenIds.has(screen.id)) {
        emit(err('C12', `Duplicate screen id '${screen.id}'`, 'static', {}));
      }
      screenIds.add(screen.id);
      if (screenRoutes.has(screen.route)) {
        emit(err('C12', `Duplicate screen route '${screen.route}'`, 'static', {}));
      }
      screenRoutes.add(screen.route);
      if (screenNames.has(screen.name)) {
        emit(err('C12', `Duplicate screen name '${screen.name}'`, 'static', {}));
      }
      screenNames.add(screen.name);
    }

    for (let si = 0; si < (appState.screens ?? []).length; si++) {
      this.validateScreen(appState.screens[si], si, appState, ctx, emit);
    }

    // C9 — navigation integrity (import-primary; live path strips these).
    // tabs and bottomNav share the bottomNavItems shape and the same codegen
    // entry point (MainNavigation), so they validate identically.
    if (appState.navigation?.type === 'bottomNav' || appState.navigation?.type === 'tabs') {
      const navType = appState.navigation.type;
      const items = appState.navigation.bottomNavItems ?? [];
      for (const item of items) {
        if (!screenIds.has(item.screenId)) {
          emit(err('C9', `${navType} item screenId '${item.screenId}' does not match any screen id`,
            'static', { problem: 'unknownScreenId', value: item.screenId, navType, availableScreenIds: [...screenIds] }));
        }
      }
    }

    const result: AnalyzeResult = {
      ok: errors.length === 0,
      errors,
      warnings,
      source: 'static',
      cacheKey,
      fromCache: false,
      durationMs: Date.now() - t0,
    };
    return result;
  }

  // ── Per-screen ────────────────────────────────────────────────────────────

  private validateScreen(
    screen: Screen,
    si: number,
    appState: AppState,
    ctx: VerifyContext,
    emit: (e: ValidationError) => void,
  ): void {
    const vars: StateVariable[] = screen.screenState?.variables ?? [];
    const varNames = new Set(vars.map(v => v.name));
    const varByName = new Map(vars.map(v => [v.name, v]));

    // C9 — PascalCase screen name (import-only on live path due to sanitizeScreens)
    if (screen.name && !/^[A-Za-z][A-Za-z0-9]*$/.test(screen.name)) {
      emit(err('C9', `Screen name '${screen.name}' must match ^[A-Za-z][A-Za-z0-9]*$`,
        'static', { problem: 'invalidScreenName', value: screen.name },
        { screenId: screen.id, screenIdx: si }));
    }
    // C9 — reserved-word collision
    if (screen.name && ALL_RESERVED.has(screen.name)) {
      emit(err('C9', `Screen name '${screen.name}' shadows a Dart/Flutter reserved identifier`,
        'static', { problem: 'reservedIdentifier', value: screen.name },
        { screenId: screen.id, screenIdx: si }));
    }

    // C10 — state variable identifiers
    for (let vi = 0; vi < vars.length; vi++) {
      const v = vars[vi];
      const ident = `_${v.name}`;
      if (!/^_[A-Za-z][A-Za-z0-9_]*$/.test(ident)) {
        emit(err('C10', `State var '${v.name}' produces invalid Dart identifier '${ident}'`,
          'static', { identifier: v.name, kind: 'stateVar', problem: 'invalidIdentifier' },
          { screenId: screen.id, screenIdx: si, nodePath: `screens[${si}].screenState.variables[${vi}]` }));
      }
      // Note: DART_RESERVED does NOT bite _-prefixed vars (they are valid Dart identifiers)

      // C17 — seeded itemList values must be cast-compatible with declared fields
      if (v.type === 'itemList' && Array.isArray(v.initialValue) && v.initialValue.length > 0) {
        const fields = new Map((v.itemFields ?? []).map(f => [f.name, f.type]));
        for (const row of v.initialValue) {
          if (!row || typeof row !== 'object') continue;
          for (const [k, val] of Object.entries(row)) {
            const ft = fields.get(k);
            if (ft && !seedValueMatches(ft, val)) {
              emit(err('C17', `Seeded field '${k}' of list '${v.name}' (${JSON.stringify(val)}) is not a valid '${ft}' — the generated item would fail its Dart cast`,
                'static', { listName: v.name, fieldName: k, declaredType: ft, problem: 'seedTypeMismatch' },
                { screenId: screen.id, screenIdx: si, nodePath: `screens[${si}].screenState.variables[${vi}]` }));
            }
          }
        }
      }
    }

    // Pre-pass: build handler oracle (§6.0.5)
    const { declared: declaredHandlers, collisions: handlerCollisions } =
      declaredHandlerMethods(screen, vars);

    const frame: Frame = {
      screen,
      screenIdx: si,
      varNames,
      varByName,
      inItemScope: false,
      dataSourceList: null,
      itemFields: null,
      declaredHandlers,
      handlerCollisions,
      nodePath: `screens[${si}].body`,
      parentType: null,
      screenIdToRoute: buildScreenIdToRoute(appState.screens),
    };

    this.walk(screen.body, frame, ctx, emit);

    // appBar actions now flow through the normal checkAction path (their handlers
    // are collected by collectScreenActions). Index-required actions are blocked
    // there via C4 (no item scope outside a listView).
    if (screen.appBar?.actions) {
      for (let ai = 0; ai < screen.appBar.actions.length; ai++) {
        const a = screen.appBar.actions[ai].action;
        if (!a || a.type === 'none') continue;
        this.checkAction(a, frame, `screens[${si}].appBar.actions[${ai}].action`, emit);
      }
    }

    // fab.action
    if (screen.fab?.action) {
      const a = screen.fab.action;
      const path = `screens[${si}].fab.action`;
      this.checkAction(a, frame, path, emit);
    }

    // C3b-collision — duplicate method names
    for (const name of handlerCollisions) {
      emit(err('C3b-collision', `Duplicate Dart method '${name}' would be emitted`,
        'static', { problem: 'collision', methodName: name },
        { screenId: screen.id, screenIdx: si }));
    }

    // W-leading — phantom site
    if (screen.appBar?.leading) {
      emit(warn('W-leading', 'appBar.leading is ignored by codegen; remove it.',
        'static', {},
        { screenId: screen.id, screenIdx: si, nodePath: `screens[${si}].appBar.leading` }));
    }
  }

  // ── Single-pass DFS ───────────────────────────────────────────────────────

  private walk(
    node: WidgetNode,
    frame: Frame,
    ctx: VerifyContext,
    emit: (e: ValidationError) => void,
  ): void {
    const loc: SourceLocation = {
      screenId: frame.screen.id,
      screenIdx: frame.screenIdx,
      nodePath: frame.nodePath,
    };

    // customCode (Phase 5): handle before C5 so it is never treated as unknown
    if (node.type === 'customCode') {
      this.checkCustomCode(node, frame, loc, emit);
      this.walkChildrenOnly(node, frame, ctx, emit);
      return;
    }

    // C5 — unknown widget type
    const { registrySnapshot: snap } = ctx;
    const isRenderable = (t: string) =>
      HARDCODED_NODE_TYPES.has(t) || snap.getDefinition(t) !== null;

    if (!isRenderable(node.type)) {
      const allKnown = [
        ...HARDCODED_NODE_TYPES,
        ...Array.from(snap.values()).map(d => d.name),
      ];
      emit(err('C5', `Unknown widget type '${node.type}' — codegen silently emits SizedBox.shrink()`,
        'static',
        { unknownType: node.type, renderedAs: 'SizedBox.shrink', suggestion: nearestKnown(node.type, allKnown) },
        loc));
      // Skip C7/C8/C11 on unknown node
      this.walkChildrenOnly(node, frame, ctx, emit);
      return;
    }

    // C11 — dartWidget not on allowlist (registry widgets only)
    if (!HARDCODED_NODE_TYPES.has(node.type)) {
      const def = snap.getDefinition(node.type);
      if (def && !KNOWN_FLUTTER_WIDGETS.has(def.dartWidget)) {
        emit(err('C11', `Registry widget '${node.type}' maps to dartWidget '${def.dartWidget}' which is not a known Flutter class`,
          'static',
          { defName: def.name, dartWidget: def.dartWidget, problem: 'notAKnownFlutterWidget', allowlistVersion: 'v1' },
          loc));
      }

      // C7 — malformed registry definition
      if (def) {
        this.checkC7(def, loc, emit);
        // C8 — prop-value plausibility for registry widgets
        this.checkC8Registry(def, node, loc, emit);
      }
    }

    // C6 — expanded/spacer in wrong parent
    if ((node.type === 'expanded' || node.type === 'spacer') && frame.parentType !== null) {
      if (!expandedIsValid(frame.parentType, node.type)) {
        emit(err('C6', `'${node.type}' is not a valid child of '${frame.parentType}' — Expanded requires a Flex parent`,
          'static', { problem: 'expandedOutsideFlex', parentType: frame.parentType },
          loc));
      }
    }

    // C2 — listView.dataSource references missing or wrong-type var
    if (node.type === 'listView' && typeof node.props?.dataSource === 'string') {
      this.checkListRef(node.props.dataSource, ['stringList', 'itemList'], frame, loc, emit, 'C2');
    }

    // C6 — listView with dataSource but no template
    if (node.type === 'listView' && node.props?.dataSource) {
      const hasTemplate = node.props.itemBuilder || (node.children && node.children.length > 0);
      if (!hasTemplate) {
        emit(err('C6', `listView has dataSource '${node.props.dataSource}' but no itemBuilder or children`,
          'static', { problem: 'listViewNoTemplate', dataSource: node.props.dataSource },
          loc));
      }
    }

    // Validate bindings on this node. Resolve the expected boundTo type from the
    // hardcoded table or the registry widget's stateBinding (C15).
    let boundExpectedTypes: string[] | undefined = HARDCODED_BIND_TYPES[node.type];
    if (!boundExpectedTypes && !HARDCODED_NODE_TYPES.has(node.type)) {
      const bDef = snap.getDefinition(node.type);
      if (bDef?.stateBinding?.stateType) boundExpectedTypes = [bDef.stateBinding.stateType];
    }
    this.validateBindings(node, frame, loc, emit, boundExpectedTypes);

    // Determine child frame (item scope)
    let childFrame = frame;
    if (node.type === 'listView' && node.props?.dataSource) {
      const dsName: string = node.props.dataSource;
      const dsVar = frame.varByName.get(dsName);
      const iFields = this.computeItemFields(frame.screen, frame.varNames, dsName, dsVar);
      childFrame = {
        ...frame,
        inItemScope: true,
        dataSourceList: dsName,
        itemFields: iFields,
        parentType: node.type,
      };
    } else if (node.type === 'listView') {
      childFrame = { ...frame, inItemScope: false, dataSourceList: null, itemFields: null, parentType: node.type };
    } else {
      childFrame = { ...frame, parentType: node.type };
    }

    // Walk props-embedded WidgetNodes (skip itemBuilder — handled separately)
    for (const [k, v] of Object.entries(node.props ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isWidgetNode(v)) continue;
      if (node.type === 'listView' && k === 'itemBuilder') continue; // handled below
      const childPath = `${frame.nodePath}.props.${k}`;
      this.walk(v as WidgetNode, { ...childFrame, nodePath: childPath }, ctx, emit);
    }

    // Walk listView template
    if (node.type === 'listView' && node.props?.dataSource) {
      if (node.props.itemBuilder && isWidgetNode(node.props.itemBuilder)) {
        const childPath = `${frame.nodePath}.props.itemBuilder`;
        this.walk(node.props.itemBuilder as WidgetNode, { ...childFrame, nodePath: childPath }, ctx, emit);
      } else if (node.children?.[0]) {
        const childPath = `${frame.nodePath}.children[0]`;
        this.walk(node.children[0], { ...childFrame, nodePath: childPath }, ctx, emit);
      }
    } else {
      for (let i = 0; i < (node.children ?? []).length; i++) {
        const childPath = `${frame.nodePath}.children[${i}]`;
        this.walk(node.children![i], { ...childFrame, nodePath: childPath }, ctx, emit);
      }
    }
  }

  private walkChildrenOnly(
    node: WidgetNode,
    frame: Frame,
    ctx: VerifyContext,
    emit: (e: ValidationError) => void,
  ): void {
    const childFrame = { ...frame, parentType: node.type };
    for (const [k, v] of Object.entries(node.props ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isWidgetNode(v)) continue;
      this.walk(v as WidgetNode, { ...childFrame, nodePath: `${frame.nodePath}.props.${k}` }, ctx, emit);
    }
    for (let i = 0; i < (node.children ?? []).length; i++) {
      this.walk(node.children![i], { ...childFrame, nodePath: `${frame.nodePath}.children[${i}]` }, ctx, emit);
    }
  }

  // ── Binding validation (C1, C1-dotted, C2, C3, C4) ───────────────────────

  private validateBindings(
    node: WidgetNode,
    frame: Frame,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
    boundExpectedTypes?: string[],
  ): void {
    const p = node.props ?? {};

    // Binding cascade (§6.0.4). The bindable-prop set is driven by the shared
    // manifest so the validator inspects exactly the props codegen interpolates
    // (notably `content` for Text) and the two layers cannot drift.
    const bindSpec = bindingPropsFor(node.type);
    for (const key of bindSpec.textBindingProps) {
      if (typeof p[key] === 'string') {
        this.checkTextBinding(p[key], frame, loc, emit);
      }
    }
    for (const key of bindSpec.varRefProps) {
      if (typeof p[key] === 'string') {
        this.checkVarRef(p[key], key, frame, loc, emit);
        // C15 — boundTo state-var type must match the widget's expected bind type
        if (key === 'boundTo' && boundExpectedTypes) {
          const v = frame.varByName.get(p[key]);
          if (v && !boundExpectedTypes.includes(v.type)) {
            emit(err('C15', `Widget '${node.type}' is bound to '${p[key]}' (type '${v.type}'), but it requires ${boundExpectedTypes.join('|')} — the generated binding would be a Dart type error`,
              'static',
              { nodeType: node.type, boundTo: p[key], varType: v.type, expectedTypes: boundExpectedTypes, problem: 'bindTypeMismatch' },
              loc));
          }
        }
      }
    }

    // C18 — visibleWhen predicate must resolve (declared var + op compatible type)
    if (p.visibleWhen) {
      const lookup = (n: string) => frame.varByName.get(n)?.type;
      if (!resolveVisibleWhen(p.visibleWhen, lookup)) {
        const vwVar = p.visibleWhen?.var;
        if (typeof vwVar === 'string' && !frame.varNames.has(vwVar)) {
          emit(err('C18', `visibleWhen references undeclared var '${vwVar}'`,
            'static', { problem: 'visibleWhenUndeclared', varName: vwVar }, loc));
        } else {
          emit(err('C18', `visibleWhen op '${p.visibleWhen?.op}' is not valid for var '${vwVar}' — use isEmpty/isNotEmpty (string/list) or isTrue/isFalse (bool)`,
            'static', { problem: 'visibleWhenInvalid', op: p.visibleWhen?.op, varName: vwVar }, loc));
        }
      }
    }

    // Action prop keys
    for (const key of ['action', 'onTap', 'onToggle', 'onDismissed', 'onSubmit'] as const) {
      if (p[key] && typeof p[key] === 'object' && 'type' in p[key]) {
        this.checkAction(p[key] as Action, frame, `${loc.nodePath}.props.${key}`, emit);
      }
    }

    // C8 — color prop plausibility for hardcoded widgets
    if (HARDCODED_NODE_TYPES.has(node.type)) {
      for (const colorProp of ['color', 'backgroundColor', 'foregroundColor'] as const) {
        if (typeof p[colorProp] === 'string' && !colorIsPlausible(p[colorProp])) {
          emit(warn('C8', `Prop '${colorProp}' value '${p[colorProp]}' is not a recognized color — codegen falls back to Colors.blue`,
            'static',
            { propName: colorProp, propValue: p[colorProp], expectedType: 'color', problem: 'unrecognizedColor', fallbackUsed: 'Colors.blue' },
            loc));
        }
      }
      // C8 — icon prop
      if (typeof p.icon === 'string') {
        this.checkIconProp(p.icon, 'icon', loc, emit);
      }
    }
  }

  // Text binding cascade §6.0.4
  private checkTextBinding(
    raw: string,
    frame: Frame,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    const bindRe = /\{\{([^}]+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = bindRe.exec(raw)) !== null) {
      const expr = m[1].trim();

      // Step 1: item-whole
      if (expr === 'item') {
        if (!frame.inItemScope) {
          emit(err('C4', `Binding '{{item}}' used outside a dataSource listView`,
            'static', { binding: expr, problem: 'outsideItemScope' }, loc));
        }
        continue;
      }

      // Step 2: item.field
      if (expr.startsWith('item.')) {
        if (!frame.inItemScope) {
          emit(err('C4', `Binding '{{${expr}}}' used outside a dataSource listView`,
            'static', { binding: expr, problem: 'outsideItemScope' }, loc));
        } else {
          const fieldName = expr.slice('item.'.length);
          if (frame.itemFields && !frame.itemFields.has(fieldName)) {
            emit(err('C4', `Item field '${fieldName}' is not defined for list '${frame.dataSourceList}'`,
              'static',
              { binding: expr, fieldName, problem: 'unknownItemField',
                enclosingListDataSource: frame.dataSourceList,
                knownItemFields: frame.itemFields ? [...frame.itemFields] : [] },
              loc));
          }
        }
        continue;
      }

      // Step 3: dotted non-item — a valid computed accessor or invalid member access
      const head = expr.split('.')[0];
      if (expr.includes('.')) {
        // .length / .isEmpty / .isNotEmpty on a list/string var — valid computed binding
        if (resolveComputed(expr, (n) => frame.varByName.get(n)?.type)) continue;

        if (!frame.varNames.has(head)) {
          emit(err('C1', `Binding '{{${expr}}}' references undeclared var '${head}' (member access)`,
            'static',
            { refName: head, refKind: 'binding-dotted', headDeclared: false,
              rawExpr: expr, emitted: `_${expr}`, availableVars: [...frame.varNames] },
            loc));
        } else {
          // Declared head, unsupported accessor — member access on a state var never
          // compiles. Now a hard error (the valid accessors are handled above).
          emit(err('C1', `Binding '{{${expr}}}' uses unsupported member access on '_${head}'. Only .length / .isEmpty / .isNotEmpty are valid (on string/list vars).`,
            'static', { rawExpr: expr, head, refKind: 'binding-dotted', problem: 'invalidMemberAccess' }, loc));
        }
        continue;
      }

      // Step 4: plain var ref
      if (!frame.varNames.has(expr)) {
        const suggestion = nearestKnown(expr, frame.varNames);
        emit(err('C1', `Binding '{{${expr}}}' references undeclared state var '${expr}'`,
          'static',
          { refName: expr, refKind: 'binding', availableVars: [...frame.varNames],
            suggestion: suggestion ?? undefined },
          loc));
      }
    }
  }

  // ── Action checks ─────────────────────────────────────────────────────────

  private checkAction(
    a: Action,
    frame: Frame,
    path: string,
    emit: (e: ValidationError) => void,
  ): void {
    if (!a || a.type === 'none') return;
    const loc: SourceLocation = {
      screenId: frame.screen.id,
      screenIdx: frame.screenIdx,
      nodePath: path,
    };

    // C16 — navigate target must resolve to a screen id or route (shares the
    // exact resolver codegen uses, so a certified navigate cannot crash at runtime).
    if (a.type === 'navigate') {
      if (a.target && resolveNavRoute(a.target, frame.screenIdToRoute) === NAV_UNRESOLVED) {
        emit(err('C16', `navigate target '${a.target}' does not resolve to any screen id or route`,
          'static',
          { actionType: 'navigate', target: a.target, problem: 'navTargetUnresolved',
            knownRoutes: [...frame.screenIdToRoute.values()], knownScreenIds: [...frame.screenIdToRoute.keys()] },
          loc));
      }
      return;
    }

    if (a.type === 'pop') return;

    if (a.type === 'addItem') {
      if (a.listName) this.checkListRef(a.listName, ['stringList', 'itemList'], frame, loc, emit, 'C3a');
      // C15 — clearFields resets `_f = ''` + controller.clear(); string vars only
      if (Array.isArray(a.clearFields)) {
        for (const f of a.clearFields) {
          const v = frame.varByName.get(f);
          if (v && !isClearable(v.type)) {
            emit(err('C15', `addItem.clearFields entry '${f}' is type '${v.type}'; only string fields can be cleared (codegen emits "_${f} = ''")`,
              'static', { actionType: a.type, fieldName: f, varType: v.type, expectedTypes: ['string'], problem: 'clearFieldTypeMismatch' }, loc));
          }
        }
      }
    }
    if (a.type === 'removeItem') {
      if (a.listName) this.checkListRef(a.listName, ['stringList', 'itemList'], frame, loc, emit, 'C3a');
      if (!frame.inItemScope) {
        emit(err('C4', `removeItem action requires item scope (inside a dataSource listView)`,
          'static', { actionType: a.type, problem: 'outsideItemScope' }, loc));
      }
    }
    if (a.type === 'toggleItemField') {
      if (a.listName) this.checkListRef(a.listName, ['itemList'], frame, loc, emit, 'C3a');
      if (a.fieldName && a.listName) {
        const listVar = frame.varByName.get(a.listName);
        if (listVar?.type === 'itemList') {
          const iFields = this.computeItemFields(frame.screen, frame.varNames, a.listName, listVar);
          if (!iFields.has(a.fieldName)) {
            emit(err('C3a', `toggleItemField.fieldName '${a.fieldName}' is not a field of list '${a.listName}'`,
              'static', { actionType: a.type, listName: a.listName, fieldName: a.fieldName }, loc));
          }
        }
      }
      if (!frame.inItemScope) {
        emit(err('C4', `toggleItemField action requires item scope (inside a dataSource listView)`,
          'static', { actionType: a.type, problem: 'outsideItemScope' }, loc));
      }
    }
    if (a.type === 'increment' || a.type === 'decrement') {
      if (a.fieldName) {
        this.checkVarRef(a.fieldName, `${a.type}.fieldName`, frame, loc, emit);
        // C15 — codegen emits `_field++` / `_field--`; only int/double are valid
        const v = frame.varByName.get(a.fieldName);
        if (v && !isIncrementable(v.type)) {
          emit(err('C15', `${a.type} target '${a.fieldName}' is type '${v.type}'; only int/double can be incremented (codegen emits '_${a.fieldName}${a.type === 'increment' ? '++' : '--'}')`,
            'static', { actionType: a.type, fieldName: a.fieldName, varType: v.type, expectedTypes: ['int', 'double'], problem: 'mutationTypeMismatch' }, loc));
        }
      }
    }

    // setValue / clearField — emitted as inline closures (no named handler), so
    // they only need their targets to resolve (C1) and type-check (C15 elsewhere).
    if (a.type === 'setValue') {
      if (a.fieldName) this.checkVarRef(a.fieldName, 'setValue.fieldName', frame, loc, emit);
      if (a.valueFrom) this.checkVarRef(a.valueFrom, 'setValue.valueFrom', frame, loc, emit);
      return;
    }
    if (a.type === 'clearField') {
      const targets = Array.isArray(a.clearFields) && a.clearFields.length
        ? a.clearFields
        : (a.fieldName ? [a.fieldName] : []);
      for (const f of targets) this.checkVarRef(f, 'clearField', frame, loc, emit);
      return;
    }

    // showSnackBar / showDialog — self-contained inline closures, nothing to resolve.
    if (a.type === 'showSnackBar' || a.type === 'showDialog') {
      return;
    }

    // C3b — undefined handler method
    const methodName = actionMethodName(a);
    if (!frame.declaredHandlers.has(methodName)) {
      // Could be a gated-addItem body site
      emit(err('C3b', `Action '${a.type}' at this site would call '${methodName}' which generateActionHandlers will not emit`,
        'static', { actionType: a.type, problem: 'undeclaredMethod', methodName }, loc));
    }
  }

  // ── Reference helpers ─────────────────────────────────────────────────────

  private checkVarRef(
    name: string,
    refKind: string,
    frame: Frame,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    if (frame.varNames.has(name)) return;
    // C2 suppression: if the ref matches a list ref that fired C2, skip C1
    const suggestion = nearestKnown(name, frame.varNames);
    emit(err('C1', `'${refKind}' references undeclared state var '${name}'`,
      'static',
      { refName: name, refKind, availableVars: [...frame.varNames],
        suggestion: suggestion ?? undefined },
      loc));
  }

  private checkListRef(
    name: string,
    allowedTypes: string[],
    frame: Frame,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
    code: string,
  ): void {
    const v = frame.varByName.get(name);
    if (!v) {
      const listVars = [...frame.varByName.values()]
        .filter(vv => allowedTypes.includes(vv.type))
        .map(vv => vv.name);
      emit(err('C2', `List reference '${name}' does not exist`,
        'static',
        { refName: name, dangling: 'missing', expected: allowedTypes, listVarsAvailable: listVars },
        loc));
      return;
    }
    if (!allowedTypes.includes(v.type)) {
      const listVars = [...frame.varByName.values()]
        .filter(vv => allowedTypes.includes(vv.type))
        .map(vv => vv.name);
      emit(err('C2', `'${name}' is type '${v.type}' but expected one of [${allowedTypes.join(', ')}]`,
        'static',
        { refName: name, dangling: 'wrongType', actualType: v.type, expected: allowedTypes, listVarsAvailable: listVars },
        loc));
    }
  }

  // ── itemFields algorithm (§6.0.6) ────────────────────────────────────────

  private computeItemFields(
    screen: Screen,
    varNames: Set<string>,
    listName: string,
    listVar: StateVariable | undefined,
  ): Set<string> {
    if (!listVar || listVar.type !== 'itemList') return new Set();
    const fields = new Set<string>();

    // Fields from addItem.itemTemplate
    const allActions = collectActions(screen.body);
    if (screen.fab?.action) allActions.push(screen.fab.action);
    for (const a of allActions) {
      if (a.type === 'addItem' && a.listName === listName && a.itemTemplate) {
        for (const k of Object.keys(a.itemTemplate)) fields.add(k);
      }
    }

    // Fields from listVar.itemFields
    for (const f of listVar.itemFields ?? []) fields.add(f.name);

    return fields;
  }

  // ── C13 / C14 — customCode (Phase 5) ─────────────────────────────────────

  private checkCustomCode(
    node: WidgetNode,
    frame: Frame,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    const GATE_OPEN = process.env.FLOWCRAFT_PHASE5 === '1';

    // C14: customCode present but Phase 5 gate is closed → warn (never repairs, just visible)
    if (!GATE_OPEN) {
      emit(warn('C14',
        'customCode node present but FLOWCRAFT_PHASE5 gate is closed — renders as SizedBox.shrink()',
        'static',
        { gateOpen: false, remediation: 'Set FLOWCRAFT_PHASE5=1 and FLOWCRAFT_CUSTOMCODE=1 to enable' },
        loc));
      return;
    }

    // C13: stateDeps ⊄ screen.screenState.variables (error — Layer A asserts this)
    const stateDeps: string[] = node.props?.custom?.interface?.stateDeps ?? [];
    const missing = stateDeps.filter(d => !frame.varNames.has(d));
    if (missing.length > 0) {
      emit(err('C13',
        `customCode.stateDeps [${missing.join(', ')}] not found in screen state variables`,
        'static',
        { stateDeps, missingDeps: missing, availableVars: [...frame.varNames] },
        loc));
    }
  }

  // ── C7 / C8 registry checks ───────────────────────────────────────────────

  private checkC7(
    def: import('../widget-registry/types.js').WidgetDefinition,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    const problems: string[] = [];
    if (!def.dartWidget) problems.push('dartWidget is empty');
    const VALID_PROP_TYPES = new Set(['number', 'string', 'bool', 'color', 'icon', 'edgeInsets']);
    for (const prop of def.props ?? []) {
      if (!VALID_PROP_TYPES.has(prop.type)) {
        problems.push(`prop '${prop.name}' has invalid type '${prop.type}'`);
      }
    }
    if (def.stateBinding) {
      if (!def.stateBinding.valueProp) problems.push('stateBinding.valueProp missing');
      if (!def.stateBinding.onChangedProp) problems.push('stateBinding.onChangedProp missing');
    }
    for (const p of problems) {
      emit(err('C7', `Registry definition '${def.name}': ${p}`,
        'static', { defName: def.name, problem: p }, loc));
    }
  }

  private checkC8Registry(
    def: import('../widget-registry/types.js').WidgetDefinition,
    node: WidgetNode,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    for (const propDef of def.props ?? []) {
      const val = node.props?.[propDef.name];
      if (val === undefined || val === null) continue;
      if (propDef.type === 'color' && typeof val === 'string' && !colorIsPlausible(val)) {
        emit(warn('C8', `Prop '${propDef.name}' value '${val}' is not a recognized color`,
          'static',
          { propName: propDef.name, propValue: val, expectedType: 'color',
            problem: 'unrecognizedColor', fallbackUsed: 'Colors.blue' },
          loc));
      }
      if (propDef.type === 'icon' && typeof val === 'string') {
        this.checkIconProp(val, propDef.name, loc, emit);
      }
      if ((propDef.type === 'number') && typeof val !== 'number') {
        emit(warn('C8', `Prop '${propDef.name}' expects a number, got ${typeof val}`,
          'static', { propName: propDef.name, propValue: val, expectedType: 'number', problem: 'wrongType' },
          loc));
      }
    }
  }

  private checkIconProp(
    name: string,
    propName: string,
    loc: SourceLocation,
    emit: (e: ValidationError) => void,
  ): void {
    // Invalid Dart identifier → error; unknown-but-valid → warning
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      emit(err('C8', `Icon '${name}' is not a valid Dart identifier`,
        'static', { propName, propValue: name, expectedType: 'icon', problem: 'invalidIdentifier' },
        loc));
      return;
    }
    if (!KNOWN_ICONS.has(name)) {
      const suggestion = nearestKnown(name, KNOWN_ICONS);
      emit(warn('C8', `Icon '${name}' is not in the known icons list (may still be valid — starter set only)`,
        'static',
        { propName, propValue: name, expectedType: 'icon', problem: 'unknownIcon',
          suggestion: suggestion ?? undefined },
        loc));
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

// C17 — is a seeded itemList value cast-compatible with the declared field type?
// Codegen coerces seeds, so this guards against silent data loss (e.g. 'abc' → 0)
// and bool casts that would throw at runtime.
function seedValueMatches(type: string, val: unknown): boolean {
  switch (type) {
    case 'bool': return typeof val === 'boolean' || val === 'true' || val === 'false';
    case 'int': return (typeof val === 'number' && Number.isInteger(val)) ||
      (typeof val === 'string' && /^-?\d+$/.test(val.trim()));
    case 'double': return typeof val === 'number' ||
      (typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val)));
    default: return true; // string / unknown — any value stringifies
  }
}

// WidgetNodes always have a `props` object; Action objects do not — this discriminates them.
function isWidgetNode(v: unknown): v is WidgetNode {
  return !!(
    v && typeof v === 'object' &&
    'type' in v && typeof (v as any).type === 'string' &&
    'props' in v && v !== null && typeof (v as any).props === 'object'
  );
}

function err(
  code: string,
  message: string,
  source: 'static' | 'remote' | 'orchestrator',
  context: Record<string, unknown>,
  location?: SourceLocation,
): ValidationError {
  return { code, severity: 'error', message, source, location, context };
}

function warn(
  code: string,
  message: string,
  source: 'static' | 'remote' | 'orchestrator',
  context: Record<string, unknown>,
  location?: SourceLocation,
): ValidationError {
  return { code, severity: 'warning', message, source, location, context };
}
