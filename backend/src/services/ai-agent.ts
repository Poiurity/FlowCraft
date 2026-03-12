import OpenAI from 'openai';
import { AppStateSchema, type AppState } from '../models/appstate';
import { getAppStateJsonSchema } from '../utils/zod-to-jsonschema';

const SYSTEM_PROMPT = `You are FlowCraft's AI agent. Your ONLY job is to produce a valid AppState JSON that describes a Flutter app.

CRITICAL RULES:
1. You NEVER generate Flutter/Dart code. You ONLY output JSON conforming to the AppState schema.
2. Every screen MUST have id, name, route, and body fields.
3. Screen names must be valid Dart class names (PascalCase, no spaces, no underscores).
4. Routes start with "/" (e.g. "/", "/login").
5. If the app needs interactivity (adding items, toggling, counting), you MUST add screenState with variables and use the appropriate action types.

WIDGET TYPES:
- Layout: column, row, container, padding, sizedBox, card, center, expanded, spacer
- Display: text, image, icon, divider, circularProgressIndicator
- Input: button, textField, checkbox, switch
- List: listView, listTile

WIDGET PROPS:
- text: { content: string, style?: {fontSize?, fontWeight?, color?}, conditionalDecoration?: {field: string} }
  - Use "{{varName}}" for data binding, "{{item.fieldName}}" inside list items
- button: { label, variant?: "elevated"|"text"|"outlined"|"icon", icon?, action }
- textField: { label?, hint?, obscureText?, prefixIcon?, boundTo?: "stateVarName", onSubmit?: action }
  - boundTo connects to a screenState string variable
- checkbox: { boundToItemField?: "fieldName", onToggle?: action }
  - Used inside listView itemBuilder to bind to item fields
- listView: { dataSource?: "stateVarName", padding?, itemBuilder?: WidgetNode }
  - dataSource binds to a screenState list variable
  - When dataSource is set, children[0] or itemBuilder is used as the template for each item
  - Inside itemBuilder, use "{{item.fieldName}}" in text content
- listTile: { title?: WidgetNode, subtitle?: WidgetNode, leading?: WidgetNode, trailing?: WidgetNode, onTap?: action, onDismissed?: action }
  - onDismissed wraps the tile in a Dismissible widget

SCREEN STATE (for interactive screens):
Add screenState.variables to define state:
- { name: "newTask", type: "string" } → creates a String variable + TextEditingController
- { name: "count", type: "int", initialValue: 0 }
- { name: "isDark", type: "bool", initialValue: false }
- { name: "tasks", type: "itemList", itemFields: [{name:"text",type:"string"},{name:"done",type:"bool"}] }
- { name: "items", type: "stringList" }

ACTION TYPES:
- { type: "navigate", target: "screenId" }
- { type: "pop" }
- { type: "addItem", listName: "tasks", itemTemplate: {"text":"{{newTask}}","done":false}, clearFields: ["newTask"] }
  - itemTemplate values with "{{varName}}" pull from state variables
- { type: "removeItem", listName: "tasks" }
- { type: "toggleItemField", listName: "tasks", fieldName: "done" }
- { type: "increment", fieldName: "count" }
- { type: "decrement", fieldName: "count" }

DESIGN / STYLING:
When the user requests design changes, use these properties:

theme-level (applies globally):
- theme.primaryColor: main color (hex like "#FF5722" or named like "indigo")
- theme.brightness: "light" or "dark"
- theme.fontFamily: font name (e.g. "Roboto", "NotoSansKR")
- theme.scaffoldBackgroundColor: background color for all screens
- theme.defaultBorderRadius: default corner radius for cards, buttons, inputs
- theme.appBarTheme: { backgroundColor?, foregroundColor?, elevation?, centerTitle?, titleFontSize?, titleFontWeight? }
- theme.cardTheme: { elevation?, color?, shadowColor?, borderRadius? }
- theme.elevatedButtonTheme: { borderRadius?, elevation?, backgroundColor?, foregroundColor?, padding?: {horizontal?, vertical?} }
- theme.inputTheme: { fillColor?, filled?, borderRadius?, borderColor?, focusedBorderColor?, labelFontSize? }
- theme.textTheme: { headlineFontSize?, bodyFontSize?, labelFontSize?, headlineColor?, bodyColor? }

widget-level (per-widget overrides):
- button props: { backgroundColor?, foregroundColor?, borderRadius?, elevation?, padding?: {horizontal?, vertical?}, fontSize? }
- card props: { elevation?, color?, shadowColor?, borderRadius? }
- container props: { decoration: { color?, borderRadius?, border?, boxShadow?: {color?, blurRadius?, spreadRadius?, offsetX?, offsetY?}, gradient?: {type?: "linear"|"radial", colors: string[], begin?, end?} } }
- appBar: { elevation?, titleFontSize?, titleFontWeight? }
- text props: { style: { fontSize?, fontWeight?, color?, fontStyle?, letterSpacing?, decoration? } }

IMPORTANT: When user asks for design changes (colors, fonts, shadows, sizes, rounded corners, etc.), modify the theme object. Use widget-level overrides only when the user wants a specific widget to look different from the theme.

EXAMPLE — Todo App:
{
  "appName": "Todo App",
  "screens": [{
    "id": "home", "name": "HomeScreen", "route": "/",
    "appBar": { "title": "My Tasks" },
    "screenState": {
      "variables": [
        { "name": "newTask", "type": "string" },
        { "name": "tasks", "type": "itemList", "itemFields": [{"name":"text","type":"string"},{"name":"done","type":"bool"}] }
      ]
    },
    "body": {
      "type": "padding", "props": { "padding": {"all": 16} },
      "children": [{
        "type": "column", "props": {"crossAxisAlignment":"stretch"},
        "children": [
          {
            "type": "row", "props": {},
            "children": [
              { "type": "expanded", "props": {},
                "children": [{ "type": "textField", "props": {"label":"New task","hint":"Enter task...","boundTo":"newTask","onSubmit":{"type":"addItem","listName":"tasks","itemTemplate":{"text":"{{newTask}}","done":false},"clearFields":["newTask"]}} }]
              },
              { "type": "sizedBox", "props": {"width": 8} },
              { "type": "button", "props": {"label":"Add","icon":"add","action":{"type":"addItem","listName":"tasks","itemTemplate":{"text":"{{newTask}}","done":false},"clearFields":["newTask"]}} }
            ]
          },
          { "type": "sizedBox", "props": {"height": 16} },
          {
            "type": "expanded", "props": {},
            "children": [{
              "type": "listView",
              "props": { "dataSource": "tasks" },
              "children": [{
                "type": "listTile",
                "props": {
                  "leading": {"type":"checkbox","props":{"boundToItemField":"done","onToggle":{"type":"toggleItemField","listName":"tasks","fieldName":"done"}}},
                  "title": {"type":"text","props":{"content":"{{item.text}}","conditionalDecoration":{"field":"done"}}},
                  "onDismissed": {"type":"removeItem","listName":"tasks"}
                }
              }]
            }]
          }
        ]
      }]
    }
  }],
  "navigation": { "type": "stack", "initialRoute": "/" }
}

Respond ONLY with the function call. No explanations.`;

