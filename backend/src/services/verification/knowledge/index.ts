import { KNOWN_FLUTTER_WIDGETS, HARDCODED_NODE_TYPES } from './known-widgets';
import { NAMED_COLORS } from '../../codegen-shared/color-table';
import { KNOWN_ICONS } from '../../codegen-shared/known-icons';
import { DART_RESERVED } from './dart-reserved';
import { createHash } from 'crypto';

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    const sorted = Object.keys(v as object).sort().map(k =>
      JSON.stringify(k) + ':' + stableStringify((v as any)[k])
    );
    return '{' + sorted.join(',') + '}';
  }
  return JSON.stringify(v);
}

export const KNOWLEDGE_VERSION: string = createHash('sha256').update(
  stableStringify({
    knownFlutterWidgets: [...KNOWN_FLUTTER_WIDGETS].sort(),
    namedColors: NAMED_COLORS,
    knownIcons: [...KNOWN_ICONS].sort(),
    dartReserved: [...DART_RESERVED].sort(),
    hardcodedWidgets: [...HARDCODED_NODE_TYPES].sort(),
  })
).digest('hex').slice(0, 12);
