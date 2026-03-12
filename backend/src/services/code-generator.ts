import type { AppState, Screen, StateVariable, ScreenState } from '../models/appstate';
import type { WidgetNode } from '../models/appstate';
import { widgetRegistry } from './widget-registry/registry-manager';
import type { WidgetDefinition } from './widget-registry/types';

/**
 * Deterministic Flutter code generator.
 * Given the same AppState, always produces the same Dart code.
 * Supports both StatelessWidget (static UI) and StatefulWidget (interactive UI).
 */
export class CodeGenerator {
  private currentScreenVars: StateVariable[] = [];

  generate(state: AppState): string {
    const lines: string[] = [];

    lines.push("import 'package:flutter/material.dart';");
    lines.push('');
    lines.push('void main() {');
    lines.push('  runApp(const MyApp());');
    lines.push('}');
    lines.push('');
    lines.push(this.generateAppWidget(state));

    for (const screen of state.screens) {
      lines.push('');
      lines.push(this.generateScreen(screen, state));
    }

    return lines.join('\n');
  }

  // ── App widget ──

  private generateAppWidget(state: AppState): string {
    const { theme, navigation, screens, appName } = state;
    const L: string[] = [];

    L.push('class MyApp extends StatelessWidget {');
    L.push('  const MyApp({super.key});');
    L.push('');
    L.push('  @override');
    L.push('  Widget build(BuildContext context) {');
    L.push('    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;');
    L.push('    return MaterialApp(');
    L.push(`      title: '${this.esc(appName)}',`);
    L.push('      debugShowCheckedModeBanner: false,');
    L.push('      theme: ThemeData(');
    L.push(`        colorSchemeSeed: ${this.color(theme.primaryColor)},`);
    L.push(`        brightness: ${theme.brightness === 'dark' ? 'Brightness.dark' : 'Brightness.light'},`);
    L.push('        useMaterial3: true,');
    if (theme.fontFamily) L.push(`        fontFamily: '${this.esc(theme.fontFamily)}',`);
    if (theme.scaffoldBackgroundColor) L.push(`        scaffoldBackgroundColor: ${this.color(theme.scaffoldBackgroundColor)},`);

    if (theme.appBarTheme) {
      const a = theme.appBarTheme;
      const parts: string[] = [];
      if (a.backgroundColor) parts.push(`backgroundColor: ${this.color(a.backgroundColor)}`);
      if (a.foregroundColor) parts.push(`foregroundColor: ${this.color(a.foregroundColor)}`);
      if (a.elevation !== undefined) parts.push(`elevation: ${a.elevation}`);
      if (a.centerTitle !== undefined) parts.push(`centerTitle: ${a.centerTitle}`);
      if (a.titleFontSize || a.titleFontWeight) {
        const ts: string[] = [];
        if (a.titleFontSize) ts.push(`fontSize: r(${a.titleFontSize})`);
        if (a.titleFontWeight) ts.push(`fontWeight: ${this.fontWeight(a.titleFontWeight)}`);
        parts.push(`titleTextStyle: TextStyle(${ts.join(', ')})`);
      }
      if (parts.length > 0) L.push(`        appBarTheme: AppBarTheme(${parts.join(', ')}),`);
    }

    if (theme.cardTheme) {
      const c = theme.cardTheme;
      const parts: string[] = [];
      if (c.elevation !== undefined) parts.push(`elevation: ${c.elevation}`);
      if (c.color) parts.push(`color: ${this.color(c.color)}`);
      if (c.shadowColor) parts.push(`shadowColor: ${this.color(c.shadowColor)}`);
      if (c.borderRadius !== undefined) parts.push(`shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(${c.borderRadius}))`);
      if (parts.length > 0) L.push(`        cardTheme: CardThemeData(${parts.join(', ')}),`);
    }

    if (theme.elevatedButtonTheme) {
      const b = theme.elevatedButtonTheme;
      const sp: string[] = [];
      if (b.backgroundColor) sp.push(`backgroundColor: WidgetStatePropertyAll(${this.color(b.backgroundColor)})`);
      if (b.foregroundColor) sp.push(`foregroundColor: WidgetStatePropertyAll(${this.color(b.foregroundColor)})`);
      if (b.elevation !== undefined) sp.push(`elevation: WidgetStatePropertyAll(${b.elevation})`);
      if (b.borderRadius !== undefined) sp.push(`shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(${b.borderRadius})))`);
      if (b.fontSize) sp.push(`textStyle: WidgetStatePropertyAll(TextStyle(fontSize: r(${b.fontSize})))`);
      if (b.minimumSize) {
        const w = b.minimumSize.width || 0;
        const h = b.minimumSize.height || 48;
        sp.push(`minimumSize: WidgetStatePropertyAll(Size(${w > 0 ? `r(${w})` : 'double.infinity'}, r(${h})))`);
      }
      if (b.padding) {
        const h = b.padding.horizontal || 16;
        const v = b.padding.vertical || 8;
        sp.push(`padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: r(${h}), vertical: r(${v})))`);
      }
      if (sp.length > 0) L.push(`        elevatedButtonTheme: ElevatedButtonThemeData(style: ButtonStyle(${sp.join(', ')})),`);
    }

    if (theme.inputTheme) {
      const inp = theme.inputTheme;
      const parts: string[] = [];
      if (inp.filled) parts.push('filled: true');
      if (inp.fillColor) parts.push(`fillColor: ${this.color(inp.fillColor)}`);
      if (inp.borderRadius !== undefined) {
        parts.push(`border: OutlineInputBorder(borderRadius: BorderRadius.circular(${inp.borderRadius}))`);
        parts.push(`enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(${inp.borderRadius})${inp.borderColor ? `, borderSide: BorderSide(color: ${this.color(inp.borderColor)})` : ''})`);
        if (inp.focusedBorderColor) {
          parts.push(`focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(${inp.borderRadius}), borderSide: BorderSide(color: ${this.color(inp.focusedBorderColor)}, width: 2))`);
        }
      } else {
        if (inp.borderColor) parts.push(`enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: ${this.color(inp.borderColor)}))`);
        if (inp.focusedBorderColor) parts.push(`focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: ${this.color(inp.focusedBorderColor)}, width: 2))`);
      }
      if (inp.labelFontSize) parts.push(`labelStyle: TextStyle(fontSize: r(${inp.labelFontSize}))`);
      if (parts.length > 0) L.push(`        inputDecorationTheme: InputDecorationTheme(${parts.join(', ')}),`);
    }

    if (theme.textTheme) {
      const tt = theme.textTheme;
      const entries: string[] = [];
      if (tt.headlineFontSize || tt.headlineColor) {
        const p: string[] = [];
        if (tt.headlineFontSize) p.push(`fontSize: r(${tt.headlineFontSize})`);
        if (tt.headlineColor) p.push(`color: ${this.color(tt.headlineColor)}`);
        entries.push(`headlineMedium: TextStyle(${p.join(', ')})`);
      }
      if (tt.bodyFontSize || tt.bodyColor) {
        const p: string[] = [];
        if (tt.bodyFontSize) p.push(`fontSize: r(${tt.bodyFontSize})`);
        if (tt.bodyColor) p.push(`color: ${this.color(tt.bodyColor)}`);
        entries.push(`bodyMedium: TextStyle(${p.join(', ')})`);
      }
      if (tt.labelFontSize) entries.push(`labelLarge: TextStyle(fontSize: r(${tt.labelFontSize}))`);
      if (entries.length > 0) L.push(`        textTheme: TextTheme(${entries.join(', ')}),`);
    }

    L.push('      ),');

    if (navigation.type === 'bottomNav' && navigation.bottomNavItems) {
      L.push('      home: const MainNavigation(),');
    } else {
      L.push(`      initialRoute: '${navigation.initialRoute}',`);
      L.push('      routes: {');
      for (const s of screens) {
        L.push(`        '${s.route}': (context) => const ${s.name}(),`);
      }
      L.push('      },');
    }

    L.push('    );');
    L.push('  }');
    L.push('}');

    if (navigation.type === 'bottomNav' && navigation.bottomNavItems) {
      L.push('');
      L.push(this.generateBottomNav(state));
    }

    return L.join('\n');
  }

