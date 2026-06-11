// Localized stage labels emitted by the ClosedLoopOrchestrator over SSE.
// The frontend prefers these (they carry counts) over its generic dictionary,
// so they are produced in the language requested at generation time.

export type Lang = 'ko' | 'en';

export interface OrchestratorLabels {
  verifyClean: string;
  verifyIssues: (n: number) => string;
  repairDone: (attempt: number, max: number) => string;
  clarifyActive: string;
  extendActive: string;
  extendDone: (n: number) => string;
  structureActive: string;
  structureDone: (n: number) => string;
  structureFixActive: string;
  structureFixDone: (n: number) => string;
  structureScreens: (n: number) => string;
  designActive: string;
  designDone: string;
  designFixActive: string;
  designThemeFixActive: string;
  designFixDone: string;
  mergeActive: string;
  mergeDone: string;
  codegenActive: string;
  codegenDone: (n: number) => string;
  verifyActive: string;
  verifyReActive: string;
  repairActive: (attempt: number, max: number) => string;
  planActive: string;
  planDone: (n: number) => string;
  composeActive: string;
  composeDone: (n: number) => string;
  segmentActive: (screenName: string) => string;
  segmentDone: (screenName: string) => string;
  criticActive: string;
  criticSkip: string;
  criticScope: string;
  // Per-agent activity trace surfaced in the Activity tab ("thinking" + decision rows).
  activity: {
    clarify: (c: any) => ActivityDetail;
    extend: (added: string[], requested: string[]) => ActivityDetail;
    structure: (r: any) => ActivityDetail;
    design: (d: any) => ActivityDetail;
    plan: (p: any) => ActivityDetail;
    codegen: (appState: any, lines: number) => ActivityDetail;
  };
}

export interface ActivityRow { label: string; value?: string; }
export interface ActivityDetail { thinking: string; rows: ActivityRow[]; }

// Shared helpers (language-neutral) so the ko/en builders stay short.
function vlist(r: any): any[] { return r?.screens?.[0]?.screenState?.variables ?? []; }

