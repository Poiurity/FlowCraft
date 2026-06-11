// Centralized UI string dictionary for runtime language switching (ko / en).
// All user-facing chrome lives here. Model-generated content (changelog text,
// critic summaries produced by the LLM) is NOT translated — only UI framing.

export type Lang = 'ko' | 'en';

export interface StageMetaEntry {
  name: string;
  activeLabel: string;
  doneLabel: string;
}

export interface Dict {
  /** Display name of this language, used in the toggle */
  label: string;
  htmlLang: string;

  stageMeta: Record<string, StageMetaEntry>;

  chat: {
    greeting: string;
    errorPrefix: (msg: string) => string;
    loading: string;
    placeholder: string;
  };
  chip: {
    repairs: (n: number) => string;
    fidelity: (n: number) => string;
    warnings: string;
  };
  tabs: { activity: string; preview: string; code: string; state: string };
  rail: { title: string; aria: string; running: string; partial: string; done: string };
  spine: { idle: string; title: string; skip: string };
  repair: {
    chip: (cur: number, total: number) => string;
    issuesSuffix: string;
    noChange: string;
    copy: (n: number) => string;
    limitTitle: string;
    fallbackNote: string;
  };
  critic: {
    fidelityLabel: (s: number) => string;
    scopePrefix: string;
    summary: (f: number) => string;
    defaultScope: string;
  };
  done: {
    success: string;
    partial: string;
    withWarnings: string;
    fidelityMetric: (n: number, label: string) => string;
    repairs: (n: number) => string;
    screens: (n: number) => string;
    degradeLabel: string;
    criticWarn: string;
    criticReloop: string;
    regenerate: string;
    undo: string;
  };
  stageCard: { issuesTitle: string };
  stageNode: { estimatedTitle: string };
  device: {
    phone: string;
    tablet: string;
    desktop: string;
    previewLabel: string;
    openDartPad: string;
    empty: string;
    regenerating: string;
    iframeTitle: string;
  };
  code: { empty: string; copy: string; copied: string; copyTitle: string };
  stateView: { empty: string };
  header: { subtitle: string };
  reducer: {
    verifyDone: (ok: boolean, count: number) => string;
    repairLabel: (attempt: number, max: number) => string;
    criticLabel: (fidelity: number) => string;
    rowBefore: string;
    rowApplied: string;
    rowDropped: string;
    count: (n: number) => string;
    segmentActive: (name: string) => string;
    segmentDone: (name: string) => string;
  };
  replay: {
    clarifyDone: string;
    extendDone: string;
    mergeDone: string;
    codegenScreens: (n: number) => string;
    codegenDone: string;
    scope: string;
  };
}

