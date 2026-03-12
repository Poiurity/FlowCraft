import { BaseAgent } from './base-agent';
import { widgetRegistry } from '../widget-registry/registry-manager';
import type { WidgetDefinition } from '../widget-registry/types';

const EXTENDER_PROMPT = `You are FlowCraft's Widget Extender Agent. Your job is to create a declarative widget definition JSON for a Flutter widget that doesn't exist in the system yet.

A widget definition describes how to render a Flutter widget from structured props. The system's generic renderer will use this definition to generate Dart code deterministically — you are NOT writing Dart code.

OUTPUT FORMAT (WidgetDefinition):
{
  "name": "slider",              // lowercase camelCase identifier used in AppState
  "dartWidget": "Slider",         // exact Flutter widget class name
  "category": "input",            // "input" | "display" | "layout"
  "props": [                      // list of supported properties
    {
      "name": "min",              // prop name used in AppState JSON
      "dartParam": "min",         // Dart named parameter (use "" for positional args)
      "type": "number",           // "number" | "string" | "bool" | "color" | "icon" | "edgeInsets"
      "optional": true,
      "defaultValue": 0
    }
  ],
  "stateBinding": {               // optional: for widgets that bind to state variables
    "valueProp": "value",         // the Dart parameter for the current value
    "onChangedProp": "onChanged", // the Dart parameter for the change callback
    "stateType": "double"         // the Dart type of the state variable ("double", "bool", "String", "int")
  }
}

RULES:
1. Use the EXACT Flutter widget class name for dartWidget.
2. Only include commonly used props — don't try to include every possible parameter.
3. For positional arguments (like Image.network's URL or Icon's IconData), set dartParam to "".
4. stateBinding is only for interactive widgets that need two-way data binding (Slider, Switch, etc.). Omit it for display-only widgets.
5. The type field maps to code generation: "number" → raw number, "string" → quoted string, "bool" → true/false, "color" → Color(0xFF...) or Colors.xxx, "icon" → Icons.xxx, "edgeInsets" → EdgeInsets.xxx.

Respond ONLY with the function call.`;

const WIDGET_DEF_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    dartWidget: { type: 'string' },
    category: { type: 'string', enum: ['input', 'display', 'layout'] },
    props: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          dartParam: { type: 'string' },
          type: { type: 'string', enum: ['number', 'string', 'bool', 'color', 'icon', 'edgeInsets'] },
          optional: { type: 'boolean' },
          defaultValue: {},
        },
        required: ['name', 'dartParam', 'type', 'optional'],
      },
    },
    stateBinding: {
      type: 'object',
      properties: {
        valueProp: { type: 'string' },
        onChangedProp: { type: 'string' },
        stateType: { type: 'string' },
      },
      required: ['valueProp', 'onChangedProp', 'stateType'],
    },
  },
  required: ['name', 'dartWidget', 'category', 'props'],
};

export class WidgetExtenderAgent extends BaseAgent {
  async ensureWidgets(requiredWidgets: string[]): Promise<string[]> {
    const added: string[] = [];

    for (const widgetName of requiredWidgets) {
      if (widgetRegistry.hasWidget(widgetName)) continue;

      console.log(`[WidgetExtender] Generating definition for: ${widgetName}`);
      try {
        const definition = await this.generateDefinition(widgetName);
        widgetRegistry.addDefinition(definition);
        added.push(widgetName);
      } catch (err: any) {
        console.error(`[WidgetExtender] Failed to generate ${widgetName}:`, err.message);
      }
    }

    return added;
  }

  private async generateDefinition(widgetName: string): Promise<WidgetDefinition> {
    const result = await this.callFunction(
      EXTENDER_PROMPT,
      `Create a widget definition for the Flutter widget: "${widgetName}"`,
      'define_widget',
      WIDGET_DEF_SCHEMA,
      'gpt-4o'
    );

    if (!result.name) result.name = widgetName;
    if (!result.dartWidget) throw new Error(`No dartWidget for ${widgetName}`);
    if (!Array.isArray(result.props)) result.props = [];

    return result as WidgetDefinition;
  }
}