const ko: OrchestratorLabels = {
  verifyClean: '검증 완료 · 문제 없음',
  verifyIssues: (n) => `검증 완료 · ${n}개 문제`,
  repairDone: (a, m) => `${a}/${m}회 수정 완료`,
  clarifyActive: '요구사항 분석 중…',
  extendActive: '위젯 준비 중…',
  extendDone: (n) => `${n}개 위젯 준비`,
  structureActive: '화면 구조 생성 중…',
  structureDone: (n) => `${n}개 화면 구조`,
  structureFixActive: '화면 구조 수정 중…',
  structureFixDone: (n) => `${n}개 화면 수정`,
  structureScreens: (n) => `${n}개 화면`,
  designActive: '테마 및 스타일 생성 중…',
  designDone: '테마 완성',
  designFixActive: '테마 및 스타일 수정 중…',
  designThemeFixActive: '테마 수정 중…',
  designFixDone: '디자인 수정 완료',
  mergeActive: '상태 병합 중…',
  mergeDone: '병합 완성',
  codegenActive: 'Dart 코드 생성 중…',
  codegenDone: (n) => `${n}개 화면 생성`,
  verifyActive: '코드 검증 중…',
  verifyReActive: '코드 재검증 중…',
  repairActive: (a, m) => `오류 수정 중… (${a}/${m})`,
  planActive: '앱 구조 기획 중…',
  planDone: (n) => `${n}개 화면 기획`,
  composeActive: '화면 조합 중…',
  composeDone: (n) => `${n}개 화면 조합 완성`,
  segmentActive: (name) => `${name} 화면 생성 중…`,
  segmentDone: (name) => `${name} 완성`,
  criticActive: '충실도 평가 중…',
  criticSkip: '평가 완료 (스킵)',
  criticScope: '레이아웃 및 테마; 런타임 동작 제외',
  activity: {
    clarify: (c) => ({
      thinking: `요청을 '${c.intent}' 작업으로 해석${c.requiredWidgets?.length ? ` → 위젯 ${c.requiredWidgets.length}개 준비 필요 (${c.requiredWidgets.join(', ')})` : ' → 기존 위젯으로 충분'}`,
      rows: [
        { label: '의도', value: c.intent },
        { label: '필요 위젯', value: c.requiredWidgets?.length ? c.requiredWidgets.join(', ') : '없음' },
        { label: '디자인 방향', value: c.designDirection || '기본' },
      ],
    }),
    extend: (added, requested) => ({
      thinking: `위젯 ${requested.length}개 중 ${added.length}개를 새로 정의${added.length ? ` (${added.join(', ')})` : ' — 모두 기존 보유'}`,
      rows: [
        { label: '새로 추가', value: added.length ? added.join(', ') : '없음' },
        { label: '이미 보유', value: requested.filter(w => !added.includes(w)).join(', ') || '없음' },
      ],
    }),
    structure: (r) => {
      const vars = vlist(r);
      return {
        thinking: `"${r.screens?.[0]?.name}" 화면 구성 — 상태 변수 ${vars.length}개${vars.length ? ` (${vars.map((v: any) => v.name).join(', ')})` : ''}, ${r.navigation?.type ?? 'stack'} 네비게이션`,
        rows: [
          { label: '앱 이름', value: r.appName },
          { label: '화면', value: r.screens?.[0]?.name },
          { label: '상태 변수', value: vars.length ? vars.map((v: any) => `${v.name}:${v.type}`).join(', ') : '없음' },
          { label: '네비게이션', value: r.navigation?.type ?? 'stack' },
        ],
      };
    },
    design: (d) => ({
      thinking: `${d.theme?.brightness === 'dark' ? '다크' : '라이트'} 테마 · 기본 색상 ${d.theme?.primaryColor}${d.theme?.fontFamily ? ` · 글꼴 ${d.theme.fontFamily}` : ''}`,
      rows: [
        { label: '기본 색상', value: d.theme?.primaryColor },
        { label: '밝기', value: d.theme?.brightness === 'dark' ? '다크' : '라이트' },
        { label: '글꼴', value: d.theme?.fontFamily || '기본' },
      ],
    }),
    plan: (p) => ({
      thinking: `${p.appName}을(를) ${p.segments.length}개 화면으로 기획 (${p.navigationStyle}) — ${p.segments.map((s: any) => s.screenName).join(', ')}`,
      rows: [
        { label: '화면 수', value: String(p.segments.length) },
        { label: '화면', value: p.segments.map((s: any) => s.screenName).join(', ') },
        { label: '네비게이션', value: p.navigationStyle },
      ],
    }),
    codegen: (appState, lines) => ({
      thinking: `${appState.screens.length}개 화면을 Flutter 코드로 생성 (약 ${lines}줄)`,
      rows: [
        { label: '화면 수', value: String(appState.screens.length) },
        { label: '코드 줄 수', value: String(lines) },
      ],
    }),
  },
};

