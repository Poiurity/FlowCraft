import type { ChangeReport, ScreenModification } from './appstate-differ';
import type { Lang } from './agents/pipeline-labels';

export interface Changelog {
  summary: string;
  changes: string[];
  usageTips: string[];
}

// ── Localized strings ─────────────────────────────────────────────────────────

interface ChangelogStrings {
  widgetLabels: Record<string, string>;
  themeLabels: Record<string, string>;
  brightnessLabels: Record<string, string>;
  navLabels: Record<string, string>;
  withState: string;
  appCreated: (appName: string) => string;
  appModified: (appName: string, minor: boolean) => string;
  screen: (name: string, state: string) => string;
  screenAdded: (name: string, state: string) => string;
  screenRemoved: (name: string) => string;
  appNameChanged: (from: string, to: string) => string;
  themeChange: (label: string, from: string, to: string) => string;
  themeSet: (label: string, to: string) => string;
  themeRemoved: (label: string) => string;
  navChange: (from: string, to: string) => string;
  widgetAdded: (name: string, label: string, count: number) => string;
  widgetRemoved: (name: string, label: string, count: number) => string;
  stateAdded: (name: string, v: string) => string;
  stateRemoved: (name: string, v: string) => string;
  appBarChanged: (name: string) => string;
  fabChanged: (name: string) => string;
  widgetCount: (label: string, count: number) => string;
  tips: { addItem: string; toggle: string; remove: string; incdec: string; navigate: string; bottomNav: string };
}

const ko: ChangelogStrings = {
  widgetLabels: {
    text: '텍스트', button: '버튼', image: '이미지', icon: '아이콘', textField: '텍스트 입력 필드',
    checkbox: '체크박스', listView: '리스트뷰', listTile: '리스트 항목', card: '카드',
    switch: '스위치', divider: '구분선', dropdown: '드롭다운', radioGroup: '라디오 그룹',
  },
  themeLabels: {
    primaryColor: '기본 색상', brightness: '밝기 모드', fontFamily: '글꼴',
    scaffoldBackgroundColor: '배경 색상', accentColor: '강조 색상',
  },
  brightnessLabels: { light: '라이트', dark: '다크' },
  navLabels: { stack: '스택 네비게이션', bottomNav: '하단 탭 네비게이션', tabs: '탭 네비게이션' },
  withState: ' (상태 관리 포함)',
  appCreated: (n) => `${n} 앱이 생성되었습니다.`,
  appModified: (n, minor) => `${n} 앱이 수정되었습니다.${minor ? ' (미세 변경)' : ''}`,
  screen: (name, state) => `${name} 화면${state}`,
  screenAdded: (name, state) => `${name} 화면 추가됨${state}`,
  screenRemoved: (name) => `${name} 화면 삭제됨`,
  appNameChanged: (from, to) => `앱 이름이 "${from}" → "${to}"(으)로 변경됨`,
  themeChange: (label, from, to) => `${label}가 ${from} → ${to}(으)로 변경됨`,
  themeSet: (label, to) => `${label}가 ${to}(으)로 설정됨`,
  themeRemoved: (label) => `${label}가 제거됨`,
  navChange: (from, to) => `네비게이션이 ${from} → ${to}(으)로 변경됨`,
  widgetAdded: (name, label, count) => `${name}에 ${label} ${count}개 추가됨`,
  widgetRemoved: (name, label, count) => `${name}에서 ${label} ${count}개 삭제됨`,
  stateAdded: (name, v) => `${name}에 상태 변수 "${v}" 추가됨`,
  stateRemoved: (name, v) => `${name}에서 상태 변수 "${v}" 삭제됨`,
  appBarChanged: (name) => `${name}의 앱바가 변경됨`,
  fabChanged: (name) => `${name}의 플로팅 액션 버튼이 변경됨`,
  widgetCount: (label, count) => `${label} ${count}개`,
  tips: {
    addItem: '텍스트 필드에 내용을 입력하고 버튼을 눌러 항목 추가',
    toggle: '체크박스를 눌러 완료/미완료 전환',
    remove: '항목을 왼쪽으로 스와이프하여 삭제',
    incdec: '버튼을 눌러 숫자 증가/감소',
    navigate: '버튼을 눌러 다른 화면으로 이동',
    bottomNav: '하단 탭을 눌러 화면 간 전환',
  },
};

