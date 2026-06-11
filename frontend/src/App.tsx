import { useState, useCallback } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { DeviceFrame } from './components/DeviceFrame';
import { AppStateViewer } from './components/AppStateViewer';
import { WorkspaceTabs, type WorkspaceTab } from './components/WorkspaceTabs';
import { PipelineSpine } from './components/PipelineSpine';
import { PipelineRail } from './components/PipelineRail';
import { CodeView } from './components/CodeView';
import { PipelineProvider, usePipeline } from './state/PipelineContext';
import { generateFromPrompt, generateStream, type Changelog, type LoopInfo } from './services/api';
import { buildReplay } from './services/replay-engine';
import { usePipelinePlayer } from './hooks/usePipelinePlayer';
import { LanguageProvider, useLang } from './i18n/LanguageContext';
import { LanguageToggle } from './components/LanguageToggle';
import type { AppState } from './types/appstate';
import type { PipelineEvent } from './services/pipeline-events';

export interface SendResult {
  changelog: Changelog;
  loopInfo?: LoopInfo;
}

// Inner app — needs to be inside PipelineProvider to access usePipeline
function AppInner() {
  const { state, dispatch, emitEvent, reset } = usePipeline();
  const { lang, L } = useLang();

  const [sessionId, setSessionId] = useState<string | undefined>();
  const [appState, setAppState] = useState<AppState | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('activity');
  const [replayEvents, setReplayEvents] = useState<PipelineEvent[]>([]);

  const isRegenerating = isLoading && state.repairs.length > 0;

  const { skip } = usePipelinePlayer(replayEvents, dispatch, {
    onDone: () => {
      // Auto-switch to preview when pipeline completes
      setWorkspaceTab('preview');
    },
  });

  const handleSend = useCallback(async (prompt: string): Promise<SendResult> => {
    setIsLoading(true);
    reset();
    setWorkspaceTab('activity');

    try {
      // Phase 2: try SSE stream first; fall back to single-shot + replay
      let result;
      try {
        result = await generateStream(prompt, sessionId, emitEvent, lang);
      } catch (sseErr) {
        console.warn('[App] SSE failed, falling back to single-shot:', sseErr);
        result = await generateFromPrompt(prompt, sessionId, lang);
      }

      setSessionId(result.sessionId);
      setAppState(result.appState);
      setCode(result.code);

      const loopInfo: LoopInfo | undefined = result.attempts != null
        ? {
            degraded: result.degraded ?? false,
            degradeReason: result.degradeReason,
            fidelity: result.fidelity,
            finalState: result.finalState,
            attempts: result.attempts,
          }
        : undefined;

      // If SSE events were dispatched live, the spine is already up-to-date.
      // If we fell back to single-shot, start the replay animation.
      if (loopInfo && state.status !== 'done') {
        const events = buildReplay(result, L);
        setReplayEvents(events);
      }

      return { changelog: result.changelog, loopInfo };
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, reset, emitEvent, state.status, lang, L]);

  const handleTabChange = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    // Clicking Activity tab while running: no-op on tab, spine is already visible
  };

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__brand">
          <img src="/logo.png" alt="FlowCraft" className="app-header__logo" />
          <div>
            <h1 className="app-header__title">FlowCraft</h1>
            <p className="app-header__subtitle">{L.header.subtitle}</p>
          </div>
        </div>

        <PipelineRail onClickActivity={() => setWorkspaceTab('activity')} />

        <div className="app-header__right">
          <LanguageToggle />
          {sessionId && (
            <div className="app-header__session">
              <div className="app-header__session-dot" />
              <span className="app-header__session-id">{sessionId.slice(0, 8)}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="app-main">
        {/* Chat panel */}
        <aside className="app-chat">
          <ChatPanel
            onSend={handleSend}
            isLoading={isLoading}
            screenCount={appState?.screens?.length}
          />
        </aside>

        {/* Workspace */}
        <section className="app-workspace">
          <div className="workspace-header">
            <WorkspaceTabs activeTab={workspaceTab} onChange={handleTabChange} />
          </div>

          <div className="workspace-body">
            {/* Activity tab — Pipeline Spine (hero surface) */}
            <div className={workspaceTab === 'activity' ? 'workspace-tab-panel' : 'workspace-tab-panel workspace-tab-panel--hidden'}>
              <div className="activity-panel">
                <PipelineSpine
                  dispatch={dispatch}
                  onSkip={isLoading ? skip : undefined}
                />
              </div>
            </div>

            {/* Preview tab — Device Frame + DartPad */}
            <div className={workspaceTab === 'preview' ? 'workspace-tab-panel' : 'workspace-tab-panel workspace-tab-panel--hidden'}>
              <DeviceFrame code={code} isRegenerating={isRegenerating} />
            </div>

            {/* Code tab */}
            <div className={workspaceTab === 'code' ? 'workspace-tab-panel' : 'workspace-tab-panel workspace-tab-panel--hidden'}>
              <CodeView code={code} />
            </div>

            {/* State tab */}
            <div className={workspaceTab === 'state' ? 'workspace-tab-panel' : 'workspace-tab-panel workspace-tab-panel--hidden'}>
              <AppStateViewer appState={appState} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <PipelineProvider>
        <AppInner />
      </PipelineProvider>
    </LanguageProvider>
  );
}

export default App;
