import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import type { AppState } from '../types/appstate';

interface AppStateViewerProps {
  appState: AppState | null;
}

function JsonNode({ name, value, depth = 0 }: { name: string; value: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-1 py-px" style={{ paddingLeft: depth * 14 + 4 }}>
        <span className="text-white/30 text-[12px]">{name}:</span>
        <span className="text-white/20 text-[12px] italic">null</span>
      </div>
    );
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[12px] hover:bg-white/5 rounded px-1 py-0.5 w-full text-left transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-white/25 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-white/25 shrink-0" />
          )}
          <span className="text-primary-light">{name}</span>
          <span className="text-white/15">{`{${entries.length}}`}</span>
        </button>
        {expanded && entries.map(([k, v]) => (
          <JsonNode key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[12px] hover:bg-white/5 rounded px-1 py-0.5 w-full text-left transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-white/25 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-white/25 shrink-0" />
          )}
          <span className="text-primary-light">{name}</span>
          <span className="text-white/15">{`[${value.length}]`}</span>
        </button>
        {expanded && value.map((item, i) => (
          <JsonNode key={i} name={String(i)} value={item} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-[12px] px-1 py-px" style={{ paddingLeft: depth * 14 + 16 }}>
      <span className="text-white/30">{name}:</span>
      <span className={
        typeof value === 'string'
          ? 'text-emerald-400/80'
          : typeof value === 'number'
          ? 'text-amber-400/80'
          : typeof value === 'boolean'
          ? 'text-primary-light'
          : 'text-white/50'
      }>
        {typeof value === 'string' ? `"${value}"` : String(value)}
      </span>
    </div>
  );
}

export function AppStateViewer({ appState }: AppStateViewerProps) {
  if (!appState) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
          <Database className="w-6 h-6 text-white/15" />
        </div>
        <p className="text-white/25 text-sm">아직 AppState가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-1">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Database className="w-4 h-4 text-amber-400/70" />
        <span className="text-xs font-medium text-white/70">AppState</span>
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono">
        <JsonNode name="appState" value={appState} />
      </div>
    </div>
  );
}