const en: ChangelogStrings = {
  widgetLabels: {
    text: 'text', button: 'button', image: 'image', icon: 'icon', textField: 'text field',
    checkbox: 'checkbox', listView: 'list view', listTile: 'list item', card: 'card',
    switch: 'switch', divider: 'divider', dropdown: 'dropdown', radioGroup: 'radio group',
  },
  themeLabels: {
    primaryColor: 'Primary color', brightness: 'Brightness', fontFamily: 'Font',
    scaffoldBackgroundColor: 'Background color', accentColor: 'Accent color',
  },
  brightnessLabels: { light: 'Light', dark: 'Dark' },
  navLabels: { stack: 'stack navigation', bottomNav: 'bottom tab navigation', tabs: 'tab navigation' },
  withState: ' (with state)',
  appCreated: (n) => `${n} app created.`,
  appModified: (n, minor) => `${n} app updated.${minor ? ' (minor changes)' : ''}`,
  screen: (name, state) => `${name} screen${state}`,
  screenAdded: (name, state) => `Added ${name} screen${state}`,
  screenRemoved: (name) => `Removed ${name} screen`,
  appNameChanged: (from, to) => `App name changed "${from}" → "${to}"`,
  themeChange: (label, from, to) => `${label} changed ${from} → ${to}`,
  themeSet: (label, to) => `${label} set to ${to}`,
  themeRemoved: (label) => `${label} removed`,
  navChange: (from, to) => `Navigation changed ${from} → ${to}`,
  widgetAdded: (name, label, count) => `Added ${count} ${label}${count === 1 ? '' : 's'} to ${name}`,
  widgetRemoved: (name, label, count) => `Removed ${count} ${label}${count === 1 ? '' : 's'} from ${name}`,
  stateAdded: (name, v) => `Added state variable "${v}" to ${name}`,
  stateRemoved: (name, v) => `Removed state variable "${v}" from ${name}`,
  appBarChanged: (name) => `${name} app bar changed`,
  fabChanged: (name) => `${name} floating action button changed`,
  widgetCount: (label, count) => `${count} ${label}${count === 1 ? '' : 's'}`,
  tips: {
    addItem: 'Type in the text field and press the button to add an item',
    toggle: 'Tap the checkbox to toggle complete/incomplete',
    remove: 'Swipe an item left to delete',
    incdec: 'Press the buttons to increase/decrease the number',
    navigate: 'Press the button to go to another screen',
    bottomNav: 'Tap the bottom tabs to switch screens',
  },
};

const STRINGS: Record<Lang, ChangelogStrings> = { ko, en };

// ── Public API ────────────────────────────────────────────────────────────────

export function explainChanges(report: ChangeReport, appName: string, lang: Lang = 'ko'): Changelog {
  const s = STRINGS[lang] ?? STRINGS.ko;
  if (report.isNewApp) {
    return explainNewApp(report, appName, s);
  }
  return explainModification(report, appName, s);
}

// ── New app ──

function explainNewApp(report: ChangeReport, appName: string, s: ChangelogStrings): Changelog {
  const changes: string[] = [];
  const usageTips: string[] = [];

  for (const screen of report.screensAdded) {
    const stateLabel = screen.hasState ? s.withState : '';
    changes.push(s.screen(screen.name, stateLabel));

    for (const desc of formatWidgetCounts(screen.widgetCounts, s)) {
      changes.push(`  - ${desc}`);
    }

    usageTips.push(...getInteractionTips(screen.interactions, screen.widgetCounts, s));
  }

  return {
    summary: s.appCreated(appName),
    changes,
    usageTips,
  };
}

