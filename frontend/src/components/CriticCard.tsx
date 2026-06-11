import { Star, AlertTriangle, RefreshCw } from 'lucide-react';
import type { CriticEvent } from '../services/pipeline-events';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  critic: CriticEvent;
}

function fidelityColor(score: number): string {
  if (score >= 85) return 'critic-card--green';
  if (score >= 65) return 'critic-card--amber';
  return 'critic-card--red';
}

function RecommendationIcon({ rec }: { rec: CriticEvent['recommendation'] }) {
  if (rec === 'pass') return <Star size={14} className="critic-card__rec-icon critic-card__rec-icon--pass" />;
  if (rec === 'warn') return <AlertTriangle size={14} className="critic-card__rec-icon critic-card__rec-icon--warn" />;
  return <RefreshCw size={14} className="critic-card__rec-icon critic-card__rec-icon--reloop" />;
}

export function CriticCard({ critic }: Props) {
  const { L } = useLang();
  const colorClass = fidelityColor(critic.fidelity);

  return (
    <div className={`critic-card ${colorClass}`}>
      <div className="critic-card__score-row">
        <RecommendationIcon rec={critic.recommendation} />
        <span className="critic-card__score">{critic.fidelity}%</span>
        <span className="critic-card__label">{L.critic.fidelityLabel(critic.fidelity)}</span>
      </div>
      {critic.summary && (
        <div className="critic-card__summary">{critic.summary}</div>
      )}
      {critic.scope && (
        <div className="critic-card__scope">{L.critic.scopePrefix}{critic.scope}</div>
      )}
    </div>
  );
}
