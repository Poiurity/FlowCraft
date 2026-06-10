// §6 — CriticAgent: intent fidelity scoring, post-VERIFY.
// Runs ONLY after VERIFY.ok===true. Never blocks a passing verification.
// Deterministic recommendation: model proposes scores/features; code decides the outcome.

import { BaseAgent } from './base-agent';
import type { CriticInput, CriticVerdict, CriticRecommendation } from '../verification/types';

const PASS_THRESHOLD = 85;
const WARN_THRESHOLD = 65;

const CRITIC_SYSTEM_PROMPT = `You are FlowCraft's Critic Agent. Your job is to assess whether a generated Flutter app faithfully implements the user's original request.

You receive:
1. The original user prompt (raw)
2. The enriched prompt (with implementation details added by a Clarifier agent)
3. A fact sheet summarizing what was actually built
4. A Dart code sample (first ~8000 characters)

SCORING (fidelityScore: 0..100):
- 100 = perfect, every requested feature present and correct
- 85+ = pass (minor gaps or extras)
- 65-84 = warn (some features missing or wrong but app is usable)
- <65 = significant missing features

FEATURE CLASSIFICATION:
- "core" severity: explicitly requested or essential for the primary use case
- "minor" severity: implied, nice-to-have, or ambiguous in the prompt

RULES:
- Only flag features that were explicitly or clearly implied in the original prompt.
- Extra features not asked for go in extraFeatures but do NOT lower the score.
- If the intent is "modifyDesign", score visual fidelity only (ignore functional features).
- reloopFeedback: concise instruction for regeneration; required when recommendation==='reloop'.

Respond ONLY with the critique_verdict function call.`;

const CRITIQUE_PARAMS = {
  type: 'object',
  required: ['fidelityScore', 'missingFeatures', 'extraFeatures', 'summary'],
  properties: {
    fidelityScore: { type: 'number', minimum: 0, maximum: 100 },
    missingFeatures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'severity'],
        properties: {
          description: { type: 'string' },
          severity: { type: 'string', enum: ['core', 'minor'] },
          evidence: { type: 'string' },
        },
      },
    },
    extraFeatures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'severity'],
        properties: {
          description: { type: 'string' },
          severity: { type: 'string', enum: ['core', 'minor'] },
          evidence: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: 'User-language verdict sentence.' },
    reloopFeedback: { type: 'string', description: 'Regeneration instruction (required if core features missing on attempt 0).' },
  },
};

export class CriticAgent extends BaseAgent {
  // §6.2 — critique() returns a CriticVerdict with a deterministic recommendation.
  async critique(input: CriticInput): Promise<CriticVerdict> {
    const reloopNote = input.attempt > 0
      ? ' A reloop was already attempted — your recommendation cannot be "reloop" again.'
      : '';

    const userMsg = [
      `Original prompt: "${input.originalPrompt}"`,
      `Enriched prompt: "${input.enrichedPrompt}"`,
      `Intent: ${input.intent}`,
      '',
      'FACT SHEET (what was built):',
      input.factSheet,
      '',
      'DART CODE SAMPLE:',
      '```dart',
      input.codeSample.slice(0, 8000),
      '```',
      reloopNote,
    ].join('\n');

    const raw = await this.callFunctionWithRetry(
      CRITIC_SYSTEM_PROMPT,
      userMsg,
      'critique_verdict',
      CRITIQUE_PARAMS,
      { model: 'gpt-4o-mini', maxRetries: 1, temperature: 0 },
    );

    // §6.3 — deterministic recommendation override (model proposes; code decides)
    const coreMissing = ((raw.missingFeatures ?? []) as any[])
      .filter(f => f.severity === 'core').length;
    const score: number = typeof raw.fidelityScore === 'number' ? raw.fidelityScore : 0;

    let recommendation: CriticRecommendation;
    if (coreMissing === 0 && score >= PASS_THRESHOLD) {
      recommendation = 'pass';
    } else if (coreMissing === 0 && score >= WARN_THRESHOLD) {
      recommendation = 'warn';
    } else if (coreMissing >= 1 && input.attempt === 0) {
      recommendation = 'reloop';
    } else {
      recommendation = 'warn';   // reloop budget spent
    }

    return {
      fidelityScore: score,
      recommendation,
      missingFeatures: raw.missingFeatures ?? [],
      extraFeatures: raw.extraFeatures ?? [],
      summary: raw.summary ?? '',
      reloopFeedback: recommendation === 'reloop' ? (raw.reloopFeedback ?? '') : undefined,
    };
  }
}
