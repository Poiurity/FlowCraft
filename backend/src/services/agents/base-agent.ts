import OpenAI from 'openai';

export class BaseAgent {
  protected openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  protected async callFunction(
    systemPrompt: string,
    userMessage: string,
    functionName: string,
    parameters: Record<string, any>,
    model = 'gpt-4o'
  ): Promise<any> {
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: functionName,
            description: `Generate structured JSON output for ${functionName}`,
            parameters,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: functionName } },
      temperature: 0.1,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== functionName) {
      throw new Error(`AI가 유효한 ${functionName} 응답을 생성하지 못했습니다.`);
    }

    return JSON.parse(toolCall.function.arguments);
  }

  protected sanitizeScreens(raw: any): any {
    if (!raw || typeof raw !== 'object') return raw;

    if (Array.isArray(raw.screens)) {
      raw.screens = raw.screens.filter((s: any) =>
        s && typeof s === 'object' && s.id && s.name && s.route && s.body
      );
      for (const screen of raw.screens) {
        if (screen.name) {
          screen.name = screen.name.replace(/[^a-zA-Z0-9]/g, '');
          if (!/^[A-Z]/.test(screen.name)) {
            screen.name = screen.name.charAt(0).toUpperCase() + screen.name.slice(1);
          }
        }
        if (screen.body) screen.body = this.sanitizeWidget(screen.body);
        if (screen.screenState?.variables) {
          this.sanitizeStateVariables(screen.screenState.variables);
        }
      }
    }
    return raw;
  }

  private sanitizeStateVariables(variables: any[]): void {
    const VALID_ITEM_FIELD_TYPES = new Set(['string', 'int', 'double', 'bool']);
    const COMPLEX_TO_SIMPLE: Record<string, string> = {
      stringList: 'string', itemList: 'string',
    };

    for (const v of variables) {
      if (Array.isArray(v.itemFields)) {
        v.itemFields = v.itemFields.filter((f: any) => f && f.name && f.type);
        for (const field of v.itemFields) {
          if (!VALID_ITEM_FIELD_TYPES.has(field.type)) {
            field.type = COMPLEX_TO_SIMPLE[field.type] || 'string';
          }
        }
      }
    }
  }

  protected sanitizeWidget(node: any): any {
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
