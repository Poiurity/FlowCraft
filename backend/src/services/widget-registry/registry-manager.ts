import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { WidgetDefinition } from './types.js';
import type { RegistrySnapshot } from '../verification/types.js';

const REGISTRY_PATH = join(__dirname, 'registry.json');

// Exported so the Layer-A lockstep test and RegistrySnapshot builder can import it.
export const HARDCODED_WIDGETS: ReadonlySet<string> = new Set([
  'text', 'button', 'textField', 'checkbox', 'listView', 'listTile', 'switch',
  'column', 'row', 'container', 'padding', 'sizedBox', 'card', 'center', 'expanded',
  'dropdown', 'radioGroup',
]);

export class WidgetRegistryManager {
  private definitions: Map<string, WidgetDefinition> = new Map();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      const raw = readFileSync(REGISTRY_PATH, 'utf-8');
      const arr: WidgetDefinition[] = JSON.parse(raw);
      for (const def of arr) {
        this.definitions.set(def.name, def);
      }
    } catch {
      // registry.json not found or invalid — start empty
    }
    this.loaded = true;
  }

  private persist(): void {
    const arr = Array.from(this.definitions.values());
    writeFileSync(REGISTRY_PATH, JSON.stringify(arr, null, 2), 'utf-8');
  }

  getDefinition(widgetType: string): WidgetDefinition | null {
    this.ensureLoaded();
    return this.definitions.get(widgetType) || null;
  }

  addDefinition(def: WidgetDefinition): void {
    this.ensureLoaded();
    this.definitions.set(def.name, def);
    this.persist();
    console.log(`[WidgetRegistry] Added widget: ${def.name} (${def.dartWidget})`);
  }

  // Stage a definition in memory only — no disk write. Use before the learning compile-gate.
  stageDefinition(def: WidgetDefinition): void {
    this.ensureLoaded();
    this.definitions.set(def.name, def);
  }

  // Commit a staged definition to disk.
  commitDefinition(name: string): void {
    this.ensureLoaded();
    if (this.definitions.has(name)) this.persist();
  }

  // Returns a frozen, immutable facade suitable for use as a verification context.
  // The facade is immune to subsequent addDefinition/stageDefinition mutations.
  cloneDefinitions(): RegistrySnapshot {
    this.ensureLoaded();
    const defsClone: Map<string, WidgetDefinition> = new Map(
      [...this.definitions.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
    );
    const hw = HARDCODED_WIDGETS;

    // registryVersion: content hash over definitions only (not hardcoded set).
    // Invariant: hardcoded changes → KNOWLEDGE_VERSION bump; registry changes → registryVersion bump.
    const sorted = [...defsClone.values()].sort((a, b) => a.name.localeCompare(b.name));
    const registryVersion = createHash('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')
      .slice(0, 12);

    const snapshot: RegistrySnapshot = {
      values(): IterableIterator<WidgetDefinition> { return defsClone.values(); },
      hasWidget(type: string): boolean {
        return hw.has(type) || defsClone.has(type);
      },
      getDefinition(type: string): WidgetDefinition | null {
        return defsClone.get(type) ?? null;
      },
      hardcodedWidgets: hw,
      registryVersion,
    };
    return Object.freeze(snapshot);
  }

  hasWidget(widgetType: string): boolean {
    this.ensureLoaded();
    return HARDCODED_WIDGETS.has(widgetType) || this.definitions.has(widgetType);
  }

  isHardcoded(widgetType: string): boolean {
    return HARDCODED_WIDGETS.has(widgetType);
  }

  getAllWidgetNames(): string[] {
    this.ensureLoaded();
    return [...HARDCODED_WIDGETS, ...this.definitions.keys()];
  }

  getRegistryWidgetNames(): string[] {
    this.ensureLoaded();
    return Array.from(this.definitions.keys());
  }

  getPropsDescription(): string {
    this.ensureLoaded();
    const lines: string[] = [];

    lines.push('- Layout: column, row, container, padding, sizedBox, card, center, expanded');
    lines.push('- Display (hardcoded): text');
    lines.push('- Input (hardcoded): button, textField, checkbox, switch');
    lines.push('- List (hardcoded): listView, listTile');

    const registryWidgets = Array.from(this.definitions.values());
    if (registryWidgets.length > 0) {
      const byCategory: Record<string, WidgetDefinition[]> = {};
      for (const def of registryWidgets) {
        const cat = def.category;
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(def);
      }

      for (const [cat, defs] of Object.entries(byCategory)) {
        const names = defs.map(d => d.name).join(', ');
        lines.push(`- ${cat} (registry): ${names}`);
      }

      lines.push('');
      lines.push('REGISTRY WIDGET PROPS:');
      for (const def of registryWidgets) {
        const propDescs = def.props.map(p =>
          `${p.name}${p.optional ? '?' : ''}: ${p.type}`
        ).join(', ');
        const binding = def.stateBinding
          ? `, boundTo?: "stateVarName" (binds to ${def.stateBinding.stateType} state)`
          : '';
        lines.push(`- ${def.name}: { ${propDescs}${binding} }`);
      }
    }

    return lines.join('\n');
  }
}

export const widgetRegistry = new WidgetRegistryManager();