  private generateBottomNav(state: AppState): string {
    const items = state.navigation.bottomNavItems || [];
    const L: string[] = [];

    L.push('class MainNavigation extends StatefulWidget {');
    L.push('  const MainNavigation({super.key});');
    L.push('  @override');
    L.push('  State<MainNavigation> createState() => _MainNavigationState();');
    L.push('}');
    L.push('');
    L.push('class _MainNavigationState extends State<MainNavigation> {');
    L.push('  int _currentIndex = 0;');
    L.push('  final List<Widget> _pages = const [');
    for (const item of items) {
      const screen = state.screens.find(s => s.id === item.screenId);
      if (screen) L.push(`    ${screen.name}(),`);
    }
    L.push('  ];');
    L.push('');
    L.push('  @override');
    L.push('  Widget build(BuildContext context) {');
    L.push('    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;');
    L.push('    return Scaffold(');
    L.push('      body: _pages[_currentIndex],');
    L.push('      bottomNavigationBar: NavigationBar(');
    L.push('        selectedIndex: _currentIndex,');
    L.push('        onDestinationSelected: (i) => setState(() => _currentIndex = i),');
    L.push('        destinations: [');
    for (const item of items) {
      L.push(`          NavigationDestination(icon: Icon(${this.icon(item.icon)}), label: '${this.esc(item.label)}'),`);
    }
    L.push('        ],');
    L.push('      ),');
    L.push('    );');
    L.push('  }');
    L.push('}');
    return L.join('\n');
  }

  // ── Screen ──

  private generateScreen(screen: Screen, state: AppState): string {
    this.currentScreenVars = screen.screenState?.variables || [];
    const isStateful = !!screen.screenState && screen.screenState.variables.length > 0;

    if (isStateful) {
      return this.generateStatefulScreen(screen, state);
    }
    return this.generateStatelessScreen(screen, state);
  }

  private generateStatelessScreen(screen: Screen, state: AppState): string {
    const L: string[] = [];
    L.push(`class ${screen.name} extends StatelessWidget {`);
    L.push(`  const ${screen.name}({super.key});`);
    L.push('');
    L.push('  @override');
    L.push('  Widget build(BuildContext context) {');
    L.push('    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;');
    L.push('    return Scaffold(');
    if (screen.backgroundColor) L.push(`      backgroundColor: ${this.color(screen.backgroundColor)},`);
    if (screen.appBar) L.push(this.appBarCode(screen.appBar, 6));
    L.push(`      body: ${this.widget(screen.body, state, 6).trim()},`);
    if (screen.fab) L.push(this.fabCode(screen.fab, 6));
    L.push('    );');
    L.push('  }');
    L.push('}');
    return L.join('\n');
  }

  private generateStatefulScreen(screen: Screen, state: AppState): string {
    const ss = screen.screenState!;
    const vars = ss.variables;
    const L: string[] = [];

    L.push(`class ${screen.name} extends StatefulWidget {`);
    L.push(`  const ${screen.name}({super.key});`);
    L.push('  @override');
    L.push(`  State<${screen.name}> createState() => _${screen.name}State();`);
    L.push('}');
    L.push('');
    L.push(`class _${screen.name}State extends State<${screen.name}> {`);

    // State variable declarations
    for (const v of vars) {
      L.push(`  ${this.dartVarDeclaration(v)}`);
    }

    // TextEditingControllers for variables that can be bound to TextFields
    const textBindableTypes = new Set(['string', 'int', 'double']);
    const controllerVars = vars.filter(v => textBindableTypes.has(v.type));
    for (const v of controllerVars) {
      L.push(`  final _${v.name}Controller = TextEditingController();`);
    }

    // dispose
    if (controllerVars.length > 0) {
      L.push('');
      L.push('  @override');
      L.push('  void dispose() {');
      for (const v of controllerVars) {
        L.push(`    _${v.name}Controller.dispose();`);
      }
      L.push('    super.dispose();');
      L.push('  }');
    }

    // Action handler methods
    L.push('');
    L.push(...this.generateActionHandlers(screen, vars));

    // build method
    L.push('');
    L.push('  @override');
    L.push('  Widget build(BuildContext context) {');
    L.push('    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;');
    L.push('    return Scaffold(');
    if (screen.backgroundColor) L.push(`      backgroundColor: ${this.color(screen.backgroundColor)},`);
    if (screen.appBar) L.push(this.appBarCode(screen.appBar, 6));
    L.push(`      body: ${this.widget(screen.body, state, 6).trim()},`);
    if (screen.fab) L.push(this.fabCode(screen.fab, 6));
    L.push('    );');
    L.push('  }');
    L.push('}');
    return L.join('\n');
  }