// ── Modification ──

function explainModification(report: ChangeReport, appName: string, s: ChangelogStrings): Changelog {
  const changes: string[] = [];
  const usageTips: string[] = [];

  if (report.appNameChanged) {
    changes.push(s.appNameChanged(report.appNameChanged.from, report.appNameChanged.to));
  }

  for (const tc of report.themeChanges) {
    const label = s.themeLabels[tc.field] || tc.field;
    if (tc.field === 'brightness') {
      const fromLabel = s.brightnessLabels[tc.from || ''] || tc.from || '';
      const toLabel = s.brightnessLabels[tc.to || ''] || tc.to || '';
      changes.push(s.themeChange(label, fromLabel, toLabel));
    } else if (tc.from && tc.to) {
      changes.push(s.themeChange(label, tc.from, tc.to));
    } else if (tc.to) {
      changes.push(s.themeSet(label, tc.to));
    } else {
      changes.push(s.themeRemoved(label));
    }
  }

  if (report.navigationChanged) {
    const from = s.navLabels[report.navigationChanged.from] || report.navigationChanged.from;
    const to = s.navLabels[report.navigationChanged.to] || report.navigationChanged.to;
    changes.push(s.navChange(from, to));
    if (report.navigationChanged.to === 'bottomNav') {
      usageTips.push(s.tips.bottomNav);
    }
  }

  for (const screen of report.screensAdded) {
    const stateLabel = screen.hasState ? s.withState : '';
    changes.push(s.screenAdded(screen.name, stateLabel));
    usageTips.push(...getInteractionTips(screen.interactions, screen.widgetCounts, s));
  }

  for (const name of report.screensRemoved) {
    changes.push(s.screenRemoved(name));
  }

  for (const mod of report.screensModified) {
    changes.push(...explainScreenModification(mod, s));
    usageTips.push(...getInteractionTips(mod.interactionsAdded, mod.widgetsAdded, s));
  }

  return { summary: s.appModified(appName, changes.length === 0), changes, usageTips };
}

// ── Screen modification explanation ──

function explainScreenModification(mod: ScreenModification, s: ChangelogStrings): string[] {
  const lines: string[] = [];

  for (const [type, count] of Object.entries(mod.widgetsAdded)) {
    lines.push(s.widgetAdded(mod.name, s.widgetLabels[type] || type, count));
  }
  for (const [type, count] of Object.entries(mod.widgetsRemoved)) {
    lines.push(s.widgetRemoved(mod.name, s.widgetLabels[type] || type, count));
  }
  for (const v of mod.stateAdded) {
    lines.push(s.stateAdded(mod.name, v));
  }
  for (const v of mod.stateRemoved) {
    lines.push(s.stateRemoved(mod.name, v));
  }
  if (mod.appBarChanged) lines.push(s.appBarChanged(mod.name));
  if (mod.fabChanged) lines.push(s.fabChanged(mod.name));

  return lines;
}

// ── Interaction tips ──

function getInteractionTips(
  interactions: string[],
  widgetCounts: Record<string, number>,
  s: ChangelogStrings,
): string[] {
  const tips: string[] = [];
  if (interactions.includes('addItem') && widgetCounts['textField']) tips.push(s.tips.addItem);
  if (interactions.includes('toggleItemField') && widgetCounts['checkbox']) tips.push(s.tips.toggle);
  if (interactions.includes('removeItem')) tips.push(s.tips.remove);
  if (interactions.includes('increment') || interactions.includes('decrement')) tips.push(s.tips.incdec);
  if (interactions.includes('navigate')) tips.push(s.tips.navigate);
  return tips;
}

// ── Widget count formatting ──

function formatWidgetCounts(counts: Record<string, number>, s: ChangelogStrings): string[] {
  const lines: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    lines.push(s.widgetCount(s.widgetLabels[type] || type, count));
  }
  return lines;
}