const ko: Dict = {
  label: '한국어',
  htmlLang: 'ko',
  stageMeta: {
    clarify:   { name: '요구사항 분석', activeLabel: '요구사항 분석 중…', doneLabel: '요구사항 확정' },
    extend:    { name: '위젯 준비',    activeLabel: '위젯 준비 중…',    doneLabel: '위젯 목록 확정' },
    structure: { name: '구조 설계',    activeLabel: '화면 구조 생성 중…', doneLabel: '화면 구조 완성' },
    design:    { name: '디자인 설계',  activeLabel: '테마 및 스타일 생성 중…', doneLabel: '디자인 완성' },
    plan:      { name: '앱 기획',      activeLabel: '앱 구조 기획 중…', doneLabel: '기획 완성' },
    compose:   { name: '화면 조합',    activeLabel: '화면 조합 중…',    doneLabel: '화면 조합 완성' },
    merge:     { name: '병합',         activeLabel: '상태 병합 중…',    doneLabel: '병합 완성' },
    codegen:   { name: '코드 생성',    activeLabel: 'Dart 코드 생성 중…', doneLabel: '코드 생성 완성' },
    verify:    { name: '검증',         activeLabel: '코드 검증 중…',    doneLabel: '검증 완료' },
    repair:    { name: '수정',         activeLabel: '오류 수정 중…',    doneLabel: '수정 완료' },
    critic:    { name: '품질 평가',    activeLabel: '충실도 평가 중…',  doneLabel: '평가 완료' },
  },
  chat: {
    greeting: '만들고 싶은 앱을 자유롭게 설명해 주세요.\n\n예: "할 일 목록이 있는 투두 앱 만들어줘"',
    errorPrefix: (msg) => `오류가 발생했습니다: ${msg}`,
    loading: '생성 중…',
    placeholder: '앱을 설명해 주세요…',
  },
  chip: {
    repairs: (n) => `${n}회 수정`,
    fidelity: (n) => `일치도 ${n}%`,
    warnings: '경고 있음',
  },
  tabs: { activity: '활동', preview: '미리보기', code: '코드', state: '상태' },
  rail: {
    title: '파이프라인 상태 — 클릭하여 활동 탭 열기',
    aria: '파이프라인 상태',
    running: '실행 중',
    partial: '부분 완료',
    done: '완료',
  },
  spine: {
    idle: '프롬프트를 입력하면 파이프라인이 시작됩니다',
    title: '파이프라인',
    skip: '건너뛰기',
  },
  repair: {
    chip: (cur, total) => `수정 · ${cur}/${total}회`,
    issuesSuffix: '문제',
    noChange: '(변동 없음)',
    copy: (n) => `${n} 문제 발견 → 패치 적용 중 → 재검증`,
    limitTitle: '수정 한계 도달',
    fallbackNote: '기본 구조로 되돌아갑니다.',
  },
  critic: {
    fidelityLabel: (s) => (s >= 85 ? '높은 일치도' : s >= 65 ? '보통 일치도' : '낮은 일치도'),
    scopePrefix: '범위: ',
    summary: (f) =>
      f >= 85
        ? '요청과 높은 일치도를 보입니다.'
        : f >= 65
        ? '대부분 일치하나 일부 차이가 있습니다.'
        : '일부 요구사항이 반영되지 않았을 수 있습니다.',
    defaultScope: '레이아웃 및 테마; 런타임 동작 제외',
  },
  done: {
    success: '앱 생성 완료',
    partial: '부분 생성 완료',
    withWarnings: '생성 완료 (경고 있음)',
    fidelityMetric: (n, label) => `일치도 ${n}% — ${label}`,
    repairs: (n) => `${n}회 수정`,
    screens: (n) => `${n}개 화면`,
    degradeLabel: '부분 완료 이유:',
    criticWarn: '일부 요구사항이 완전히 반영되지 않았을 수 있습니다.',
    criticReloop: '품질 기준을 충족하지 못했습니다. 재생성을 고려하세요.',
    regenerate: '재생성',
    undo: '되돌리기',
  },
  stageCard: { issuesTitle: '발견된 문제' },
  stageNode: { estimatedTitle: '예상 시간' },
  device: {
    phone: '폰',
    tablet: '태블릿',
    desktop: '데스크톱',
    previewLabel: 'Flutter 미리보기',
    openDartPad: 'DartPad에서 열기',
    empty: '앱을 생성하면 미리보기가 표시됩니다',
    regenerating: '재생성 중…',
    iframeTitle: 'DartPad 미리보기',
  },
  code: { empty: '코드가 생성되면 여기에 표시됩니다', copy: '복사', copied: '복사됨', copyTitle: '복사' },
  stateView: { empty: '아직 AppState가 없습니다' },
  header: { subtitle: 'AI 앱 빌더' },
  reducer: {
    verifyDone: (ok, count) => (ok ? '검증 완료 · 문제 없음' : `검증 완료 · ${count}개 문제 발견`),
    repairLabel: (attempt, max) => `수정 · ${attempt}/${max}회`,
    criticLabel: (fidelity) => `품질 평가 · ${fidelity}점`,
    rowBefore: '수정 전 문제',
    rowApplied: '패치 적용',
    rowDropped: '패치 실패',
    count: (n) => `${n}개`,
    segmentActive: (name) => `${name} 화면 생성 중…`,
    segmentDone: (name) => `${name} 화면 완성`,
  },
  replay: {
    clarifyDone: '요구사항 확정',
    extendDone: '위젯 목록 확정',
    mergeDone: '상태 병합 완성',
    codegenScreens: (n) => `${n}개 화면 생성`,
    codegenDone: '코드 생성 완성',
    scope: '레이아웃 및 테마; 런타임 동작 제외',
  },
};

