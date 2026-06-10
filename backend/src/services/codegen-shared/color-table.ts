// Extracted verbatim from code-generator.ts namedColor (L1035-1056).
// Imported by both CodeGenerator and StaticValidator to guarantee identical behavior.

export const NAMED_COLORS: Record<string, string> = {
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

// Two separate anchored regexes — NOT {6,8} (which would wrongly accept 7-char hex).
export const HEX6 = /^[0-9a-fA-F]{6}$/;
export const HEX8 = /^[0-9a-fA-F]{8}$/;

export function namedColor(name: string): string | null {
  return NAMED_COLORS[name.toLowerCase()] ?? NAMED_COLORS[name] ?? null;
}

export function resolveColor(hex: string): string {
  if (!hex) return 'Colors.blue';
  const named = namedColor(hex);
  if (named) return named;
  const clean = hex.replace('#', '');
  if (HEX6.test(clean)) return `Color(0xFF${clean.toUpperCase()})`;
  if (HEX8.test(clean)) return `Color(0x${clean.toUpperCase()})`;
  return 'Colors.blue';
}

// Returns true when the color value will produce something other than the Colors.blue fallback.
export function colorIsPlausible(hex: string): boolean {
  if (!hex) return false;
  if (namedColor(hex) !== null) return true;
  const clean = hex.replace('#', '');
  return HEX6.test(clean) || HEX8.test(clean);
}
