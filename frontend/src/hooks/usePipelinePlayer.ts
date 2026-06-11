import { useCallback, useEffect, useRef } from 'react';
import type { PipelineEvent } from '../services/pipeline-events';
import type { PipelineAction } from '../state/pipelineReducer';

interface PlayerOptions {
  speed?: number;          // multiplier; default 1.5 (snappy replay)
  budgetMs?: number;       // total wall-clock budget for replay; default 4000ms
  onDone?: () => void;
}

interface PlayerControls {
  skip: () => void;
  stop: () => void;
}

// Instantly dispatch all events with no animation (for cache hits or skip)
function dispatchAll(events: PipelineEvent[], dispatch: (a: PipelineAction) => void) {
  for (const event of events) {
    dispatch({ kind: 'event', event });
  }
}

export function usePipelinePlayer(
  events: PipelineEvent[],
  dispatch: (action: PipelineAction) => void,
  options: PlayerOptions = {}
): PlayerControls {
  const { speed = 1.5, budgetMs = 4000, onDone } = options;
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);

  const clearAll = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);

  const skip = useCallback(() => {
    clearAll();
    if (!doneRef.current) {
      dispatchAll(events, dispatch);
      doneRef.current = true;
      onDone?.();
    }
  }, [events, dispatch, clearAll, onDone]);

  const stop = useCallback(() => {
    clearAll();
    doneRef.current = true;
  }, [clearAll]);

  useEffect(() => {
    if (events.length === 0) return;
    doneRef.current = false;
    clearAll();

    // Detect cache-hit / instant result: single attempt, ok=true, very short total time
    const runDone = events.find(e => e.type === 'run' && (e as any).phase === 'done') as any;
    const totalMs: number = runDone?.totalMs ?? 0;
    const isCacheHit = totalMs < 500 && events.filter(e => e.type === 'verify').length <= 1;

    if (isCacheHit) {
      // Don't animate — dispatch everything immediately
      dispatchAll(events, dispatch);
      doneRef.current = true;
      onDone?.();
      return;
    }

    // Compute timeline bounds from event timestamps
    const tValues = events.map(e => (e as any).t ?? 0).filter(Boolean);
    const maxT = tValues.length > 0 ? Math.max(...tValues) : 1;
    const scaleFactor = maxT > 0 ? (budgetMs / maxT) / speed : 1;

    for (const event of events) {
      const rawT = (event as any).t ?? 0;
      const wallMs = Math.round(rawT * scaleFactor);
      const id = setTimeout(() => {
        dispatch({ kind: 'event', event });
      }, wallMs);
      timeoutsRef.current.push(id);
    }

    // Notify done after last event
    const lastT = Math.round(maxT * scaleFactor);
    const doneId = setTimeout(() => {
      doneRef.current = true;
      onDone?.();
    }, lastT + 50);
    timeoutsRef.current.push(doneId);

    return () => clearAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  return { skip, stop };
}