export class AIAgent {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async processPrompt(prompt: string, currentState?: AppState): Promise<AppState> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    if (currentState) {
      messages.push({
        role: 'user',
        content: `Current AppState:\n${JSON.stringify(currentState, null, 2)}\n\nUser request: ${prompt}`,
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: [
        {
          type: 'function',
          function: {
            name: 'generate_app_state',
            description: 'Generate or modify the AppState JSON that describes a Flutter application',
            parameters: getAppStateJsonSchema(),
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'generate_app_state' } },
      temperature: 0.1,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'generate_app_state') {
      throw new Error('AI가 유효한 응답을 생성하지 못했습니다. 다시 시도해 주세요.');
    }

    const rawJson = JSON.parse(toolCall.function.arguments);
    const sanitized = this.sanitize(rawJson);
    return AppStateSchema.parse(sanitized);
  }

  private sanitize(raw: any): any {
    if (!raw || typeof raw !== 'object') return raw;

    if (Array.isArray(raw.screens)) {
      raw.screens = raw.screens.filter((s: any) =>
        s && typeof s === 'object' && s.id && s.name && s.route && s.body
      );
      for (const screen of raw.screens) {
        // Ensure name is valid PascalCase Dart identifier
        if (screen.name) {
          screen.name = screen.name.replace(/[^a-zA-Z0-9]/g, '');
          if (!/^[A-Z]/.test(screen.name)) {
            screen.name = screen.name.charAt(0).toUpperCase() + screen.name.slice(1);
          }
        }
        if (screen.body) screen.body = this.sanitizeWidget(screen.body);
      }
    }
    return raw;
  }

  private sanitizeWidget(node: any): any {
    if (!node || typeof node !== 'object') return { type: 'sizedBox', props: {} };
    if (!node.type) node.type = 'sizedBox';
    if (!node.props) node.props = {};
    if (Array.isArray(node.children)) {
      node.children = node.children
        .filter((c: any) => c && typeof c === 'object')
        .map((c: any) => this.sanitizeWidget(c));
    }
    return node;
  }
}
