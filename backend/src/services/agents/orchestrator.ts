import { AppStateSchema, type AppState } from '../../models/appstate';
import { ClarifierAgent, type ClarifiedRequirement, type Intent } from './clarifier-agent';
import { WidgetExtenderAgent } from './widget-extender-agent';
import { StructureAgent, type StructureResult } from './structure-agent';
import { DesignAgent, type DesignResult } from './design-agent';

export type { Intent } from './clarifier-agent';

export class Orchestrator {
  private clarifier: ClarifierAgent;
  private widgetExtender: WidgetExtenderAgent;
  private structureAgent: StructureAgent;
  private designAgent: DesignAgent;

  constructor(apiKey: string) {
    this.clarifier = new ClarifierAgent(apiKey);
    this.widgetExtender = new WidgetExtenderAgent(apiKey);
    this.structureAgent = new StructureAgent(apiKey);
    this.designAgent = new DesignAgent(apiKey);
  }

  async process(prompt: string, currentState?: AppState): Promise<{ appState: AppState; intent: Intent; clarified: ClarifiedRequirement }> {
    // 1. Clarify + Classify intent (single LLM call)
    console.log(`[Orchestrator] Clarifying: "${prompt.slice(0, 60)}..."`);
    const clarified = await this.clarifier.clarify(prompt, currentState);
    const intent = clarified.intent;
    console.log(`[Orchestrator] Intent: ${intent}`);
    console.log(`[Orchestrator] Enriched: "${clarified.enrichedPrompt.slice(0, 80)}..."`);
    console.log(`[Orchestrator] Required widgets: [${clarified.requiredWidgets.join(', ')}]`);

    // 2. Extend: ensure all required widgets exist in registry
    const added = await this.widgetExtender.ensureWidgets(clarified.requiredWidgets);
    if (added.length > 0) {
      console.log(`[Orchestrator] New widgets added: [${added.join(', ')}]`);
    }

    // 3. Execute agents based on intent
    let appState: AppState;

    switch (intent) {
      case 'create': {
        const [structure, design] = await Promise.all([
          this.structureAgent.generate(clarified.enrichedPrompt),
          this.designAgent.generate(clarified.designDirection || clarified.enrichedPrompt),
        ]);
        appState = this.merge(structure, design);
        break;
      }

      case 'modifyStructure': {
        const structure = await this.structureAgent.modify(clarified.enrichedPrompt, currentState!);
        appState = this.merge(structure, { theme: currentState!.theme });
        break;
      }

      case 'modifyDesign': {
        const designPrompt = clarified.designDirection || clarified.enrichedPrompt;
        const design = await this.designAgent.modify(designPrompt, currentState!.theme);
        appState = this.merge(
          { appName: currentState!.appName, screens: currentState!.screens, navigation: currentState!.navigation },
          design,
        );
        break;
      }

      case 'modifyBoth': {
        const designPrompt = clarified.designDirection || clarified.enrichedPrompt;
        const [structure, design] = await Promise.all([
          this.structureAgent.modify(clarified.enrichedPrompt, currentState!),
          this.designAgent.modify(designPrompt, currentState!.theme),
        ]);
        appState = this.merge(structure, design);
        break;
      }
    }

    return { appState, intent, clarified };
  }

  private merge(structure: StructureResult, design: DesignResult): AppState {
    return AppStateSchema.parse({
      appName: structure.appName,
      theme: design.theme,
      screens: structure.screens,
      navigation: structure.navigation,
    });
  }
}
