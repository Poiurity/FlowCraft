import type { ChangeReport, ScreenSummary, ScreenModification } from './appstate-differ';

export interface Changelog {
  summary: string;
  changes: string[];
  usageTips: string[];
}

const WIDGET_LABELS: Record<string, string> = {
  text: '텍스트',
  button: '버튼',
  image: '이미지',
  icon: '아이콘',
  textField: '텍스트 입력 필드',
  checkbox: '체크박스',
  listView: '리스트뷰',
  listTile: '리스트 항목',
  card: '카드',
  switch: '스위치',
  divider: '구분선',
};

const THEME_LABELS: Record<string, string> = {
  primaryColor: '기본 색상',
  brightness: '밝기 모드',
  fontFamily: '글꼴',
  scaffoldBackgroundColor: '배경 색상',
  accentColor: '강조 색상',
};

const BRIGHTNESS_LABELS: Record<string, string> = {
  light: '라이트',
  dark: '다크',
};

const NAV_LABELS: Record<string, string> = {
  stack: '스택 네비게이션',
  bottomNav: '하단 탭 네비게이션',
  tabs: '탭 네비게이션',
};

export function explainChanges(report: ChangeReport, appName: string): Changelog {
  if (report.isNewApp) {
    return explainNewApp(report, appName);
  }
  return explainModification(report, appName);
}

// ── New app ──

function explainNewApp(report: ChangeReport, appName: string): Changelog {
  const changes: string[] = [];
  const usageTips: string[] = [];

  for (const screen of report.screensAdded) {
    const stateLabel = screen.hasState ? ' (상태 관리 포함)' : '';
    changes.push(`${screen.name} 화면${stateLabel}`);

    const widgetDescriptions = formatWidgetCounts(screen.widgetCounts);
    for (const desc of widgetDescriptions) {
      changes.push(`  - ${desc}`);
    }

    usageTips.push(...getInteractionTips(screen.interactions, screen.widgetCounts));
  }

  return {
    summary: `${appName} 앱이 생성되었습니다.`,
    changes,
    usageTips,
  };
}

// ── Modification ──

function explainModification(report: ChangeReport, appName: string): Changelog {
  const changes: string[] = [];
  const usageTips: string[] = [];

  if (report.appNameChanged) {
    changes.push(`앱 이름이 "${report.appNameChanged.from}" → "${report.appNameChanged.to}"(으)로 변경됨`);
  }

  for (const tc of report.themeChanges) {
    const label = THEME_LABELS[tc.field] || tc.field;
    if (tc.field === 'brightness') {
      const fromLabel = BRIGHTNESS_LABELS[tc.from || ''] || tc.from;
      const toLabel = BRIGHTNESS_LABELS[tc.to || ''] || tc.to;
      changes.push(`${label}가 ${fromLabel} → ${toLabel} 모드로 변경됨`);
    } else if (tc.from && tc.to) {
      changes.push(`${label}가 ${tc.from} → ${tc.to}(으)로 변경됨`);
    } else if (tc.to) {
      changes.push(`${label}가 ${tc.to}(으)로 설정됨`);
    } else {
      changes.push(`${label}가 제거됨`);
    }
  }

  if (report.navigationChanged) {
    const from = NAV_LABELS[report.navigationChanged.from] || report.navigationChanged.from;
    const to = NAV_LABELS[report.navigationChanged.to] || report.navigationChanged.to;
    changes.push(`네비게이션이 ${from} → ${to}(으)로 변경됨`);
    if (report.navigationChanged.to === 'bottomNav') {
      usageTips.push('하단 탭을 눌러 화면 간 전환');
    }
  }

  for (const screen of report.screensAdded) {
    const stateLabel = screen.hasState ? ' (상태 관리 포함)' : '';
    changes.push(`${screen.name} 화면 추가됨${stateLabel}`);
    usageTips.push(...getInteractionTips(screen.interactions, screen.widgetCounts));
  }

  for (const name of report.screensRemoved) {
    changes.push(`${name} 화면 삭제됨`);
  }

  for (const mod of report.screensModified) {
    changes.push(...explainScreenModification(mod));
    usageTips.push(...getInteractionTips(mod.interactionsAdded, mod.widgetsAdded));
  }

  const summary = changes.length > 0
    ? `${appName} 앱이 수정되었습니다.`
    : `${appName} 앱이 수정되었습니다. (미세 변경)`;

  return { summary, changes, usageTips };
}

// ── Screen modification explanation ──

function explainScreenModification(mod: ScreenModification): string[] {
  const lines: string[] = [];

  for (const [type, count] of Object.entries(mod.widgetsAdded)) {
    const label = WIDGET_LABELS[type] || type;
    lines.push(`${mod.name}에 ${label} ${count}개 추가됨`);
  }

  for (const [type, count] of Object.entries(mod.widgetsRemoved)) {
    const label = WIDGET_LABELS[type] || type;
    lines.push(`${mod.name}에서 ${label} ${count}개 삭제됨`);
  }

  for (const v of mod.stateAdded) {
    lines.push(`${mod.name}에 상태 변수 "${v}" 추가됨`);
  }

  for (const v of mod.stateRemoved) {
    lines.push(`${mod.name}에서 상태 변수 "${v}" 삭제됨`);
  }

  if (mod.appBarChanged) {
    lines.push(`${mod.name}의 앱바가 변경됨`);
  }

  if (mod.fabChanged) {
    lines.push(`${mod.name}의 플로팅 액션 버튼이 변경됨`);
  }

  return lines;
}

// ── Interaction tips ──

function getInteractionTips(
  interactions: string[],
  widgetCounts: Record<string, number>
): string[] {
  const tips: string[] = [];

  if (interactions.includes('addItem') && widgetCounts['textField']) {
    tips.push('텍스트 필드에 내용을 입력하고 버튼을 눌러 항목 추가');
  }

  if (interactions.includes('toggleItemField') && widgetCounts['checkbox']) {
    tips.push('체크박스를 눌러 완료/미완료 전환');
  }

  if (interactions.includes('removeItem')) {
    tips.push('항목을 왼쪽으로 스와이프하여 삭제');
  }

  if (interactions.includes('increment') || interactions.includes('decrement')) {
    tips.push('버튼을 눌러 숫자 증가/감소');
  }

  if (interactions.includes('navigate')) {
    tips.push('버튼을 눌러 다른 화면으로 이동');
  }

  return tips;
}

// ── Widget count formatting ──

function formatWidgetCounts(counts: Record<string, number>): string[] {
  const lines: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    const label = WIDGET_LABELS[type] || type;
    lines.push(`${label} ${count}개`);
  }
  return lines;
}
