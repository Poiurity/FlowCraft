import type { AppState, Screen, WidgetNode } from '../models/appstate';

// ── Types ──

export interface ChangeReport {
  isNewApp: boolean;
  appNameChanged?: { from: string; to: string };
  themeChanges: ThemeChange[];
  screensAdded: ScreenSummary[];
  screensRemoved: string[];
  screensModified: ScreenModification[];
  navigationChanged?: NavigationChange;
}

export interface ThemeChange {
  field: string;
  from?: string;
  to?: string;
}

export interface ScreenSummary {
  name: string;
  widgetCounts: Record<string, number>;
  hasState: boolean;
  stateVariables: string[];
  interactions: string[];
}

export interface ScreenModification {
  name: string;
  widgetsAdded: Record<string, number>;
  widgetsRemoved: Record<string, number>;
  stateAdded: string[];
  stateRemoved: string[];
  interactionsAdded: string[];
  appBarChanged: boolean;
  fabChanged: boolean;
}

export interface NavigationChange {
  from: string;
  to: string;
}

// ── Differ ──

export function diffAppState(
  oldState: AppState | undefined,
  newState: AppState
): ChangeReport {
  if (!oldState) {
    return {
      isNewApp: true,
      themeChanges: [],
      screensAdded: newState.screens.map(summarizeScreen),
      screensRemoved: [],
      screensModified: [],
    };
  }

  const report: ChangeReport = {
    isNewApp: false,
    themeChanges: [],
    screensAdded: [],
    screensRemoved: [],
    screensModified: [],
  };

  // App name
  if (oldState.appName !== newState.appName) {
    report.appNameChanged = { from: oldState.appName, to: newState.appName };
  }

  // Theme
  const themeFields: (keyof typeof newState.theme)[] = [
    'primaryColor', 'brightness', 'fontFamily', 'scaffoldBackgroundColor', 'accentColor',
  ];
  for (const f of themeFields) {
    const oldVal = oldState.theme[f];
    const newVal = newState.theme[f];
    if (oldVal !== newVal) {
      report.themeChanges.push({
        field: f,
        from: oldVal != null ? String(oldVal) : undefined,
        to: newVal != null ? String(newVal) : undefined,
      });
    }
  }

  // Navigation
  if (oldState.navigation.type !== newState.navigation.type) {
    report.navigationChanged = {
      from: oldState.navigation.type,
      to: newState.navigation.type,
    };
  }

  // Screens
  const oldScreenIds = new Set(oldState.screens.map(s => s.id));
  const newScreenIds = new Set(newState.screens.map(s => s.id));

  for (const screen of newState.screens) {
    if (!oldScreenIds.has(screen.id)) {
      report.screensAdded.push(summarizeScreen(screen));
    }
  }

  for (const screen of oldState.screens) {
    if (!newScreenIds.has(screen.id)) {
      report.screensRemoved.push(screen.name);
    }
  }

  for (const newScreen of newState.screens) {
    if (oldScreenIds.has(newScreen.id)) {
      const oldScreen = oldState.screens.find(s => s.id === newScreen.id)!;
      const mod = diffScreen(oldScreen, newScreen);
      if (mod) report.screensModified.push(mod);
    }
  }

  return report;
}

// ── Screen-level diff ──

function diffScreen(oldScreen: Screen, newScreen: Screen): ScreenModification | null {
  const oldCounts = countWidgets(oldScreen.body);
  const newCounts = countWidgets(newScreen.body);

  const widgetsAdded: Record<string, number> = {};
  const widgetsRemoved: Record<string, number> = {};

  const allTypes = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
  for (const t of allTypes) {
    const diff = (newCounts[t] || 0) - (oldCounts[t] || 0);
    if (diff > 0) widgetsAdded[t] = diff;
    if (diff < 0) widgetsRemoved[t] = Math.abs(diff);
  }

  const oldVars = (oldScreen.screenState?.variables || []).map(v => v.name);
  const newVars = (newScreen.screenState?.variables || []).map(v => v.name);
  const stateAdded = newVars.filter(v => !oldVars.includes(v));
  const stateRemoved = oldVars.filter(v => !newVars.includes(v));

  const oldInteractions = detectInteractions(oldScreen);
  const newInteractions = detectInteractions(newScreen);
  const interactionsAdded = newInteractions.filter(i => !oldInteractions.includes(i));

  const appBarChanged = JSON.stringify(oldScreen.appBar) !== JSON.stringify(newScreen.appBar);
  const fabChanged = JSON.stringify(oldScreen.fab) !== JSON.stringify(newScreen.fab);

  const hasChanges =
    Object.keys(widgetsAdded).length > 0 ||
    Object.keys(widgetsRemoved).length > 0 ||
    stateAdded.length > 0 ||
    stateRemoved.length > 0 ||
    interactionsAdded.length > 0 ||
    appBarChanged ||
    fabChanged;

  if (!hasChanges) return null;

  return {
    name: newScreen.name,
    widgetsAdded,
    widgetsRemoved,
    stateAdded,
    stateRemoved,
    interactionsAdded,
    appBarChanged,
    fabChanged,
  };
}

// ── Helpers ──

function summarizeScreen(screen: Screen): ScreenSummary {
  return {
    name: screen.name,
    widgetCounts: countWidgets(screen.body),
    hasState: !!(screen.screenState && screen.screenState.variables.length > 0),
    stateVariables: (screen.screenState?.variables || []).map(v => v.name),
    interactions: detectInteractions(screen),
  };
}

function countWidgets(node: WidgetNode): Record<string, number> {
  const counts: Record<string, number> = {};

  const VISIBLE_TYPES = new Set([
    'text', 'button', 'image', 'icon', 'textField', 'checkbox',
    'listView', 'listTile', 'card', 'switch', 'divider',
  ]);

  function walk(n: WidgetNode) {
    if (VISIBLE_TYPES.has(n.type)) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    if (n.children) n.children.forEach(walk);
    // Also walk widgets nested in props (listTile's leading/title/trailing)
    for (const val of Object.values(n.props || {})) {
      if (val && typeof val === 'object' && 'type' in val && typeof val.type === 'string') {
        walk(val as WidgetNode);
      }
    }
  }

  walk(node);
  return counts;
}

function detectInteractions(screen: Screen): string[] {
  const interactions: string[] = [];
  const actions = collectAllActions(screen.body);
  if (screen.fab?.action) actions.push(screen.fab.action);

  const actionTypes = new Set(actions.map(a => a.type));

  if (actionTypes.has('addItem')) interactions.push('addItem');
  if (actionTypes.has('removeItem')) interactions.push('removeItem');
  if (actionTypes.has('toggleItemField')) interactions.push('toggleItemField');
  if (actionTypes.has('increment')) interactions.push('increment');
  if (actionTypes.has('decrement')) interactions.push('decrement');
  if (actionTypes.has('navigate')) interactions.push('navigate');

  return interactions;
}

function collectAllActions(node: WidgetNode): any[] {
  const results: any[] = [];
  const actionKeys = ['action', 'onToggle', 'onDismissed', 'onTap', 'onSubmit'];
  for (const key of actionKeys) {
    if (node.props?.[key]) results.push(node.props[key]);
  }
  for (const val of Object.values(node.props || {})) {
    if (val && typeof val === 'object' && 'type' in val && typeof val.type === 'string') {
      results.push(...collectAllActions(val as WidgetNode));
    }
  }
  if (node.children) {
    for (const child of node.children) {
      results.push(...collectAllActions(child));
    }
  }
  return results;
}
