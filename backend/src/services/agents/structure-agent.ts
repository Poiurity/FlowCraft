import { BaseAgent } from './base-agent';
import type { AppState, Screen, Navigation } from '../../models/appstate';
import { widgetRegistry } from '../widget-registry/registry-manager';

export interface StructureResult {
  appName: string;
  screens: Screen[];
  navigation: Navigation;
}

const STRUCTURE_PROMPT_BASE = `You are FlowCraft's Structure Agent. You build FUNCTIONAL, INTERACTIVE Flutter app structures.
You do NOT handle theme/colors/fonts/design — a separate Design Agent handles that.

CRITICAL RULES:
1. Output JSON with: appName, screens (EXACTLY ONE screen), navigation. Do NOT include a theme field.
2. Every screen MUST have id, name, route, and body.
3. Screen names must be valid Dart PascalCase class names.
4. Routes start with "/".
5. You MUST create EXACTLY ONE screen. The "screens" array MUST contain exactly 1 element. NEVER create 2 or more screens. Put ALL features, inputs, lists, and buttons on that single screen. NEVER use { type: "navigate" } actions. If the user asks for features that seem like separate pages, combine them all into sections on the single screen using cards or dividers.

MANDATORY FUNCTIONALITY RULES:
5. NEVER create empty or placeholder widgets. Every widget must have real content and purpose.
6. Every button MUST have a meaningful label AND an action (navigate, addItem, etc.). NEVER use empty actions.
7. Every textField MUST have boundTo connecting to a screenState string variable, plus label and hint.
8. Every listView that displays dynamic data MUST have dataSource connecting to a screenState list variable.
9. Every screen that has user input or dynamic content MUST have screenState with appropriate variables.
10. Text widgets must have meaningful content — NEVER use empty strings.
11. Use proper layout: wrap content in padding, use sizedBox for spacing, use card for grouped content.

LAYOUT BEST PRACTICES:
- Body should start with a padding (16px) wrapper.
- Use column as the main layout, with sizedBox(height:16) between sections.
- Group related widgets in card with padding inside.
- Input rows: use row with expanded(textField) + sizedBox(width:8) + button.
- Lists should be inside expanded when in a column.
- Always add meaningful appBar titles.

AVAILABLE WIDGET TYPES:
{WIDGET_TYPES}

HARDCODED WIDGET PROPS:
- text: { content, style?: {fontSize?, fontWeight?, color?}, conditionalDecoration?: {field} }
  - "{{varName}}" for data binding, "{{item.field}}" inside list items
- button: { label, variant?: "elevated"|"text"|"outlined"|"icon", icon?, action }
  - MUST always have a real action, never empty
- textField: { label?, hint?, obscureText?, prefixIcon?, boundTo?: "stateVar", onSubmit?: action }
  - MUST always have boundTo for state binding
- checkbox: { boundToItemField?: "field", onToggle?: action }
- listView: { dataSource?: "stateVar", padding? }
  - MUST use dataSource for dynamic lists. children[0] is the item template.
- listTile: { title?: Widget, subtitle?: Widget, leading?: Widget, trailing?: Widget, onTap?: action, onDismissed?: action }

{REGISTRY_WIDGET_PROPS}

SCREEN STATE — REQUIRED for any screen with user interaction:
- { name: "newTask", type: "string" } — for text input (creates TextEditingController)
- { name: "count", type: "int", initialValue: 0 } — for counters
- { name: "isDark", type: "bool", initialValue: false } — for toggles
- { name: "tasks", type: "itemList", itemFields: [{name:"text",type:"string"},{name:"done",type:"bool"}] } — for lists with structured items
- { name: "items", type: "stringList" } — for simple string lists

ACTIONS — every interactive widget must use one:
- { type: "navigate", target: "screenId" } — go to another screen
- { type: "pop" } — go back
- { type: "addItem", listName: "tasks", itemTemplate: {"text":"{{newTask}}","done":false}, clearFields: ["newTask"] }
- { type: "removeItem", listName: "tasks" }
- { type: "toggleItemField", listName: "tasks", fieldName: "done" }
- { type: "increment", fieldName: "count" }
- { type: "decrement", fieldName: "count" }

EXAMPLE — A proper functional screen:
{
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
        { "type": "row", "props": {},
          "children": [
            { "type": "expanded", "props": {},
              "children": [{ "type": "textField", "props": {"label":"New task","hint":"Enter task...","boundTo":"newTask","onSubmit":{"type":"addItem","listName":"tasks","itemTemplate":{"text":"{{newTask}}","done":false},"clearFields":["newTask"]}} }]
            },
            { "type": "sizedBox", "props": {"width": 8} },
            { "type": "button", "props": {"label":"Add","icon":"add","action":{"type":"addItem","listName":"tasks","itemTemplate":{"text":"{{newTask}}","done":false},"clearFields":["newTask"]}} }
          ]
        },
        { "type": "sizedBox", "props": {"height": 16} },
        { "type": "expanded", "props": {},
          "children": [{
            "type": "listView", "props": { "dataSource": "tasks" },
            "children": [{
              "type": "listTile", "props": {
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
}

Follow this pattern. Every screen you create must be FUNCTIONAL like this example.
Respond ONLY with the function call.`;

