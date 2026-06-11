import { CheckCircle, AlertTriangle, XCircle, Clock, RotateCcw, FileCode2, RefreshCw, Undo2 } from 'lucide-react';
import type { LoopInfo } from '../services/api';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  loopInfo: LoopInfo;
  screenCount?: number;
  onRegenerate?: () => void;
  onUndo?: () => void;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export function DoneSummaryCard({ loopInfo, screenCount, onRegenerate, onUndo }: Props) {
  const { L } = useLang();
  const { degraded, degradeReason, fidelity, finalState, attempts } = loopInfo;

  const repairAttempts = attempts.filter(a => a.source === 'repair').length;
  const totalMs = attempts.reduce((sum, a) => sum + (a.durationMs ?? 0), 0);
  const criticData = attempts.reverse().find(a => a.critic?.called)?.critic;
  const fidelityScore = fidelity ?? criticData?.fidelityScore ?? 0;

  let StatusIcon = CheckCircle;
  let statusClass = 'done-summary--success';
  let statusText = L.done.success;
  if (degraded) {
    StatusIcon = XCircle;
    statusClass = 'done-summary--degraded';
    statusText = L.done.partial;
  } else if (finalState === 'SUCCESS_WITH_WARNINGS') {
    StatusIcon = AlertTriangle;
    statusClass = 'done-summary--warning';
    statusText = L.done.withWarnings;
  }

  return (
    <div className={`done-summary ${statusClass}`}>
      {/* Header */}
      <div className="done-summary__header">
        <StatusIcon size={16} className="done-summary__icon" />
        <span className="done-summary__title">{statusText}</span>
      </div>

      {/* Metrics row */}
      <div className="done-summary__metrics">
        {fidelityScore > 0 && (
          <span className={`done-summary__metric done-summary__fidelity${fidelityScore >= 85 ? '--green' : fidelityScore >= 65 ? '--amber' : '--red'}`}>
            {L.done.fidelityMetric(fidelityScore, L.critic.fidelityLabel(fidelityScore))}
          </span>
        )}
        {totalMs > 0 && (
          <span className="done-summary__metric">
            <Clock size={11} />
            {formatMs(totalMs)}
          </span>
        )}
        {repairAttempts > 0 && (
          <span className="done-summary__metric">
            <RotateCcw size={11} />
            {L.done.repairs(repairAttempts)}
          </span>
        )}
        {screenCount != null && screenCount > 0 && (
          <span className="done-summary__metric">
            <FileCode2 size={11} />
            {L.done.screens(screenCount)}
          </span>
        )}
      </div>

      {/* Degrade reason */}
      {degraded && degradeReason && (
        <div className="done-summary__degrade">
          <span className="done-summary__degrade-label">{L.done.degradeLabel}</span>
          <span>{(degradeReason && L.done.degradeReasons[degradeReason]) ?? degradeReason}</span>
        </div>
      )}

      {/* Critic summary */}
      {criticData?.called && (
        <div className="done-summary__critic">
          {criticData.recommendation === 'warn' && (
            <p className="done-summary__critic-warn">{L.done.criticWarn}</p>
          )}
          {criticData.recommendation === 'reloop' && (
            <p className="done-summary__critic-reloop">{L.done.criticReloop}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="done-summary__actions">
        {onRegenerate && (
          <button className="done-summary__btn done-summary__btn--regen" onClick={onRegenerate}>
            <RefreshCw size={12} />
            {L.done.regenerate}
          </button>
        )}
        {onUndo && (
          <button className="done-summary__btn done-summary__btn--undo" onClick={onUndo}>
            <Undo2 size={12} />
            {L.done.undo}
          </button>
        )}
      </div>
    </div>
  );
}
