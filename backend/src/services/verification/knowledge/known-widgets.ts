// HARDCODED_NODE_TYPES: local Layer-A mirror of registry-manager.HARDCODED_WIDGETS (L7-10).
// These 15 node types are handled by code-generator.ts widget() switch (L453-468).
// Lockstep test (§5.4) asserts deep-equality with the exported HARDCODED_WIDGETS set.
export const HARDCODED_NODE_TYPES: ReadonlySet<string> = new Set([
  'text', 'button', 'textField', 'checkbox', 'listView', 'listTile', 'switch',
  'column', 'row', 'container', 'padding', 'sizedBox', 'card', 'center', 'expanded',
  'dropdown', 'radioGroup',
]);

// KNOWN_FLUTTER_WIDGETS: closed allowlist for C11 (keyed on def.dartWidget, NOT on node.type).
// DatePicker is intentionally absent — registry.json datePicker → C11 fires.
export const KNOWN_FLUTTER_WIDGETS: ReadonlySet<string> = new Set([
  // registry widgets currently shipped:
  'Image.network', 'Icon', 'Divider',
  'CircularProgressIndicator', 'LinearProgressIndicator', 'Spacer', 'Slider',
  // vetted headroom (real Flutter widgets, safe to register later):
  'Image.asset', 'Chip', 'Tooltip', 'Badge', 'CircleAvatar', 'SelectableText', 'Wrap',
]);