function buildPrompt(): string {
  const widgetTypes = widgetRegistry.getPropsDescription();
  const registryNames = widgetRegistry.getRegistryWidgetNames();

  let registryProps = '';
  if (registryNames.length > 0) {
    const defs = registryNames.map(n => widgetRegistry.getDefinition(n)).filter(Boolean);
    const lines: string[] = ['REGISTRY WIDGET PROPS:'];
    for (const def of defs) {
      if (!def) continue;
      const propDescs = def.props.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
      const binding = def.stateBinding ? `, boundTo?: "stateVarName"` : '';
      lines.push(`- ${def.name}: { ${propDescs}${binding} }`);
    }
    registryProps = lines.join('\n');
  }

  return STRUCTURE_PROMPT_BASE
    .replace('{WIDGET_TYPES}', widgetTypes)
    .replace('{REGISTRY_WIDGET_PROPS}', registryProps);
}

function buildSchema(): Record<string, any> {
  const allWidgets = widgetRegistry.getAllWidgetNames();

  return {
    type: 'object',
    properties: {
      appName: { type: 'string' },
      screens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            route: { type: 'string' },
            appBar: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                centerTitle: { type: 'boolean' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      icon: { type: 'string' },
                      action: { type: 'object', additionalProperties: true },
                    },
                    required: ['icon'],
                  },
                },
              },
              required: ['title'],
            },
            body: { $ref: '#/$defs/WidgetNode' },
            fab: {
              type: 'object',
              properties: {
                icon: { type: 'string' },
                label: { type: 'string' },
                action: { type: 'object', additionalProperties: true },
              },
            },
            backgroundColor: { type: 'string' },
            screenState: {
              type: 'object',
              properties: {
                variables: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ['string', 'int', 'double', 'bool', 'stringList', 'itemList'] },
                      initialValue: {},
                      itemFields: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            type: { type: 'string', enum: ['string', 'int', 'double', 'bool'] },
                          },
                          required: ['name', 'type'],
                        },
                      },
                    },
                    required: ['name', 'type'],
                  },
                },
              },
              required: ['variables'],
            },
          },
          required: ['id', 'name', 'route', 'body'],
        },
      },
      navigation: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['stack', 'bottomNav', 'tabs'] },
          initialRoute: { type: 'string' },
          bottomNavItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                icon: { type: 'string' },
                label: { type: 'string' },
                screenId: { type: 'string' },
              },
              required: ['icon', 'label', 'screenId'],
            },
          },
        },
      },
    },
    required: ['appName', 'screens'],
    $defs: {
      WidgetNode: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: allWidgets },
          props: { type: 'object', additionalProperties: true },
          children: { type: 'array', items: { $ref: '#/$defs/WidgetNode' } },
        },
        required: ['type'],
      },
    },
  };
}

export class StructureAgent extends BaseAgent {
  async generate(prompt: string): Promise<StructureResult> {
    const raw = await this.callFunction(
      buildPrompt(),
      prompt,
      'generate_structure',
      buildSchema()
    );
    return this.enforceSingleScreen(this.sanitizeScreens(raw) as StructureResult);
  }

  async modify(prompt: string, currentState: AppState): Promise<StructureResult> {
    const context = {
      appName: currentState.appName,
      screens: currentState.screens.slice(0, 1),
      navigation: currentState.navigation,
    };
    const userMessage = `Current structure:\n${JSON.stringify(context, null, 2)}\n\nUser request: ${prompt}`;

    const raw = await this.callFunction(
      buildPrompt(),
      userMessage,
      'generate_structure',
      buildSchema()
    );
    return this.enforceSingleScreen(this.sanitizeScreens(raw) as StructureResult);
  }

  // [MVP] Force single screen — keep only the first screen, remove navigate actions
  private enforceSingleScreen(result: StructureResult): StructureResult {
    if (result.screens.length > 1) {
      console.log(`[StructureAgent] MVP: trimming ${result.screens.length} screens → 1`);
      result.screens = result.screens.slice(0, 1);
    }
    result.screens[0].route = '/';
    result.navigation = { type: 'stack' as const, initialRoute: '/' };
    this.stripNavigateActions(result.screens[0].body);
    return result;
  }

  private stripNavigateActions(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (node.props?.action?.type === 'navigate') {
      delete node.props.action;
    }
    if (node.props?.onTap?.type === 'navigate') {
      delete node.props.onTap;
    }
    for (const val of Object.values(node.props || {})) {
      if (val && typeof val === 'object' && 'type' in val) {
        this.stripNavigateActions(val);
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((c: any) => this.stripNavigateActions(c));
    }
  }
}