const en: Dict = {
  label: 'English',
  htmlLang: 'en',
  stageMeta: {
    clarify:   { name: 'Analyze',     activeLabel: 'Analyzing requirements…', doneLabel: 'Requirements set' },
    extend:    { name: 'Widgets',     activeLabel: 'Preparing widgets…',      doneLabel: 'Widget list set' },
    structure: { name: 'Structure',   activeLabel: 'Generating screen structure…', doneLabel: 'Structure complete' },
    design:    { name: 'Design',      activeLabel: 'Generating theme & style…', doneLabel: 'Design complete' },
    plan:      { name: 'Plan',        activeLabel: 'Planning app structure…', doneLabel: 'Plan complete' },
    compose:   { name: 'Compose',     activeLabel: 'Composing screens…',      doneLabel: 'Screens composed' },
    merge:     { name: 'Merge',       activeLabel: 'Merging state…',          doneLabel: 'Merge complete' },
    codegen:   { name: 'Code',        activeLabel: 'Generating Dart code…',   doneLabel: 'Code generated' },
    verify:    { name: 'Verify',      activeLabel: 'Verifying code…',         doneLabel: 'Verified' },
    repair:    { name: 'Repair',      activeLabel: 'Repairing errors…',       doneLabel: 'Repaired' },
    critic:    { name: 'Quality',     activeLabel: 'Scoring fidelity…',       doneLabel: 'Scored' },
  },
  chat: {
    greeting: 'Describe the app you want to build.\n\nExample: "Build a to-do app with a task list"',
    errorPrefix: (msg) => `Something went wrong: ${msg}`,
    loading: 'Generating…',
    placeholder: 'Describe your app…',
  },
  chip: {
    repairs: (n) => `${n} repair${n === 1 ? '' : 's'}`,
    fidelity: (n) => `${n}% match`,
    warnings: 'Has warnings',
  },
  tabs: { activity: 'Activity', preview: 'Preview', code: 'Code', state: 'State' },
  rail: {
    title: 'Pipeline status — click to open the Activity tab',
    aria: 'Pipeline status',
    running: 'Running',
    partial: 'Partial',
    done: 'Done',
  },
  spine: {
    idle: 'Enter a prompt to start the pipeline',
    title: 'Pipeline',
    skip: 'Skip',
  },
  repair: {
    chip: (cur, total) => `Repair · ${cur}/${total}`,
    issuesSuffix: 'issues',
    noChange: '(no change)',
    copy: (n) => `${n} issue${n === 1 ? '' : 's'} found → applying patches → re-verifying`,
    limitTitle: 'Repair limit reached',
    fallbackNote: 'Falling back to the base structure.',
  },
  critic: {
    fidelityLabel: (s) => (s >= 85 ? 'High match' : s >= 65 ? 'Moderate match' : 'Low match'),
    scopePrefix: 'Scope: ',
    summary: (f) =>
      f >= 85
        ? 'Closely matches the request.'
        : f >= 65
        ? 'Mostly matches, with some differences.'
        : 'Some requirements may not be reflected.',
    defaultScope: 'Layout & theme; runtime behavior excluded',
  },
  done: {
    success: 'App generated',
    partial: 'Partially generated',
    withWarnings: 'Generated (with warnings)',
    fidelityMetric: (n, label) => `${n}% match — ${label}`,
    repairs: (n) => `${n} repair${n === 1 ? '' : 's'}`,
    screens: (n) => `${n} screen${n === 1 ? '' : 's'}`,
    degradeLabel: 'Reason for partial result:',
    criticWarn: 'Some requirements may not be fully reflected.',
    criticReloop: 'Did not meet the quality bar. Consider regenerating.',
    regenerate: 'Regenerate',
    undo: 'Undo',
  },
  stageCard: { issuesTitle: 'Issues found' },
  stageNode: { estimatedTitle: 'Estimated time' },
  device: {
    phone: 'Phone',
    tablet: 'Tablet',
    desktop: 'Desktop',
    previewLabel: 'Flutter preview',
    openDartPad: 'Open in DartPad',
    empty: 'Generate an app to see the preview',
    regenerating: 'Regenerating…',
    iframeTitle: 'DartPad preview',
  },
  code: { empty: 'Generated code will appear here', copy: 'Copy', copied: 'Copied', copyTitle: 'Copy' },
  stateView: { empty: 'No AppState yet' },
  header: { subtitle: 'AI App Builder' },
  reducer: {
    verifyDone: (ok, count) => (ok ? 'Verified · no issues' : `Verified · ${count} issue${count === 1 ? '' : 's'} found`),
    repairLabel: (attempt, max) => `Repair · ${attempt}/${max}`,
    criticLabel: (fidelity) => `Quality · ${fidelity}`,
    rowBefore: 'Issues before',
    rowApplied: 'Patches applied',
    rowDropped: 'Patches dropped',
    count: (n) => `${n}`,
    segmentActive: (name) => `Generating ${name} screen…`,
    segmentDone: (name) => `${name} screen done`,
  },
  replay: {
    clarifyDone: 'Requirements set',
    extendDone: 'Widget list set',
    mergeDone: 'State merged',
    codegenScreens: (n) => `${n} screen${n === 1 ? '' : 's'} generated`,
    codegenDone: 'Code generated',
    scope: 'Layout & theme; runtime behavior excluded',
  },
};

export const DICT: Record<Lang, Dict> = { ko, en };

export const LANGS: Lang[] = ['ko', 'en'];
