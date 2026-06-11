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
}

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
};

export const ORCHESTRATOR_LABELS: Record<Lang, OrchestratorLabels> = { ko, en };

export function resolveLang(value: unknown): Lang {
  return value === 'en' ? 'en' : 'ko';
}
