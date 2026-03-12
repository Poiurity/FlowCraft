import { useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { DartPadEmbed } from './components/DartPadEmbed';
import { AppStateViewer } from './components/AppStateViewer';
import { generateFromPrompt, type Changelog } from './services/api';
import { MonitorSmartphone, Database } from 'lucide-react';
import type { AppState } from './types/appstate';

type RightTab = 'code' | 'preview' | 'state';

function App() {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [appState, setAppState] = useState<AppState | null>(null);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('preview');

  const handleSend = async (prompt: string): Promise<Changelog> => {
    setIsLoading(true);
    try {
      const result = await generateFromPrompt(prompt, sessionId);
      setSessionId(result.sessionId);
      setAppState(result.appState);
      setCode(result.code);
      setRightTab('preview');
      return result.changelog;
    } finally {
      setIsLoading(false);
    }
  };

  const tabs: { id: RightTab; label: string; icon: React.ReactNode }[] = [
    { id: 'preview', label: '미리보기', icon: <MonitorSmartphone className="w-3.5 h-3.5" /> },
    { id: 'state', label: '상태', icon: <Database className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-screen flex flex-col bg-surface-base text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-surface-1 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="FlowCraft" className="w-7 h-7 rounded-lg shadow-[0_0_12px_rgba(55,137,252,0.3)]" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">FlowCraft</h1>
            <p className="text-[10px] text-white/35 -mt-0.5">AI App Builder</p>
          </div>
        </div>
        {sessionId && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-white/30 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel */}
        <div className="w-[380px] shrink-0">
          <ChatPanel onSend={handleSend} isLoading={isLoading} />
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col min-w-0 border-l border-border">
          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-1 border-b border-border shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                  rightTab === tab.id
                    ? 'bg-primary/15 text-primary-light'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 relative">
            <div className={rightTab === 'preview' ? 'absolute inset-0' : 'absolute inset-0 invisible pointer-events-none'}>
              <DartPadEmbed code={code} />
            </div>
            <div className={rightTab === 'state' ? 'absolute inset-0' : 'hidden'}>
              <AppStateViewer appState={appState} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
