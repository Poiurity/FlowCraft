import type { Dict } from './dict';
import type { StageView } from '../state/pipelineReducer';
import type { ToolCallRow } from '../services/pipeline-events';

const DYNAMIC = new Set(['verify', 'repair', 'critic']);

/** Resolve a stage's display label for the active language. */
export function stageLabel(L: Dict, stage: StageView): string {
  const id = stage.id as string;

  // Segment lanes (Phase 5) carry the model-generated screen name. The backend
  // label embeds the real name, so prefer it; fall back to the id-derived name.
  if (id.startsWith('segment:')) {
    const name = stage.segmentName ?? id.slice(8);
    if (stage.status === 'pending') return name;
    if (stage.status === 'active') return stage.serverActiveLabel ?? L.reducer.segmentActive(name);
    return stage.serverDoneLabel ?? L.reducer.segmentDone(name);
  }

  // Stages with dynamic, structured labels are always rebuilt from data so they
  // switch language instantly (ignoring any server-baked label) — both active
  // and terminal states.
  if (DYNAMIC.has(id)) {
    const meta = L.stageMeta[id] ?? { name: id, activeLabel: id, doneLabel: id };
    if (stage.status === 'pending') return meta.name;
    if (stage.status === 'active') return meta.activeLabel;
    if (id === 'verify') return L.reducer.verifyDone(stage.verifyOk ?? true, stage.verifyIssueCount ?? 0);
    if (id === 'repair') return L.reducer.repairLabel(stage.repairAttempt ?? 1, stage.repairMax ?? 2);
    if (id === 'critic') return L.reducer.criticLabel(stage.criticFidelity ?? 0);
  }

  const meta = L.stageMeta[id] ?? { name: id, activeLabel: id, doneLabel: id };

  if (stage.status === 'pending') return meta.name;
  if (stage.status === 'active') return stage.serverActiveLabel ?? meta.activeLabel;
  // done / warning / error — prefer the backend label (carries counts) else generic
  return stage.serverDoneLabel ?? meta.doneLabel;
}

/** Localized expansion rows for a stage (repair has structured rows). */
export function stageRows(L: Dict, stage: StageView): ToolCallRow[] {
  if (stage.id === 'repair' && stage.issuesBefore != null) {
    const rows: ToolCallRow[] = [
      { label: L.reducer.rowBefore, value: L.reducer.count(stage.issuesBefore) },
      { label: L.reducer.rowApplied, value: L.reducer.count(stage.patchesApplied ?? 0) },
    ];
    if ((stage.patchesDropped ?? 0) > 0) {
      rows.push({ label: L.reducer.rowDropped, value: L.reducer.count(stage.patchesDropped ?? 0) });
    }
    return rows;
  }
  return stage.rows;
}
