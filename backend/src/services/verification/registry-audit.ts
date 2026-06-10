// Read-only registry audit — persistence gate for learned definitions.
// Does NOT mutate the validation snapshot. Runs offline / at boot.
// The datePicker poison entry is removed by a one-time manual data fix (not this code).

import type { WidgetDefinition } from '../widget-registry/types';
import { KNOWN_FLUTTER_WIDGETS } from './knowledge/known-widgets';

export interface DefAuditResult {
  defName: string;
  ok: boolean;
  problems: string[];
}

export interface RegistryAuditResult {
  checked: number;
  passed: number;
  failed: number;
  results: DefAuditResult[];
}

const VALID_PROP_TYPES = new Set(['number', 'string', 'bool', 'color', 'icon', 'edgeInsets']);

export function auditRegistry(defs: WidgetDefinition[]): RegistryAuditResult {
  const results: DefAuditResult[] = [];

  for (const def of defs) {
    const problems: string[] = [];

    // C7 — structural validity
    if (!def.dartWidget || typeof def.dartWidget !== 'string') {
      problems.push('dartWidget must be a non-empty string');
    }
    for (const prop of def.props ?? []) {
      if (!VALID_PROP_TYPES.has(prop.type)) {
        problems.push(`prop '${prop.name}' has invalid type '${prop.type}'`);
      }
      if (typeof prop.dartParam !== 'string') {
        problems.push(`prop '${prop.name}' missing dartParam`);
      }
    }
    if (def.stateBinding) {
      if (!def.stateBinding.valueProp) problems.push('stateBinding missing valueProp');
      if (!def.stateBinding.onChangedProp) problems.push('stateBinding missing onChangedProp');
    }

    // C11 — allowlist check
    if (def.dartWidget && !KNOWN_FLUTTER_WIDGETS.has(def.dartWidget)) {
      problems.push(`dartWidget '${def.dartWidget}' is not on KNOWN_FLUTTER_WIDGETS allowlist`);
    }

    results.push({ defName: def.name, ok: problems.length === 0, problems });
  }

  const passed = results.filter(r => r.ok).length;
  return { checked: defs.length, passed, failed: defs.length - passed, results };
}

// Learning compile-gate: a candidate def passes only if C7+C11 are clean.
export function isLearningCandidate(def: WidgetDefinition): { ok: boolean; problems: string[] } {
  const { results } = auditRegistry([def]);
  return { ok: results[0].ok, problems: results[0].problems };
}
