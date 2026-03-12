import { BaseAgent } from './base-agent';
import type { Theme } from '../../models/appstate';

export interface DesignResult {
  theme: Theme;
}

const DESIGN_PROMPT = `You are FlowCraft's Design Agent. You handle ONLY visual design: theme, colors, fonts, shadows, spacing.
You do NOT handle app structure, screens, widgets, or state — a separate Structure Agent handles that.

OUTPUT: JSON with a single "theme" object. Do NOT include screens, navigation, or appName.

THEME PROPERTIES:
- primaryColor: main color (hex "#FF5722" or named "indigo", "red", "blue", etc.)
- brightness: "light" or "dark"
- fontFamily: font name (e.g. "Roboto", "NotoSansKR")
- scaffoldBackgroundColor: background color for all screens
- defaultBorderRadius: default corner radius (number)

- appBarTheme: { backgroundColor?, foregroundColor?, elevation?, centerTitle?, titleFontSize?, titleFontWeight? }
- cardTheme: { elevation?, color?, shadowColor?, borderRadius? }
- elevatedButtonTheme: { borderRadius?, elevation?, backgroundColor?, foregroundColor?, fontSize?, minimumSize?: {width?, height?}, padding?: {horizontal?, vertical?} }
- inputTheme: { fillColor?, filled?, borderRadius?, borderColor?, focusedBorderColor?, labelFontSize? }
- textTheme: { headlineFontSize?, bodyFontSize?, labelFontSize?, headlineColor?, bodyColor? }

RULES:
1. When the user says "dark mode", set brightness to "dark".
2. Colors can be hex (#FF5722) or named (red, blue, indigo, purple, teal, etc.).
3. Only include properties the user mentions or that are needed for a coherent design.
4. When modifying, preserve existing theme values that the user didn't ask to change.

Respond ONLY with the function call. No explanations.`;

const DESIGN_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    theme: {
      type: 'object',
      properties: {
        primaryColor: { type: 'string' },
        accentColor: { type: 'string' },
        scaffoldBackgroundColor: { type: 'string' },
        fontFamily: { type: 'string' },
        brightness: { type: 'string', enum: ['light', 'dark'] },
        defaultFontSize: { type: 'number' },
        defaultBorderRadius: { type: 'number' },
        appBarTheme: {
          type: 'object',
          properties: {
            backgroundColor: { type: 'string' },
            foregroundColor: { type: 'string' },
            elevation: { type: 'number' },
            centerTitle: { type: 'boolean' },
            titleFontSize: { type: 'number' },
            titleFontWeight: { type: 'string' },
          },
        },
        cardTheme: {
          type: 'object',
          properties: {
            elevation: { type: 'number' },
            color: { type: 'string' },
            shadowColor: { type: 'string' },
            borderRadius: { type: 'number' },
          },
        },
        elevatedButtonTheme: {
          type: 'object',
          properties: {
            borderRadius: { type: 'number' },
            elevation: { type: 'number' },
            backgroundColor: { type: 'string' },
            foregroundColor: { type: 'string' },
            fontSize: { type: 'number' },
            minimumSize: {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            padding: {
              type: 'object',
              properties: {
                horizontal: { type: 'number' },
                vertical: { type: 'number' },
              },
            },
          },
        },
        inputTheme: {
          type: 'object',
          properties: {
            fillColor: { type: 'string' },
            filled: { type: 'boolean' },
            borderRadius: { type: 'number' },
            borderColor: { type: 'string' },
            focusedBorderColor: { type: 'string' },
            labelFontSize: { type: 'number' },
          },
        },
        textTheme: {
          type: 'object',
          properties: {
            headlineFontSize: { type: 'number' },
            bodyFontSize: { type: 'number' },
            labelFontSize: { type: 'number' },
            headlineColor: { type: 'string' },
            bodyColor: { type: 'string' },
          },
        },
      },
    },
  },
  required: ['theme'],
};

export class DesignAgent extends BaseAgent {
  async generate(prompt: string): Promise<DesignResult> {
    const raw = await this.callFunction(
      DESIGN_PROMPT,
      prompt,
      'generate_design',
      DESIGN_SCHEMA
    );
    return raw as DesignResult;
  }

  async modify(prompt: string, currentTheme: Theme): Promise<DesignResult> {
    const userMessage = `Current theme:\n${JSON.stringify(currentTheme, null, 2)}\n\nUser request: ${prompt}`;

    const raw = await this.callFunction(
      DESIGN_PROMPT,
      userMessage,
      'generate_design',
      DESIGN_SCHEMA
    );
    return raw as DesignResult;
  }
}
