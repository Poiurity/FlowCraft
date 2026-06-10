// §C.1 — Identifier collision sets for C9/C10.
// Application scope: screen.name (→ Dart class name) and state var names (→ _${name}).
// Item field names are always quoted map keys → never flag.

// Tier 1: Dart reserved words (illegal as any bare identifier). Source: Dart language spec §17.1.
export const DART_RESERVED: ReadonlySet<string> = new Set([
  'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'do', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'for',
  'if', 'in', 'is', 'new', 'null', 'rethrow', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);

// Tier 2: built-in identifiers (illegal as TYPE/class names). Source: Dart spec §17.2.
export const DART_BUILTIN: ReadonlySet<string> = new Set([
  'abstract', 'as', 'covariant', 'deferred', 'dynamic', 'export', 'external',
  'factory', 'Function', 'get', 'implements', 'import', 'interface', 'late',
  'library', 'mixin', 'operator', 'part', 'required', 'set', 'static', 'typedef',
]);

// Tier 3: names the generator emits or Flutter defines that a PascalCased screen name could shadow.
export const DART_CORE_COLLISIONS: ReadonlySet<string> = new Set([
  // generator-emitted (code-generator.ts):
  'MyApp', 'MainNavigation',
  // Flutter/Material types referenced in generated output:
  'Scaffold', 'AppBar', 'Text', 'Column', 'Row', 'Container', 'Padding', 'SizedBox',
  'Card', 'Center', 'Expanded', 'ListView', 'ListTile', 'TextField', 'Checkbox',
  'Switch', 'Divider', 'Icon', 'Image', 'Slider', 'MaterialApp', 'ThemeData',
  'Widget', 'State', 'StatelessWidget', 'StatefulWidget', 'BuildContext',
  'TextEditingController', 'EdgeInsets', 'Colors', 'Icons',
]);

// Convenience union for C9 screen-name checks.
export const ALL_RESERVED: ReadonlySet<string> = new Set([
  ...DART_RESERVED,
  ...DART_BUILTIN,
  ...DART_CORE_COLLISIONS,
]);
