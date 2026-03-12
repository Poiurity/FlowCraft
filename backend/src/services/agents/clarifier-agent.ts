import { BaseAgent } from './base-agent';
import { widgetRegistry } from '../widget-registry/registry-manager';
import type { AppState } from '../../models/appstate';

export type Intent = 'create' | 'modifyStructure' | 'modifyDesign' | 'modifyBoth';

export interface ClarifiedRequirement {
  enrichedPrompt: string;
  designDirection: string;
  requiredWidgets: string[];
  intent: Intent;
}

const CLARIFIER_PROMPT = `You are FlowCraft's Clarifier Agent. You analyze user requests, classify their intent, and produce actionable specifications.

You have TWO jobs:
1. CLASSIFY the intent of the request
2. ENRICH the request into a detailed specification

INTENT CLASSIFICATION (output as "intent" field):
- "create": No existing app. User wants a new app built from scratch.
- "modifyDesign": User wants to change ONLY visual appearance (colors, fonts, shadows, spacing, border radius, style, theme, dark/light mode, "make it pretty", "toss style", etc.). Do NOT change screens or functionality.
- "modifyStructure": User wants to change app features (add/remove screens, add/remove widgets, change functionality). Do NOT change design.
- "modifyBoth": User wants both visual and functional changes in the same request.

CLASSIFICATION GUIDELINES:
- Requests mentioning app names as style references ("토스처럼", "카카오 스타일", "애플 느낌") are DESIGN unless they also mention adding/removing features.
- "예쁘게", "깔끔하게", "멋있게", "이쁘게", "세련되게" → DESIGN
- "추가해줘", "넣어줘", "삭제해줘", "기능", "화면" → STRUCTURE
- "한국어로", "영어로", "일본어로", "번역", "네이밍", "이름 바꿔", "텍스트 변경", "언어", "문구" → STRUCTURE (text content is part of structure, not design)
- "버튼 크기", "글씨 크기", "폰트 크기", "사이즈" → DESIGN (sizing is visual)
- "다크모드로 바꾸고 검색 추가해줘" → BOTH

ENRICHMENT RULES:
For "create":
- Specify every screen with its data, widgets, interactions, and actions.
- Every screen with user input MUST define state variables and action bindings.
- Describe ADD/EDIT/DELETE flows for list-based content.

For "modifyDesign":
- enrichedPrompt: describe the visual changes ONLY. Do NOT mention adding/removing screens or features.
- designDirection: detailed visual style description.

For "modifyStructure":
- enrichedPrompt: describe what to add/change/remove while preserving existing features.
- designDirection: leave empty or minimal.

For "modifyBoth":
- enrichedPrompt: describe structural changes.
- designDirection: describe visual changes.

AVAILABLE HARDCODED WIDGETS (always available):
text, button, textField, checkbox, switch, listView, listTile,
column, row, container, padding, sizedBox, card, center, expanded

DYNAMICALLY AVAILABLE WIDGETS (already in registry):
{REGISTRY_WIDGETS}

If the app needs a widget NOT in the above lists, include it in requiredWidgets.

Write enrichedPrompt and designDirection in the SAME LANGUAGE as the user's input.
Respond ONLY with the function call.`;

const CLARIFIER_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['create', 'modifyStructure', 'modifyDesign', 'modifyBoth'] },
    enrichedPrompt: { type: 'string' },
    designDirection: { type: 'string' },
    requiredWidgets: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'enrichedPrompt', 'designDirection', 'requiredWidgets'],
};

export class ClarifierAgent extends BaseAgent {
  async clarify(prompt: string, currentState?: AppState): Promise<ClarifiedRequirement> {
    const registryWidgets = widgetRegistry.getRegistryWidgetNames();
    const registryList = registryWidgets.length > 0 ? registryWidgets.join(', ') : '(none yet)';
    const systemPrompt = CLARIFIER_PROMPT.replace('{REGISTRY_WIDGETS}', registryList);

    let userMessage = prompt;
    if (currentState) {
      const screenSummary = currentState.screens.map(s => {
        const vars = s.screenState?.variables?.map(v => v.name) || [];
        return `${s.name}: ${s.appBar?.title || s.name}${vars.length > 0 ? ` (state: ${vars.join(', ')})` : ''}`;
      }).join(', ');
      userMessage = `EXISTING APP: "${currentState.appName}" with screens: [${screenSummary}]\n\nUser request: ${prompt}`;
    }

    const result = await this.callFunction(
      systemPrompt,
      userMessage,
      'clarify_requirement',
      CLARIFIER_SCHEMA,
      'gpt-4o-mini'
    );

    const validIntents: Intent[] = ['create', 'modifyStructure', 'modifyDesign', 'modifyBoth'];
    let intent: Intent = result.intent;
    if (!validIntents.includes(intent)) {
      intent = currentState ? 'modifyStructure' : 'create';
    }
    if (!currentState) intent = 'create';

    return {
      intent,
      enrichedPrompt: result.enrichedPrompt || prompt,
      designDirection: result.designDirection || '',
      requiredWidgets: Array.isArray(result.requiredWidgets) ? result.requiredWidgets : [],
    };
  }
}
