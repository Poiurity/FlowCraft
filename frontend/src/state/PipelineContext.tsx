import { createContext, useContext, useReducer, type ReactNode } from 'react';
import { pipelineReducer, INITIAL_STATE, type PipelineState, type PipelineAction } from './pipelineReducer';
import type { PipelineEvent } from '../services/pipeline-events';

interface PipelineContextValue {
  state: PipelineState;
  dispatch: (action: PipelineAction) => void;
  emitEvent: (event: PipelineEvent) => void;
  reset: () => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(pipelineReducer, INITIAL_STATE);

  const emitEvent = (event: PipelineEvent) => dispatch({ kind: 'event', event });
  const reset = () => dispatch({ kind: 'reset' });

  return (
    <PipelineContext.Provider value={{ state, dispatch, emitEvent, reset }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used inside <PipelineProvider>');
  return ctx;
}

// Alias for back-compat within this module
export { PipelineContext };