const en: OrchestratorLabels = {
  verifyClean: 'Verified · no issues',
  verifyIssues: (n) => `Verified · ${n} issue${n === 1 ? '' : 's'}`,
  repairDone: (a, m) => `Repaired ${a}/${m}`,
  clarifyActive: 'Analyzing requirements…',
  extendActive: 'Preparing widgets…',
  extendDone: (n) => `${n} widget${n === 1 ? '' : 's'} prepared`,
  structureActive: 'Generating screen structure…',
  structureDone: (n) => `${n} screen${n === 1 ? '' : 's'} structured`,
  structureFixActive: 'Revising screen structure…',
  structureFixDone: (n) => `${n} screen${n === 1 ? '' : 's'} revised`,
  structureScreens: (n) => `${n} screen${n === 1 ? '' : 's'}`,
  designActive: 'Generating theme & style…',
  designDone: 'Theme complete',
  designFixActive: 'Revising theme & style…',
  designThemeFixActive: 'Revising theme…',
  designFixDone: 'Design revised',
  mergeActive: 'Merging state…',
  mergeDone: 'Merge complete',
  codegenActive: 'Generating Dart code…',
  codegenDone: (n) => `${n} screen${n === 1 ? '' : 's'} generated`,
  verifyActive: 'Verifying code…',
  verifyReActive: 'Re-verifying code…',
  repairActive: (a, m) => `Repairing errors… (${a}/${m})`,
  planActive: 'Planning app structure…',
  planDone: (n) => `${n} screen${n === 1 ? '' : 's'} planned`,
  composeActive: 'Composing screens…',
  composeDone: (n) => `${n} screen${n === 1 ? '' : 's'} composed`,
  segmentActive: (name) => `Generating ${name} screen…`,
  segmentDone: (name) => `${name} done`,
  criticActive: 'Scoring fidelity…',
  criticSkip: 'Scored (skipped)',
  criticScope: 'Layout & theme; runtime behavior excluded',
  activity: {
    clarify: (c) => ({
      thinking: `Read this as a '${c.intent}' request${c.requiredWidgets?.length ? ` → needs ${c.requiredWidgets.length} widget(s) (${c.requiredWidgets.join(', ')})` : ' → existing widgets suffice'}`,
      rows: [
        { label: 'Intent', value: c.intent },
        { label: 'Required widgets', value: c.requiredWidgets?.length ? c.requiredWidgets.join(', ') : 'none' },
        { label: 'Design direction', value: c.designDirection || 'default' },
      ],
    }),
    extend: (added, requested) => ({
      thinking: `Of ${requested.length} widget(s), defined ${added.length} new${added.length ? ` (${added.join(', ')})` : ' — all already in the registry'}`,
      rows: [
        { label: 'Newly added', value: added.length ? added.join(', ') : 'none' },
        { label: 'Already present', value: requested.filter(w => !added.includes(w)).join(', ') || 'none' },
      ],
    }),
    structure: (r) => {
      const vars = vlist(r);
      return {
        thinking: `Composing the "${r.screens?.[0]?.name}" screen — ${vars.length} state variable(s)${vars.length ? ` (${vars.map((v: any) => v.name).join(', ')})` : ''}, ${r.navigation?.type ?? 'stack'} navigation`,
        rows: [
          { label: 'App name', value: r.appName },
          { label: 'Screen', value: r.screens?.[0]?.name },
          { label: 'State variables', value: vars.length ? vars.map((v: any) => `${v.name}:${v.type}`).join(', ') : 'none' },
          { label: 'Navigation', value: r.navigation?.type ?? 'stack' },
        ],
      };
    },
    design: (d) => ({
      thinking: `A ${d.theme?.brightness ?? 'light'} theme · primary color ${d.theme?.primaryColor}${d.theme?.fontFamily ? ` · ${d.theme.fontFamily} typography` : ''}`,
      rows: [
        { label: 'Primary color', value: d.theme?.primaryColor },
        { label: 'Brightness', value: d.theme?.brightness ?? 'light' },
        { label: 'Font', value: d.theme?.fontFamily || 'default' },
      ],
    }),
    plan: (p) => ({
      thinking: `Planning ${p.appName} as ${p.segments.length} screen(s) (${p.navigationStyle}) — ${p.segments.map((s: any) => s.screenName).join(', ')}`,
      rows: [
        { label: 'Screen count', value: String(p.segments.length) },
        { label: 'Screens', value: p.segments.map((s: any) => s.screenName).join(', ') },
        { label: 'Navigation', value: p.navigationStyle },
      ],
    }),
    codegen: (appState, lines) => ({
      thinking: `Generating Flutter code for ${appState.screens.length} screen(s) (~${lines} lines)`,
      rows: [
        { label: 'Screens', value: String(appState.screens.length) },
        { label: 'Lines of code', value: String(lines) },
      ],
    }),
  },
};

export const ORCHESTRATOR_LABELS: Record<Lang, OrchestratorLabels> = { ko, en };

export function resolveLang(value: unknown): Lang {
  return value === 'en' ? 'en' : 'ko';
}