  // ── Action handlers ──

  private generateActionHandlers(screen: Screen, vars: StateVariable[]): string[] {
    const L: string[] = [];
    const actions = this.collectActions(screen.body);
    if (screen.fab?.action) actions.push(screen.fab.action);

    const seen = new Set<string>();

    for (const a of actions) {
      if (!a || a.type === 'navigate' || a.type === 'pop' || a.type === 'none') continue;
      const key = `${a.type}_${a.listName || ''}_${a.fieldName || ''}_${a.valueFrom || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const methodName = this.actionMethodName(a);

      if (a.type === 'addItem' && a.listName) {
        const listVar = vars.find(v => v.name === a.listName);
        if (listVar?.type === 'itemList' && a.itemTemplate) {
          L.push(`  void ${methodName}() {`);
          L.push('    setState(() {');
          const templateParts: string[] = [];
          for (const [k, v] of Object.entries(a.itemTemplate)) {
            if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
              const varName = v.slice(2, -2).trim();
              templateParts.push(`'${k}': _${varName}`);
            } else if (typeof v === 'boolean') {
              templateParts.push(`'${k}': ${v}`);
            } else if (typeof v === 'number') {
              templateParts.push(`'${k}': ${v}`);
            } else {
              templateParts.push(`'${k}': '${this.esc(String(v))}'`);
            }
          }
          // Validation: don't add if the primary text field is empty
          const textField = Object.entries(a.itemTemplate).find(([_, v]) =>
            typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')
          );
          if (textField) {
            const srcVar = (textField[1] as string).slice(2, -2).trim();
            L.push(`      if (_${srcVar}.trim().isEmpty) return;`);
          }
          L.push(`      _${a.listName}.add({${templateParts.join(', ')}});`);
          // Clear fields after add
          if (a.clearFields) {
            for (const f of a.clearFields) {
              L.push(`      _${f} = '';`);
              L.push(`      _${f}Controller.clear();`);
            }
          }
          L.push('    });');
          L.push('  }');
        } else if (listVar?.type === 'stringList') {
          const srcVar = a.valueFrom || '';
          L.push(`  void ${methodName}() {`);
          L.push('    setState(() {');
          if (srcVar) {
            L.push(`      if (_${srcVar}.trim().isEmpty) return;`);
            L.push(`      _${a.listName}.add(_${srcVar});`);
            L.push(`      _${srcVar} = '';`);
            L.push(`      _${srcVar}Controller.clear();`);
          }
          L.push('    });');
          L.push('  }');
        }
        L.push('');
      }

      if (a.type === 'removeItem' && a.listName) {
        L.push(`  void ${methodName}(int index) {`);
        L.push('    setState(() {');
        L.push(`      _${a.listName}.removeAt(index);`);
        L.push('    });');
        L.push('  }');
        L.push('');
      }

      if (a.type === 'toggleItemField' && a.listName && a.fieldName) {
        L.push(`  void ${methodName}(int index) {`);
        L.push('    setState(() {');
        L.push(`      _${a.listName}[index]['${a.fieldName}'] = !(_${a.listName}[index]['${a.fieldName}'] as bool);`);
        L.push('    });');
        L.push('  }');
        L.push('');
      }

      if (a.type === 'increment' && a.fieldName) {
        L.push(`  void ${methodName}() {`);
        L.push(`    setState(() => _${a.fieldName}++);`);
        L.push('  }');
        L.push('');
      }

      if (a.type === 'decrement' && a.fieldName) {
        L.push(`  void ${methodName}() {`);
        L.push(`    setState(() => _${a.fieldName}--);`);
        L.push('  }');
        L.push('');
      }
    }

    return L;
  }

  private collectActions(node: WidgetNode): any[] {
    const results: any[] = [];
    if (node.props?.action) results.push(node.props.action);
    if (node.props?.onToggle) results.push(node.props.onToggle);
    if (node.props?.onDismissed) results.push(node.props.onDismissed);
    if (node.props?.onTap) results.push(node.props.onTap);
    if (node.props?.onSubmit) results.push(node.props.onSubmit);

    // Traverse widget nodes embedded in props (listTile's leading/title/trailing/subtitle, itemBuilder)
    for (const val of Object.values(node.props || {})) {
      if (val && typeof val === 'object' && 'type' in val && typeof val.type === 'string') {
        results.push(...this.collectActions(val as WidgetNode));
      }
    }

    if (node.children) {
      for (const child of node.children) {
        results.push(...this.collectActions(child));
      }
    }
    return results;
  }

  private actionMethodName(a: any): string {
    const parts = [a.type as string];
    if (a.listName) parts.push(a.listName);
    if (a.fieldName) parts.push(a.fieldName);
    return '_' + parts.map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join('');
  }

  // ── Variable declarations ──

  private dartVarDeclaration(v: StateVariable): string {
    switch (v.type) {
      case 'string':
        return `String _${v.name} = '${this.esc(String(v.initialValue ?? ''))}';`;
      case 'int':
        return `int _${v.name} = ${v.initialValue ?? 0};`;
      case 'double':
        return `double _${v.name} = ${v.initialValue ?? 0.0};`;
      case 'bool':
        return `bool _${v.name} = ${v.initialValue ?? false};`;
      case 'stringList':
        return `final List<String> _${v.name} = [];`;
      case 'itemList':
        return `final List<Map<String, dynamic>> _${v.name} = [];`;
      default:
        return `dynamic _${v.name};`;
    }
  }

  // ── Widget code generation ──

  private widget(node: WidgetNode, state: AppState, indent: number): string {
    const pad = ' '.repeat(indent);

    switch (node.type) {
      case 'text': return this.wText(node, indent);
      case 'button': return this.wButton(node, indent);
      case 'column': return this.wFlex('Column', node, state, indent);
      case 'row': return this.wFlex('Row', node, state, indent);
      case 'container': return this.wContainer(node, state, indent);
      case 'padding': return this.wPadding(node, state, indent);
      case 'sizedBox': return this.wSizedBox(node, state, indent);
      case 'card': return this.wCard(node, state, indent);
      case 'listView': return this.wListView(node, state, indent);
      case 'textField': return this.wTextField(node, indent);
      case 'center': return this.wCenter(node, state, indent);
      case 'expanded': return this.wExpanded(node, state, indent);
      case 'checkbox': return this.wCheckbox(node, indent);
      case 'listTile': return this.wListTile(node, state, indent);
      case 'switch': return this.wSwitch(node, indent);
      default: {
        const def = widgetRegistry.getDefinition(node.type);
        if (def) return this.renderFromDefinition(def, node, indent);
        return `${pad}const SizedBox.shrink()`;
      }
    }
  }

  // ── Generic renderer for registry-defined widgets ──

  private renderFromDefinition(def: WidgetDefinition, node: WidgetNode, indent: number): string {
    const pad = ' '.repeat(indent);
    const parts: string[] = [];

    // State binding (e.g., Slider value/onChanged)
    if (def.stateBinding && node.props.boundTo) {
      const varName = node.props.boundTo;
      parts.push(`${def.stateBinding.valueProp}: _${varName}`);
      parts.push(`${def.stateBinding.onChangedProp}: (v) => setState(() => _${varName} = v)`);
    }

    for (const propDef of def.props) {
      const value = node.props[propDef.name];
      if (value === undefined && propDef.optional) continue;

      const resolved = value ?? propDef.defaultValue;
      if (resolved === undefined) continue;

      const dartValue = this.convertPropValue(resolved, propDef.type);

      if (propDef.dartParam === '') {
        // Positional argument (e.g., Image.network('url'), Icon(Icons.star))
        parts.unshift(dartValue);
      } else {
        parts.push(`${propDef.dartParam}: ${dartValue}`);
      }
    }

    if (parts.length === 0) {
      return `${pad}${def.dartWidget}()`;
    }

    if (parts.length <= 2 && parts.every(p => p.length < 40)) {
      return `${pad}${def.dartWidget}(${parts.join(', ')})`;
    }

    const cp = ' '.repeat(indent + 2);
    return `${pad}${def.dartWidget}(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private convertPropValue(value: any, type: string): string {
    switch (type) {
      case 'number': return String(value);
      case 'size': return `r(${value})`;
      case 'string': return `'${this.esc(String(value))}'`;
      case 'bool': return String(value);
      case 'color': return this.color(String(value));
      case 'icon': return this.icon(String(value));
      case 'edgeInsets': return this.edgeInsets(value);
      default: return String(value);
    }
  }

  // ── Hardcoded widgets (complex logic) ──

  private wText(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    let content = String(p.content ?? '');

    // Data binding: {{variable}} or {{item.field}}
    const isBinding = content.includes('{{') && content.includes('}}');
    let contentExpr: string;
    if (isBinding) {
      const dartExpr = content.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
        const trimmed = expr.trim();
        if (trimmed === 'item') return `\${item}`;
        if (trimmed.startsWith('item.')) return `\${item['${trimmed.slice(5)}']}`;
        if (trimmed.includes('.')) return `\${_${trimmed}}`;
        return `\${_${trimmed}}`;
      });
      contentExpr = `'${dartExpr}'`;
    } else {
      contentExpr = `'${this.esc(content)}'`;
    }

    const parts: string[] = [contentExpr];

    if (p.style) {
      const sp: string[] = [];
      if (p.style.fontSize) sp.push(`fontSize: r(${p.style.fontSize})`);
      if (p.style.fontWeight) sp.push(`fontWeight: ${this.fontWeight(p.style.fontWeight)}`);
      if (p.style.color) sp.push(`color: ${this.color(p.style.color)}`);
      if (p.style.fontStyle === 'italic') sp.push('fontStyle: FontStyle.italic');
      if (p.style.letterSpacing) sp.push(`letterSpacing: r(${p.style.letterSpacing})`);
      if (p.style.decoration) sp.push(`decoration: ${this.textDecoration(p.style.decoration)}`);
      if (sp.length > 0) parts.push(`style: TextStyle(${sp.join(', ')})`);
    }

    if (p.conditionalDecoration) {
      const cd = p.conditionalDecoration;
      parts.push(`style: TextStyle(decoration: (item['${cd.field}'] as bool? ?? false) ? TextDecoration.lineThrough : TextDecoration.none${p.style?.fontSize ? `, fontSize: r(${p.style.fontSize})` : ''})`);
    }

    if (p.textAlign) parts.push(`textAlign: TextAlign.${p.textAlign}`);
    if (p.maxLines) parts.push(`maxLines: ${p.maxLines}`);

    return `${pad}Text(${parts.join(', ')})`;
  }

  private wButton(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const variant = p.variant || 'elevated';
    const wName = variant === 'text' ? 'TextButton'
      : variant === 'outlined' ? 'OutlinedButton'
      : variant === 'icon' ? 'IconButton'
      : 'ElevatedButton';

    const onPressed = this.actionExpression(p.action, ind + 2);

    if (variant === 'icon') {
      const parts = [`onPressed: ${onPressed}`, `icon: Icon(${this.icon(p.icon || 'circle')})`];
      if (p.iconSize) parts.push(`iconSize: r(${p.iconSize})`);
      if (p.color) parts.push(`color: ${this.color(p.color)}`);
      return `${pad}IconButton(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
    }

    const btnParts: string[] = [`onPressed: ${onPressed}`];

    const styleParts: string[] = [];
    if (p.backgroundColor) styleParts.push(`backgroundColor: WidgetStatePropertyAll(${this.color(p.backgroundColor)})`);
    if (p.foregroundColor) styleParts.push(`foregroundColor: WidgetStatePropertyAll(${this.color(p.foregroundColor)})`);
    if (p.borderRadius !== undefined) styleParts.push(`shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(${p.borderRadius})))`);
    if (p.elevation !== undefined) styleParts.push(`elevation: WidgetStatePropertyAll(${p.elevation})`);
    if (p.fontSize) styleParts.push(`textStyle: WidgetStatePropertyAll(TextStyle(fontSize: r(${p.fontSize})))`);
    if (p.minimumSize) {
      const w = p.minimumSize.width || 0;
      const h = p.minimumSize.height || 48;
      styleParts.push(`minimumSize: WidgetStatePropertyAll(Size(${w > 0 ? `r(${w})` : 'double.infinity'}, r(${h})))`);
    }
    if (p.padding) {
      const h = p.padding.horizontal || 16;
      const v = p.padding.vertical || 8;
      styleParts.push(`padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: r(${h}), vertical: r(${v})))`);
    }
    if (styleParts.length > 0) btnParts.push(`style: ButtonStyle(${styleParts.join(', ')})`);

    let child: string;
    if (p.icon) {
      child = `Row(mainAxisSize: MainAxisSize.min, children: [Icon(${this.icon(p.icon)}), const SizedBox(width: 8), Text('${this.esc(p.label || 'Button')}')])`;
    } else {
      child = `Text('${this.esc(p.label || 'Button')}')`;
    }
    btnParts.push(`child: ${child}`);

    return `${pad}${wName}(\n${cp}${btnParts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wImage(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    const parts = [`'${this.esc(p.src || 'https://via.placeholder.com/150')}'`];
    if (p.width) parts.push(`width: r(${p.width})`);
    if (p.height) parts.push(`height: r(${p.height})`);
    if (p.fit) parts.push(`fit: BoxFit.${p.fit}`);
    return `${pad}Image.network(${parts.join(', ')})`;
  }

  private wIcon(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    const parts = [this.icon(p.name || 'star')];
    if (p.size) parts.push(`size: ${p.size}`);
    if (p.color) parts.push(`color: ${this.color(p.color)}`);
    return `${pad}Icon(${parts.join(', ')})`;
  }

  private wFlex(type: string, n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const parts: string[] = [];

    if (p.mainAxisAlignment) parts.push(`mainAxisAlignment: MainAxisAlignment.${p.mainAxisAlignment}`);
    if (p.crossAxisAlignment) parts.push(`crossAxisAlignment: CrossAxisAlignment.${p.crossAxisAlignment}`);

    const children = (n.children || []).map(c => {
      const fixed = this.fixFlexChild(type, c);
      return this.widget(fixed, state, ind + 4);
    });
    parts.push(`children: [\n${children.join(',\n')},\n${cp}]`);

    return `${pad}${type}(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  /**
   * Fixes common Flutter layout issues by wrapping children appropriately.
   * Returns the (possibly wrapped) WidgetNode.
   */
  private fixFlexChild(parentType: string, child: WidgetNode): WidgetNode {
    if (child.type === 'expanded' || child.type === 'spacer') return child;

    const SCROLLABLE = new Set(['listView', 'gridView']);
    const NEEDS_WIDTH_CONSTRAINT = new Set(['textField']);
    const FLEX_TYPES = new Set(['column', 'row']);

    // Column children: scrollables need Expanded to get bounded height
    if (parentType === 'Column' && SCROLLABLE.has(child.type)) {
      return { type: 'expanded', props: {}, children: [child] };
    }

    // Column children: nested Column/Row with Expanded children needs wrapping
    if (parentType === 'Column' && child.type === 'column' && this.hasExpandedChild(child)) {
      return { type: 'expanded', props: {}, children: [child] };
    }

    // Row children: TextField needs Expanded (no intrinsic width)
    if (parentType === 'Row' && NEEDS_WIDTH_CONSTRAINT.has(child.type)) {
      return { type: 'expanded', props: {}, children: [child] };
    }

    // Row children: nested Row with Expanded children needs wrapping
    if (parentType === 'Row' && child.type === 'row' && this.hasExpandedChild(child)) {
      return { type: 'expanded', props: {}, children: [child] };
    }

    // Row children: vertical ListView needs bounded height+width
    if (parentType === 'Row' && child.type === 'listView' && child.props.scrollDirection !== 'horizontal') {
      return { type: 'expanded', props: {}, children: [child] };
    }

    return child;
  }

  private hasExpandedChild(node: WidgetNode): boolean {
    return (node.children || []).some(c => c.type === 'expanded' || c.type === 'spacer');
  }

  /**
   * Unwraps Expanded/Spacer from a child that's NOT inside a Flex widget.
   * Expanded only works as a direct child of Column/Row/Flex — elsewhere it crashes.
   */
  private unwrapExpandedIfNeeded(child: WidgetNode): WidgetNode {
    if (child.type === 'expanded' && child.children?.[0]) {
      return child.children[0];
    }
    if (child.type === 'spacer') {
      return { type: 'sizedBox', props: { height: 16 } };
    }
    return child;
  }

  private wContainer(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const parts: string[] = [];

    if (p.width) parts.push(`width: r(${p.width})`);
    if (p.height) parts.push(`height: r(${p.height})`);
    if (p.padding) parts.push(`padding: ${this.edgeInsets(p.padding)}`);
    if (p.margin) parts.push(`margin: ${this.edgeInsets(p.margin)}`);
    if (p.alignment) parts.push(`alignment: Alignment.${p.alignment}`);
    if (p.decoration) parts.push(`decoration: ${this.boxDecoration(p.decoration)}`);
    else if (p.color) parts.push(`color: ${this.color(p.color)}`);
    if (n.children?.[0]) {
      const child = this.unwrapExpandedIfNeeded(n.children[0]);
      parts.push(`child: ${this.widget(child, state, ind + 2).trim()}`);
    }
    if (parts.length === 0) {
      return `${pad}Container()`;
    }
    return `${pad}Container(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wPadding(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const parts = [`padding: ${this.edgeInsets(n.props.padding || { all: 8 })}`];
    if (n.children?.[0]) {
      const child = this.unwrapExpandedIfNeeded(n.children[0]);
      parts.push(`child: ${this.widget(child, state, ind + 2).trim()}`);
    }
    return `${pad}Padding(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wSizedBox(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    const parts: string[] = [];
    if (p.width) parts.push(`width: r(${p.width})`);
    if (p.height) parts.push(`height: r(${p.height})`);
    if (n.children?.[0]) {
      const child = this.unwrapExpandedIfNeeded(n.children[0]);
      parts.push(`child: ${this.widget(child, state, ind + 2).trim()}`);
    }
    return `${pad}SizedBox(${parts.join(', ')})`;
  }

  private wCard(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const parts: string[] = [];
    if (p.elevation !== undefined) parts.push(`elevation: ${p.elevation}`);
    if (p.margin) parts.push(`margin: ${this.edgeInsets(p.margin)}`);
    if (p.color) parts.push(`color: ${this.color(p.color)}`);
    if (p.shadowColor) parts.push(`shadowColor: ${this.color(p.shadowColor)}`);
    if (p.borderRadius !== undefined) parts.push(`shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(${p.borderRadius}))`);
    if (n.children?.[0]) {
      const child = this.unwrapExpandedIfNeeded(n.children[0]);
      parts.push(`child: ${this.widget(child, state, ind + 2).trim()}`);
    }
    if (parts.length === 0) {
      return `${pad}Card()`;
    }
    return `${pad}Card(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wListView(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;

    // Data-bound ListView.builder
    if (p.dataSource) {
      const parts: string[] = [];
      parts.push(`itemCount: _${p.dataSource}.length`);
      if (p.padding) parts.push(`padding: ${this.edgeInsets(p.padding)}`);
      if (p.scrollDirection === 'horizontal') parts.push('scrollDirection: Axis.horizontal');

      // itemBuilder
      if (p.itemBuilder) {
        const itemWidget = this.widget(p.itemBuilder as WidgetNode, state, ind + 8).trim();
        parts.push(`itemBuilder: (context, index) {\n${cp}    final item = _${p.dataSource}[index];\n${cp}    return ${itemWidget};\n${cp}  }`);
      } else if (n.children?.[0]) {
        const itemWidget = this.widget(n.children[0], state, ind + 8).trim();
        parts.push(`itemBuilder: (context, index) {\n${cp}    final item = _${p.dataSource}[index];\n${cp}    return ${itemWidget};\n${cp}  }`);
      }

      return `${pad}ListView.builder(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
    }

    // Static ListView (shrinkWrap for safety when nested)
    const parts: string[] = [];
    parts.push('shrinkWrap: true');
    parts.push('physics: const ClampingScrollPhysics()');
    if (p.scrollDirection === 'horizontal') parts.push('scrollDirection: Axis.horizontal');
    if (p.padding) parts.push(`padding: ${this.edgeInsets(p.padding)}`);
    const children = (n.children || []).map(c => this.widget(c, state, ind + 4));
    parts.push(`children: [\n${children.join(',\n')},\n${cp}]`);
    return `${pad}ListView(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wTextField(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const parts: string[] = [];

    const decParts: string[] = [];
    if (p.label) decParts.push(`labelText: '${this.esc(p.label)}'`);
    if (p.hint) decParts.push(`hintText: '${this.esc(p.hint)}'`);
    if (p.prefixIcon) decParts.push(`prefixIcon: Icon(${this.icon(p.prefixIcon)})`);
    decParts.push('border: const OutlineInputBorder()');
    parts.push(`decoration: InputDecoration(${decParts.join(', ')})`);

    if (p.obscureText) parts.push('obscureText: true');

    // Data binding
    if (p.boundTo) {
      parts.push(`controller: _${p.boundTo}Controller`);
      const varDef = this.currentScreenVars.find(v => v.name === p.boundTo);
      const varType = varDef?.type || 'string';
      if (varType === 'int') {
        parts.push(`onChanged: (v) => setState(() => _${p.boundTo} = int.tryParse(v) ?? 0)`);
        parts.push(`keyboardType: TextInputType.number`);
      } else if (varType === 'double') {
        parts.push(`onChanged: (v) => setState(() => _${p.boundTo} = double.tryParse(v) ?? 0.0)`);
        parts.push(`keyboardType: TextInputType.number`);
      } else {
        parts.push(`onChanged: (v) => setState(() => _${p.boundTo} = v)`);
      }
    }

    // Submit action
    if (p.onSubmit) {
      const methodName = this.actionMethodName(p.onSubmit);
      parts.push(`onSubmitted: (_) => ${methodName}()`);
    }

    return `${pad}TextField(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wCheckbox(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;

    // Bound to an item field in a list (used inside itemBuilder context)
    if (p.boundToItemField) {
      const onChanged = p.onToggle
        ? `(_) => ${this.actionMethodName(p.onToggle)}(index)`
        : 'null';
      return `${pad}Checkbox(\n${pad}  value: item['${p.boundToItemField}'] as bool? ?? false,\n${pad}  onChanged: ${onChanged},\n${pad})`;
    }

    // Bound to a simple bool state variable
    if (p.boundTo) {
      return `${pad}Checkbox(\n${pad}  value: _${p.boundTo},\n${pad}  onChanged: (v) => setState(() => _${p.boundTo} = v ?? false),\n${pad})`;
    }

    return `${pad}Checkbox(value: ${p.value ?? false}, onChanged: null)`;
  }

  private wSwitch(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    if (p.boundTo) {
      return `${pad}Switch(\n${pad}  value: _${p.boundTo},\n${pad}  onChanged: (v) => setState(() => _${p.boundTo} = v),\n${pad})`;
    }
    return `${pad}Switch(value: ${p.value ?? false}, onChanged: null)`;
  }

  private wListTile(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const p = n.props;
    const parts: string[] = [];

    if (p.title) parts.push(`title: ${this.widget(p.title as WidgetNode, state, 0).trim()}`);
    if (p.subtitle) parts.push(`subtitle: ${this.widget(p.subtitle as WidgetNode, state, 0).trim()}`);
    if (p.leading) parts.push(`leading: ${this.widget(p.leading as WidgetNode, state, 0).trim()}`);
    if (p.trailing) parts.push(`trailing: ${this.widget(p.trailing as WidgetNode, state, 0).trim()}`);

    if (p.onTap) {
      parts.push(`onTap: ${this.actionExpression(p.onTap, ind + 2)}`);
    }

    if (parts.length === 0) {
      parts.push(`title: Text('')`);
    }

    // Dismissible wrapper
    if (p.onDismissed) {
      const methodName = this.actionMethodName(p.onDismissed);
      const inner = `ListTile(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
      return `${pad}Dismissible(\n${cp}key: ValueKey(index),\n${cp}onDismissed: (_) => ${methodName}(index),\n${cp}background: Container(color: Colors.red, alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 16), child: const Icon(Icons.delete, color: Colors.white)),\n${cp}child: ${inner},\n${pad})`;
    }

    return `${pad}ListTile(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wCenter(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    if (n.children?.[0]) {
      const unwrapped = this.unwrapExpandedIfNeeded(n.children[0]);
      const child = this.widget(unwrapped, state, ind + 2).trim();
      return `${pad}Center(\n${' '.repeat(ind + 2)}child: ${child},\n${pad})`;
    }
    return `${pad}const Center()`;
  }

  private wExpanded(n: WidgetNode, state: AppState, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const parts: string[] = [];
    if (n.props.flex) parts.push(`flex: ${n.props.flex}`);
    if (n.children?.[0]) parts.push(`child: ${this.widget(n.children[0], state, ind + 2).trim()}`);
    if (parts.length === 0) {
      return `${pad}Expanded(child: SizedBox.shrink())`;
    }
    return `${pad}Expanded(\n${cp}${parts.join(`,\n${cp}`)},\n${pad})`;
  }

  private wDivider(n: WidgetNode, ind: number): string {
    const pad = ' '.repeat(ind);
    const p = n.props;
    const parts: string[] = [];
    if (p.height) parts.push(`height: r(${p.height})`);
    if (p.thickness) parts.push(`thickness: r(${p.thickness})`);
    if (p.color) parts.push(`color: ${this.color(p.color)}`);
    return `${pad}Divider(${parts.join(', ')})`;
  }

  // ── Action expression ──

  private actionExpression(action: any, ind: number): string {
    if (!action) return '() {}';
    const pad = ' '.repeat(ind);

    const methodName = this.actionMethodName(action);
    const INDEX_REQUIRED = new Set(['removeItem', 'toggleItemField']);

    switch (action.type) {
      case 'navigate':
        const t = (action.target || '').replace(/^\//, '');
        return `() => Navigator.pushNamed(context, '/${t}')`;
      case 'pop':
        return '() => Navigator.pop(context)';
      case 'removeItem':
      case 'toggleItemField':
        return `() => ${methodName}(index)`;
      case 'addItem':
      case 'increment':
      case 'decrement':
      case 'setValue':
      case 'clearField':
        return `${methodName}`;
      default:
        return '() {}';
    }
  }

  // ── AppBar / FAB ──

  private appBarCode(ab: any, ind: number): string {
    const pad = ' '.repeat(ind);
    const cp = ' '.repeat(ind + 2);
    const L: string[] = [];
    L.push(`${pad}appBar: AppBar(`);
    L.push(`${cp}title: Text('${this.esc(ab.title)}'),`);
    if (ab.centerTitle !== undefined) L.push(`${cp}centerTitle: ${ab.centerTitle},`);
    if (ab.backgroundColor) L.push(`${cp}backgroundColor: ${this.color(ab.backgroundColor)},`);
    if (ab.foregroundColor) L.push(`${cp}foregroundColor: ${this.color(ab.foregroundColor)},`);
    if (ab.elevation !== undefined) L.push(`${cp}elevation: ${ab.elevation},`);
    if (ab.titleFontSize || ab.titleFontWeight) {
      const ts: string[] = [];
      if (ab.titleFontSize) ts.push(`fontSize: r(${ab.titleFontSize})`);
      if (ab.titleFontWeight) ts.push(`fontWeight: ${this.fontWeight(ab.titleFontWeight)}`);
      L.push(`${cp}titleTextStyle: TextStyle(${ts.join(', ')}),`);
    }
    if (ab.actions?.length > 0) {
      L.push(`${cp}actions: [`);
      for (const a of ab.actions) {
        L.push(`${cp}  IconButton(icon: Icon(${this.icon(a.icon)}), onPressed: ${this.actionExpression(a.action, ind + 4)}),`);
      }
      L.push(`${cp}],`);
    }
    L.push(`${pad}),`);
    return L.join('\n');
  }

  private fabCode(fab: any, ind: number): string {
    const pad = ' '.repeat(ind);
    const onPressed = this.actionExpression(fab.action, ind + 2);
    if (fab.label) {
      return `${pad}floatingActionButton: FloatingActionButton.extended(\n${pad}  onPressed: ${onPressed},\n${pad}  icon: Icon(${this.icon(fab.icon)}),\n${pad}  label: Text('${this.esc(fab.label)}'),\n${pad}),`;
    }
    return `${pad}floatingActionButton: FloatingActionButton(\n${pad}  onPressed: ${onPressed},\n${pad}  child: Icon(${this.icon(fab.icon)}),\n${pad}),`;
  }

  // ── Helpers ──

  private color(hex: string): string {
    if (!hex) return 'Colors.blue';
    const named = this.namedColor(hex);
    if (named) return named;
    const clean = hex.replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(clean)) return `Color(0xFF${clean.toUpperCase()})`;
    if (/^[0-9a-fA-F]{8}$/.test(clean)) return `Color(0x${clean.toUpperCase()})`;
    return 'Colors.blue';
  }

  private namedColor(name: string): string | null {
    const m: Record<string, string> = {
      red: 'Colors.red', blue: 'Colors.blue', green: 'Colors.green',
      yellow: 'Colors.yellow', orange: 'Colors.orange', purple: 'Colors.purple',
      pink: 'Colors.pink', teal: 'Colors.teal', cyan: 'Colors.cyan',
      amber: 'Colors.amber', indigo: 'Colors.indigo', lime: 'Colors.lime',
      brown: 'Colors.brown', grey: 'Colors.grey', gray: 'Colors.grey',
      white: 'Colors.white', black: 'Colors.black', transparent: 'Colors.transparent',
      deeporange: 'Colors.deepOrange', deeppurple: 'Colors.deepPurple',
      lightblue: 'Colors.lightBlue', lightgreen: 'Colors.lightGreen',
      bluegrey: 'Colors.blueGrey', blueGrey: 'Colors.blueGrey',
      deepOrange: 'Colors.deepOrange', deepPurple: 'Colors.deepPurple',
      lightBlue: 'Colors.lightBlue', lightGreen: 'Colors.lightGreen',
      lavender: 'Color(0xFFE6E6FA)', beige: 'Color(0xFFF5F5DC)',
      coral: 'Color(0xFFFF7F50)', salmon: 'Color(0xFFFA8072)',
      mint: 'Color(0xFF98FF98)', ivory: 'Color(0xFFFFFFF0)',
      navy: 'Color(0xFF000080)', maroon: 'Color(0xFF800000)',
      olive: 'Color(0xFF808000)', turquoise: 'Color(0xFF40E0D0)',
      gold: 'Color(0xFFFFD700)', silver: 'Color(0xFFC0C0C0)',
      crimson: 'Color(0xFFDC143C)', violet: 'Color(0xFFEE82EE)',
      peach: 'Color(0xFFFFDAB9)', khaki: 'Color(0xFFF0E68C)',
      plum: 'Color(0xFFDDA0DD)', tan: 'Color(0xFFD2B48C)',
    };
    return m[name.toLowerCase()] || null;
  }

  private icon(name: string): string {
    return `Icons.${name}`;
  }

  private fontWeight(w: string): string {
    const m: Record<string, string> = {
      normal: 'FontWeight.normal', bold: 'FontWeight.bold',
      w100: 'FontWeight.w100', w200: 'FontWeight.w200', w300: 'FontWeight.w300',
      w400: 'FontWeight.w400', w500: 'FontWeight.w500', w600: 'FontWeight.w600',
      w700: 'FontWeight.w700', w800: 'FontWeight.w800', w900: 'FontWeight.w900',
    };
    return m[w] || 'FontWeight.normal';
  }

  private textDecoration(d: string): string {
    const m: Record<string, string> = {
      none: 'TextDecoration.none', underline: 'TextDecoration.underline',
      lineThrough: 'TextDecoration.lineThrough', overline: 'TextDecoration.overline',
    };
    return m[d] || 'TextDecoration.none';
  }

  private edgeInsets(e: any): string {
    if (!e) return 'EdgeInsets.zero';
    if (e.all !== undefined) return `EdgeInsets.all(r(${e.all}))`;
    if (e.horizontal !== undefined || e.vertical !== undefined) {
      const h = e.horizontal ? `horizontal: r(${e.horizontal})` : '';
      const v = e.vertical ? `vertical: r(${e.vertical})` : '';
      return `EdgeInsets.symmetric(${[h, v].filter(Boolean).join(', ')})`;
    }
    const t = e.top || 0, b = e.bottom || 0, l = e.left || 0, rv = e.right || 0;
    if (t === b && l === rv && t === l) return `EdgeInsets.all(r(${t}))`;
    if (t === b && l === rv) return `EdgeInsets.symmetric(horizontal: r(${l}), vertical: r(${t}))`;
    return `EdgeInsets.only(${[t ? `top: r(${t})` : '', b ? `bottom: r(${b})` : '', l ? `left: r(${l})` : '', rv ? `right: r(${rv})` : ''].filter(Boolean).join(', ')})`;
  }

  private boxDecoration(d: any): string {
    const parts: string[] = [];
    if (d.color && !d.gradient) parts.push(`color: ${this.color(d.color)}`);
    if (d.borderRadius !== undefined) parts.push(`borderRadius: BorderRadius.circular(${d.borderRadius})`);
    if (d.border) {
      const bp: string[] = [];
      if (d.border.color) bp.push(`color: ${this.color(d.border.color)}`);
      if (d.border.width) bp.push(`width: ${d.border.width}`);
      parts.push(`border: Border.all(${bp.join(', ')})`);
    }
    if (d.boxShadow) {
      const s = d.boxShadow;
      const sp: string[] = [];
      sp.push(`color: ${this.color(s.color || '#000000')}.withOpacity(0.2)`);
      if (s.blurRadius !== undefined) sp.push(`blurRadius: ${s.blurRadius}`);
      if (s.spreadRadius !== undefined) sp.push(`spreadRadius: ${s.spreadRadius}`);
      if (s.offsetX !== undefined || s.offsetY !== undefined) sp.push(`offset: Offset(${s.offsetX || 0}, ${s.offsetY || 0})`);
      parts.push(`boxShadow: [BoxShadow(${sp.join(', ')})]`);
    }
    if (d.gradient) {
      const g = d.gradient;
      const colors = (g.colors || []).map((c: string) => this.color(c)).join(', ');
      if (g.type === 'radial') {
        parts.push(`gradient: RadialGradient(colors: [${colors}])`);
      } else {
        const begin = g.begin ? `Alignment.${g.begin}` : 'Alignment.topLeft';
        const end = g.end ? `Alignment.${g.end}` : 'Alignment.bottomRight';
        parts.push(`gradient: LinearGradient(begin: ${begin}, end: ${end}, colors: [${colors}])`);
      }
    }
    return `BoxDecoration(${parts.join(', ')})`;
  }

  private esc(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\\\\\$');
  }
}
