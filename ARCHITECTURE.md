# FlowCraft 아키텍처 문서

> 자연어로 앱을 설명하면 Flutter 코드를 자동 생성하는 AI 기반 앱 빌더

---

## 목차

1. [핵심 아이디어](#1-핵심-아이디어)
2. [시스템 전체 구조](#2-시스템-전체-구조)
3. [데이터 흐름 상세](#3-데이터-흐름-상세)
4. [AppState: 단일 진실 원천](#4-appstate-단일-진실-원천)
5. [멀티 에이전트 오케스트레이션](#5-멀티-에이전트-오케스트레이션)
6. [코드 생성기](#6-코드-생성기)
7. [위젯 레지스트리 시스템](#7-위젯-레지스트리-시스템)
8. [프론트엔드](#8-프론트엔드)
9. [디렉터리 구조](#9-디렉터리-구조)
10. [핵심 설계 원칙](#10-핵심-설계-원칙)

---

## 1. 핵심 아이디어

FlowCraft의 가장 중요한 설계 원칙은 다음 한 문장으로 요약됩니다:

> **AI는 절대 코드를 직접 생성하지 않는다. AI는 구조화된 JSON 모델(AppState)만 생성하고, 코드는 결정론적 코드 생성기가 만든다.**

이 원칙이 존재하는 이유는 간단합니다:

| AI가 코드를 직접 생성하면 | AppState를 거치면 |
|---|---|
| 매번 다른 코드가 나옴 | 같은 AppState → 항상 같은 코드 |
| 문법 오류 빈발 | 코드 생성기가 보장하는 정상 문법 |
| 부분 수정이 불가능 | 구조/디자인 별도 수정 가능 |
| 디버깅 어려움 | JSON을 보면 문제를 즉시 파악 |

```
┌─────────────┐        ┌──────────────┐        ┌─────────────────┐
│  사용자 입력  │──────▶│  AI Agents   │──────▶│    AppState     │
│ "투두앱 만들어" │        │ (JSON 생성)   │        │   (JSON 모델)   │
└─────────────┘        └──────────────┘        └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Code Generator  │
                                               │ (결정론적 변환)    │
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Flutter 코드    │
                                               │  (main.dart)    │
                                               └─────────────────┘
```

---

## 2. 시스템 전체 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                   │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ChatPanel │  │CodePreview │  │DartPadEmbed  │  │StateViewer│ │
│  └────┬─────┘  └────────────┘  └──────────────┘  └───────────┘ │
│       │                                                          │
│       │  POST /api/generate { prompt, sessionId }                │
└───────┼──────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Backend (Node.js + Express)                 │
│                                                                  │
│  ┌───────────────────── Orchestrator ──────────────────────────┐ │
│  │                                                             │ │
│  │  ① Clarifier Agent ──▶ Intent 분류 + 요구사항 보강          │ │
│  │         │                                                   │ │
│  │         ▼                                                   │ │
│  │  ② Widget Extender ──▶ 누락 위젯 정의 생성                  │ │
│  │         │                                                   │ │
│  │         ▼                                                   │ │
│  │  ③ Structure Agent ◀──┐                                    │ │
│  │         │              │ intent에 따라 선택/병렬 실행         │ │
│  │         ▼              │                                    │ │
│  │  ④ Design Agent ◀─────┘                                    │ │
│  │         │                                                   │ │
│  │         ▼                                                   │ │
│  │  ⑤ Merger ──▶ Structure + Design = AppState                │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐    ┌───────────────┐    ┌───────────────────┐ │
│  │Code Generator │    │AppState Differ│    │Change Explainer   │ │
│  │AppState→Dart  │    │이전↔현재 비교   │    │변경사항→Changelog │ │
│  └──────┬───────┘    └───────────────┘    └───────────────────┘ │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
   { appState, code, changelog }  ──▶  프론트엔드로 응답
```

---

## 3. 데이터 흐름 상세

사용자가 "할 일 목록이 있는 투두 앱 만들어줘"라고 입력했을 때의 전체 흐름:

### Step 1: 프론트엔드 → 백엔드

```
POST /api/generate
Body: { "prompt": "할 일 목록이 있는 투두 앱 만들어줘", "sessionId": null }
```

### Step 2: Orchestrator 파이프라인

```
① Clarifier Agent (GPT-4o-mini)
   Input:  "할 일 목록이 있는 투두 앱 만들어줘"
   Output: {
     intent: "create",
     enrichedPrompt: "할 일 목록을 관리하는 투두 앱. 텍스트 입력 필드와 추가 버튼이 있고,
                      할 일 항목마다 체크박스와 삭제 기능이 있는 단일 화면 앱.
                      screenState에 newTask(string)과 tasks(itemList) 변수 필요.",
     designDirection: "깔끔하고 모던한 디자인, 밝은 테마",
     requiredWidgets: []
   }

② Widget Extender
   requiredWidgets가 비어있으므로 스킵

③ Structure Agent (GPT-4)
   Input:  enrichedPrompt
   Output: {
     appName: "TodoApp",
     screens: [{ id: "home", name: "HomeScreen", route: "/", body: {...}, screenState: {...} }],
     navigation: { type: "stack", initialRoute: "/" }
   }

④ Design Agent (GPT-4)
   Input:  designDirection
   Output: {
     theme: { primaryColor: "#2196F3", brightness: "light", ... }
   }

⑤ Merger (순수 함수, AI 아님)
   Structure + Design = 완성된 AppState
```

### Step 3: 코드 생성

```
CodeGenerator.generate(appState) → Flutter/Dart 소스코드 (문자열)
```

### Step 4: Changelog 생성

```
diffAppState(이전 상태, 현재 상태) → ChangeReport
explainChanges(ChangeReport, appName) → Changelog {
  summary: "TodoApp이 생성되었습니다",
  changes: ["화면 추가: HomeScreen", "상태 변수: newTask, tasks", ...],
  usageTips: ["텍스트 필드에 할 일을 입력하고 추가 버튼을 누르세요", ...]
}
```

### Step 5: 응답

```json
{
  "appState": { ... },
  "code": "import 'package:flutter/material.dart';\n...",
  "changelog": { "summary": "...", "changes": [...], "usageTips": [...] },
  "sessionId": "abc12345"
}
```

---

## 4. AppState: 단일 진실 원천

AppState는 앱의 **모든 것**을 표현하는 JSON 모델입니다. AI가 생성하는 것도 이것이고, 코드 생성기가 읽는 것도 이것입니다.

### 전체 구조

```
AppState
├── appName: string                    ← 앱 이름
├── theme                              ← 시각적 디자인
│   ├── primaryColor: "#3789FC"
│   ├── brightness: "light" | "dark"
│   ├── fontFamily?: string
│   ├── scaffoldBackgroundColor?: string
│   ├── appBarTheme?: { backgroundColor, foregroundColor, elevation, ... }
│   ├── cardTheme?: { elevation, color, shadowColor, borderRadius }
│   ├── elevatedButtonTheme?: { borderRadius, backgroundColor, fontSize, minimumSize, padding }
│   ├── inputTheme?: { fillColor, filled, borderRadius, borderColor, ... }
│   └── textTheme?: { headlineFontSize, bodyFontSize, headlineColor, bodyColor, ... }
│
├── screens: Screen[]                  ← 화면 목록 (MVP: 1개)
│   └── Screen
│       ├── id: string
│       ├── name: string               ← Dart 클래스 이름 (PascalCase)
│       ├── route: string              ← "/" 시작
│       ├── appBar?: { title, centerTitle, actions, ... }
│       ├── body: WidgetNode           ← 위젯 트리의 루트
│       ├── fab?: { icon, label, action }
│       └── screenState?               ← 화면의 상태 관리
│           └── variables: StateVariable[]
│               ├── { name: "newTask", type: "string" }
│               ├── { name: "count", type: "int", initialValue: 0 }
│               ├── { name: "isDone", type: "bool", initialValue: false }
│               └── { name: "tasks", type: "itemList",
│                     itemFields: [
│                       { name: "text", type: "string" },
│                       { name: "done", type: "bool" }
│                     ] }
│
└── navigation
    ├── type: "stack" | "bottomNav" | "tabs"
    ├── initialRoute: "/"
    └── bottomNavItems?: [{ icon, label, screenId }]
```

### WidgetNode (재귀 구조)

위젯 트리는 재귀적으로 중첩됩니다:

```
WidgetNode
├── type: string          ← 위젯 종류 (text, button, column, listView, ...)
├── props: object         ← 위젯별 속성
└── children?: WidgetNode[]  ← 자식 위젯들
```

실제 예시:

```json
{
  "type": "padding",
  "props": { "padding": { "all": 16 } },
  "children": [{
    "type": "column",
    "props": { "crossAxisAlignment": "stretch" },
    "children": [
      {
        "type": "row",
        "props": {},
        "children": [
          {
            "type": "expanded",
            "props": {},
            "children": [{
              "type": "textField",
              "props": { "label": "새 할 일", "boundTo": "newTask" }
            }]
          },
          {
            "type": "button",
            "props": {
              "label": "추가",
              "icon": "add",
              "action": {
                "type": "addItem",
                "listName": "tasks",
                "itemTemplate": { "text": "{{newTask}}", "done": false },
                "clearFields": ["newTask"]
              }
            }
          }
        ]
      },
      {
        "type": "expanded",
        "props": {},
        "children": [{
          "type": "listView",
          "props": { "dataSource": "tasks" },
          "children": [{
            "type": "listTile",
            "props": {
              "leading": { "type": "checkbox", "props": { "boundToItemField": "done" } },
              "title": { "type": "text", "props": { "content": "{{item.text}}" } }
            }
          }]
        }]
      }
    ]
  }]
}
```

### 지원 액션 목록

| 액션 타입 | 용도 | 필요 파라미터 |
|---|---|---|
| `addItem` | 리스트에 아이템 추가 | listName, itemTemplate, clearFields |
| `removeItem` | 리스트에서 아이템 삭제 | listName |
| `toggleItemField` | 아이템 필드 토글 | listName, fieldName |
| `increment` | 숫자 변수 +1 | fieldName |
| `decrement` | 숫자 변수 -1 | fieldName |
| `navigate` | 화면 이동 | target |
| `pop` | 이전 화면으로 | - |

---

## 5. 멀티 에이전트 오케스트레이션

### 왜 여러 에이전트로 나눴나?

단일 AI에게 "구조 + 디자인 + 의도 분류"를 모두 맡기면:
- 프롬프트가 너무 길어짐
- 디자인 수정 요청에 구조까지 변경하는 오류 발생
- 각 역할에 최적화된 모델/프롬프트를 사용할 수 없음

에이전트를 분리하면:
- 각자의 역할에만 집중 → 정확도 향상
- "디자인만 변경" 시 Structure Agent를 아예 호출하지 않음 → 구조 보존 보장
- 병렬 실행 가능 → 속도 향상

### 에이전트별 상세

#### ① Clarifier Agent

```
역할: 사용자의 모호한 요청을 정확한 스펙으로 변환 + 의도 분류

입력: "공부할 때 쓰기 좋은 앱 만들어줘"
출력: {
  intent: "create",
  enrichedPrompt: "학습 관리 앱. 과목 목록, 스케줄 관리, 퀴즈 점수 기록 기능.
                   단일 화면에 과목 입력, 스케줄 추가/삭제, 점수 표시 섹션...",
  designDirection: "학습 앱에 적합한 깔끔한 디자인, 집중을 도울 수 있는 색상",
  requiredWidgets: []
}
```

**의도 분류 규칙:**

| 의도 | 분류 기준 | 실행되는 에이전트 |
|---|---|---|
| `create` | 기존 앱 없음, 새 앱 생성 | Structure + Design |
| `modifyStructure` | 기능 추가/삭제, 텍스트 변경, 언어 변경 | Structure만 |
| `modifyDesign` | 색상, 폰트, 스타일 변경 | Design만 |
| `modifyBoth` | 기능 + 디자인 동시 변경 | Structure + Design |

#### ② Widget Extender Agent

```
역할: Clarifier가 요청한 위젯 중 레지스트리에 없는 것을 AI로 정의 생성

입력: requiredWidgets: ["slider", "datePicker"]
동작:
  - "slider"가 레지스트리에 있는지 확인 → 있으면 스킵
  - "datePicker"가 없으면 → AI에게 WidgetDefinition JSON 생성 요청
  - 생성된 정의를 registry.json에 영구 저장
```

#### ③ Structure Agent

```
역할: 화면 구성, 위젯 트리, 상태 변수, 액션 정의

규칙:
  - MVP: 반드시 1개 화면만 생성
  - navigate 액션 금지
  - 빈 위젯/빈 액션 금지
  - 모든 textField는 반드시 boundTo로 상태 변수에 연결
  - 모든 listView는 반드시 dataSource로 리스트 변수에 연결
  - 모든 button은 반드시 의미 있는 action 보유
```

#### ④ Design Agent

```
역할: theme 객체만 생성/수정

규칙:
  - screens, navigation, appName은 절대 건드리지 않음
  - 기존 테마 수정 시 사용자가 언급하지 않은 값은 보존
  - 색상은 hex("#FF5722") 또는 이름("red", "indigo") 모두 지원
```

#### ⑤ Merger (순수 함수)

```typescript
merge(structure, design) → AppState

// 단순히 두 결과를 합치는 결정론적 함수
{
  appName: structure.appName,
  theme: design.theme,
  screens: structure.screens,
  navigation: structure.navigation
}
```

### Intent별 실행 흐름

```
create:
  Clarifier → WidgetExtender → [Structure + Design 병렬] → Merger → AppState

modifyStructure:
  Clarifier → WidgetExtender → Structure → Merger(기존 theme 유지) → AppState

modifyDesign:
  Clarifier → Design → Merger(기존 screens 유지) → AppState

modifyBoth:
  Clarifier → WidgetExtender → [Structure + Design 병렬] → Merger → AppState
```

---

## 6. 코드 생성기

### 역할

`CodeGenerator`는 AppState JSON을 입력받아 **항상 동일한** Flutter/Dart 코드를 출력합니다. AI가 아닌 순수 TypeScript 로직입니다.

### 생성되는 코드 구조

```dart
import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

// ── 앱 위젯 (테마, 라우팅) ──
class MyApp extends StatelessWidget {
  Widget build(BuildContext context) {
    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;  // 반응형
    return MaterialApp(
      title: 'TodoApp',
      theme: ThemeData(/* AppState.theme에서 생성 */),
      routes: { '/': (context) => HomeScreen() },
    );
  }
}

// ── 화면 위젯 (StatefulWidget) ──
class HomeScreen extends StatefulWidget { ... }
class _HomeScreenState extends State<HomeScreen> {
  // AppState.screenState.variables에서 생성
  String _newTask = '';
  final List<Map<String, dynamic>> _tasks = [];
  final _newTaskController = TextEditingController();

  // AppState의 actions에서 생성
  void _addItemTasks() {
    setState(() {
      _tasks.add({'text': _newTask, 'done': false});
      _newTask = '';
      _newTaskController.clear();
    });
  }

  Widget build(BuildContext context) {
    double r(double s) => s * MediaQuery.sizeOf(context).width / 375;
    return Scaffold(
      // AppState.body 위젯 트리에서 결정론적으로 생성
    );
  }
}
```

### 위젯 렌더링 방식

코드 생성기는 두 가지 방식으로 위젯을 렌더링합니다:

#### A. 하드코딩된 위젯 (복잡한 로직 필요)

`text`, `button`, `textField`, `checkbox`, `listView`, `listTile`, `column`, `row`, `container`, `padding`, `sizedBox`, `card`, `center`, `expanded`, `divider`, `switch`

각 위젯마다 전용 메서드가 있습니다:
- `wText()`: 데이터 바인딩(`{{varName}}`), 조건부 스타일 처리
- `wButton()`: 여러 variant (elevated/text/outlined/icon), 스타일 오버라이드
- `wTextField()`: TextEditingController 연동, 타입별 파싱 (int/double)
- `wListView()`: `ListView.builder` + `itemBuilder` + Dismissible
- `wFlex()`: Column/Row에서 자동 `Expanded` 래핑 (`fixFlexChild`)

#### B. 레지스트리 기반 범용 렌더러

레지스트리에 정의된 위젯 (image, icon, slider 등)은 `renderFromDefinition()` 메서드가 JSON 정의를 해석하여 코드를 생성합니다:

```typescript
// WidgetDefinition 예시
{
  "name": "slider",
  "dartWidget": "Slider",
  "props": [
    { "name": "min", "dartParam": "min", "type": "number", "optional": true, "defaultValue": 0 },
    { "name": "max", "dartParam": "max", "type": "number", "optional": true, "defaultValue": 1 }
  ],
  "stateBinding": {
    "valueProp": "value",
    "onChangedProp": "onChanged",
    "stateType": "double"
  }
}

// 생성되는 Dart 코드:
Slider(
  value: _sliderValue,
  onChanged: (v) => setState(() => _sliderValue = v),
  min: 0,
  max: 1,
)
```

### 반응형 사이징

모든 크기 값은 `r()` 함수를 통해 화면 너비에 비례하여 스케일링됩니다:

```dart
double r(double s) => s * MediaQuery.sizeOf(context).width / 375;

// 기준: 375px (iPhone SE 너비)
// 예: 375px 화면에서 r(16) = 16px
//     750px 화면에서 r(16) = 32px
```

적용 대상: fontSize, padding, margin, SizedBox 크기, Container 크기, Image 크기, 버튼 padding

### 방어적 코드 생성

AI가 불완전한 AppState를 생성할 수 있으므로, 코드 생성기에 여러 방어 로직이 있습니다:

| 상황 | 방어 로직 |
|---|---|
| 빈 Card (children 없음) | `Card()` 출력 |
| 빈 Container | `Container()` 출력 |
| 빈 Expanded | `Expanded(child: SizedBox.shrink())` |
| Column 안의 ListView | 자동으로 `Expanded`로 래핑 |
| Padding 안의 Expanded | `Expanded` 자동 제거 |
| int/double 변수에 TextField 연결 | `int.tryParse`/`double.tryParse` 자동 적용 |
| `{{item}}` 바인딩 | 로컬 변수 `item`으로 올바르게 변환 |

---

## 7. 위젯 레지스트리 시스템

### 개념

모든 위젯을 코드 생성기에 하드코딩하면 새 위젯을 추가할 때마다 코드를 수정해야 합니다. 레지스트리 시스템은 위젯 정의를 JSON으로 분리하여 **AI가 새 위젯을 동적으로 추가**할 수 있게 합니다.

### 구조

```
widget-registry/
├── types.ts           ← WidgetDefinition, PropDefinition 타입
├── registry.json      ← 위젯 정의 저장소 (JSON)
└── registry-manager.ts ← 로드/저장/조회 관리
```

### WidgetDefinition 스키마

```typescript
interface WidgetDefinition {
  name: string;           // AppState에서 사용하는 이름 (e.g., "slider")
  dartWidget: string;     // Dart 클래스 이름 (e.g., "Slider")
  category: string;       // 분류 (e.g., "input", "display")
  props: PropDefinition[];
  stateBinding?: {        // 상태 변수에 양방향 바인딩
    valueProp: string;
    onChangedProp: string;
    stateType: string;
  };
}

interface PropDefinition {
  name: string;           // AppState props 키
  dartParam: string;      // Dart 파라미터 이름 (""이면 positional)
  type: string;           // "string" | "number" | "size" | "bool" | "color" | "icon" | "edgeInsets"
  optional: boolean;
  defaultValue?: any;
}
```

### 위젯 추가 흐름

```
① 사용자: "슬라이더가 있는 앱 만들어줘"
② Clarifier: requiredWidgets: ["slider"]
③ Widget Extender: "slider"가 레지스트리에 있는지 확인
   → 없으면 AI에게 WidgetDefinition JSON 생성 요청
   → 생성된 정의를 registry.json에 저장 (영구)
④ Structure Agent: 이제 "slider" 타입을 사용 가능
⑤ Code Generator: renderFromDefinition()으로 Dart 코드 생성
⑥ 다음번에 "slider"를 요청하면 ③에서 이미 있으므로 스킵
```

---

## 8. 프론트엔드

### 기술 스택

- **React 19** + **TypeScript**
- **Vite** (빌드 도구)
- **Tailwind CSS v4** (스타일링)
- **Lucide React** (아이콘)

### 컴포넌트 구조

```
App.tsx
├── Header (로고, 세션 ID)
├── ChatPanel (좌측)
│   ├── 메시지 목록
│   │   ├── 사용자 메시지 (파란 버블)
│   │   └── 어시스턴트 메시지 (Changelog 표시)
│   └── 입력창 + 전송 버튼
│
└── Right Panel (우측, 탭 전환)
    ├── [미리보기] DartPadEmbed ← DartPad iframe
    ├── [코드] CodePreview ← 생성된 Dart 코드 표시
    └── [상태] AppStateViewer ← AppState JSON 트리 뷰
```

### 핵심 상태 관리

```typescript
// App.tsx
const [sessionId, setSessionId] = useState<string>();    // 세션 식별자
const [appState, setAppState] = useState<AppState>();     // 현재 AppState
const [code, setCode] = useState('');                     // 생성된 Dart 코드
const [isLoading, setIsLoading] = useState(false);        // 생성 중 여부
const [rightTab, setRightTab] = useState<RightTab>('preview');
```

### DartPad 연동

DartPad는 iframe으로 임베드되며, `postMessage`로 코드를 전달합니다:

```typescript
// 코드 전송
iframe.contentWindow.postMessage({ sourceCode: code, type: 'sourceCode' }, '*');

// 실행 명령
iframe.contentWindow.postMessage({ type: 'execute' }, '*');
```

DartPad iframe은 탭 전환 시에도 DOM에서 제거하지 않고 `invisible` 클래스로 숨깁니다. 이는 iframe을 제거하면 매번 재초기화되어 느려지기 때문입니다.

### API 클라이언트

```typescript
// frontend/src/services/api.ts

// 앱 생성/수정
generateFromPrompt(prompt: string, sessionId?: string)
  → { appState, code, changelog, sessionId }

// 기존 상태 조회
getState(sessionId: string)
  → { appState, code }
```

---

## 9. 디렉터리 구조

```
First_Hton_V4/
│
├── backend/
│   ├── src/
│   │   ├── index.ts                          # Express 서버 진입점
│   │   │
│   │   ├── models/
│   │   │   └── appstate.ts                   # AppState Zod 스키마 + 타입
│   │   │
│   │   ├── routes/
│   │   │   └── api.ts                        # REST API 엔드포인트
│   │   │
│   │   ├── services/
│   │   │   ├── agents/
│   │   │   │   ├── base-agent.ts             # OpenAI 호출 공통 로직
│   │   │   │   ├── clarifier-agent.ts        # 의도 분류 + 요구사항 보강
│   │   │   │   ├── structure-agent.ts        # 화면/위젯/상태 생성
│   │   │   │   ├── design-agent.ts           # 테마/스타일 생성
│   │   │   │   ├── widget-extender-agent.ts  # 새 위젯 정의 생성
│   │   │   │   └── orchestrator.ts           # 에이전트 파이프라인 조율
│   │   │   │
│   │   │   ├── widget-registry/
│   │   │   │   ├── types.ts                  # WidgetDefinition 타입
│   │   │   │   ├── registry.json             # 위젯 정의 저장소
│   │   │   │   └── registry-manager.ts       # 레지스트리 관리
│   │   │   │
│   │   │   ├── code-generator.ts             # AppState → Dart 코드
│   │   │   ├── appstate-manager.ts           # 세션별 AppState 저장
│   │   │   ├── appstate-differ.ts            # AppState 이전/현재 비교
│   │   │   ├── change-explainer.ts           # 변경사항 → 사용자 설명
│   │   │   └── ai-agent.ts                   # (레거시, 미사용)
│   │   │
│   │   └── utils/
│   │       └── zod-to-jsonschema.ts          # 스키마 변환 유틸
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                          # React 진입점
│   │   ├── App.tsx                           # 메인 레이아웃 + 상태
│   │   ├── index.css                         # 커스텀 테마 + 애니메이션
│   │   │
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx                 # 채팅 UI
│   │   │   ├── CodePreview.tsx               # 코드 표시 + 복사
│   │   │   ├── DartPadEmbed.tsx              # DartPad iframe
│   │   │   └── AppStateViewer.tsx            # JSON 트리 뷰
│   │   │
│   │   ├── services/
│   │   │   └── api.ts                        # 백엔드 API 클라이언트
│   │   │
│   │   └── types/
│   │       └── appstate.ts                   # AppState 프론트엔드 타입
│   │
│   ├── package.json
│   └── vite.config.ts
│
└── ARCHITECTURE.md                           # ← 이 문서
```

---

## 10. 핵심 설계 원칙

### 1. AI와 코드 생성의 완전 분리

| AI의 책임 | 코드 생성기의 책임 |
|---|---|
| JSON 구조(AppState) 생성 | JSON → Dart 코드 변환 |
| 사용자 의도 해석 | 문법적으로 올바른 코드 보장 |
| 위젯/구조 결정 | 레이아웃 방어 로직 |
| 디자인 결정 | 반응형 사이징 |

### 2. 관심사 분리 (Separation of Concerns)

- **Structure Agent**: 무엇을 만들 것인가 (기능)
- **Design Agent**: 어떻게 보일 것인가 (시각)
- **Clarifier Agent**: 사용자가 원하는 게 무엇인가 (해석)
- **Widget Extender**: 새로운 위젯이 필요한가 (확장)
- **Orchestrator**: 누가 언제 실행되어야 하는가 (조율)

### 3. 결정론적 변환

같은 AppState가 입력되면 항상 동일한 Dart 코드가 출력됩니다. AI의 비결정성은 AppState 생성 단계에서만 존재하고, 그 이후는 순수 함수입니다.

### 4. 점진적 수정

앱을 처음부터 다시 만들지 않고, 기존 AppState를 기반으로 수정합니다:
- `modifyDesign`: 기존 screens 유지, theme만 교체
- `modifyStructure`: 기존 theme 유지, screens만 교체
- 세션 기반 상태 관리로 대화 히스토리 보존

### 5. 방어적 코드 생성

AI의 출력은 완벽하지 않으므로, 여러 계층에서 방어합니다:
1. **Zod 스키마 검증**: 잘못된 타입 거부
2. **BaseAgent 정규화**: 잘못된 값 자동 수정 (e.g., `stringList` → `string`)
3. **StructureAgent 강제**: 복수 화면 → 단일 화면 트리밍, navigate 액션 제거
4. **CodeGenerator 방어**: 빈 위젯, 잘못된 레이아웃 자동 보정
