import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Info, Sparkles, Wrench } from 'lucide-react';
import type { Changelog, LoopInfo } from '../services/api';
import type { SendResult } from '../App';
import { DoneSummaryCard } from './DoneSummaryCard';
import { useLang } from '../i18n/LanguageContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  changelog?: Changelog;
  loopInfo?: LoopInfo;
  /** Seed greeting — rendered from the active language dictionary. */
  seed?: boolean;
  timestamp: Date;
}

interface ChatPanelProps {
  onSend: (prompt: string) => Promise<SendResult>;
  isLoading: boolean;
  screenCount?: number;
}

// Compact chip summary — shown inline in chat for non-degraded, non-notable results
function LoopStatusChip({ loopInfo }: { loopInfo: LoopInfo }) {
  const { L } = useLang();
  if (loopInfo.degraded) return null; // handled by DoneSummaryCard

  const repairCount = loopInfo.attempts.filter(a => a.source === 'repair').length;
  const hasWarnings = loopInfo.finalState === 'SUCCESS_WITH_WARNINGS';
  const fidelity = loopInfo.fidelity;

  // Only show chip for notable metrics
  if (repairCount === 0 && !hasWarnings && fidelity == null) return null;

  return (
    <div className="loop-status-chip">
      {repairCount > 0 && (
        <span className="loop-chip loop-chip--amber">
          <Wrench size={9} />
          {L.chip.repairs(repairCount)}
        </span>
      )}
      {fidelity != null && (
        <span className={`loop-chip ${fidelity >= 85 ? 'loop-chip--green' : fidelity >= 65 ? 'loop-chip--amber' : 'loop-chip--red'}`}>
          <Sparkles size={9} />
          {L.chip.fidelity(fidelity)}
        </span>
      )}
      {hasWarnings && (
        <span className="loop-chip loop-chip--blue">
          <Info size={9} />
          {L.chip.warnings}
        </span>
      )}
    </div>
  );
}

export function ChatPanel({ onSend, isLoading, screenCount }: ChatPanelProps) {
  const { L } = useLang();
  const [input, setInput] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: '',
      seed: true,
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmitPrompt = async (prompt: string) => {
    if (!prompt || isLoading) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLastPrompt(prompt);
    try {
      const { changelog, loopInfo } = await onSend(prompt);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
          changelog,
          loopInfo,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: L.chat.errorPrefix(err.message),
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    handleSubmitPrompt(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-panel">
      {/* Messages */}
      <div className="chat-panel__messages">
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`chat-msg chat-msg--${msg.role} animate-fade-in`}
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <div className="chat-msg__bubble">
              {msg.loopInfo ? (
                <div>
                  {/* Degraded → full DoneSummaryCard */}
                  {msg.loopInfo.degraded ? (
                    <DoneSummaryCard
                      loopInfo={msg.loopInfo}
                      screenCount={screenCount}
                      onRegenerate={lastPrompt ? () => handleSubmitPrompt(lastPrompt) : undefined}
                    />
                  ) : (
                    <>
                      {/* Non-degraded: compact chip + changelog */}
                      <LoopStatusChip loopInfo={msg.loopInfo} />
                      {msg.changelog && (
                        <div className="chat-changelog">
                          <p className="chat-changelog__summary">{msg.changelog.summary}</p>
                          {msg.changelog.changes.length > 0 && (
                            <ul className="chat-changelog__changes">
                              {msg.changelog.changes.map((c, i) => (
                                <li key={i} className={c.startsWith('  - ') ? 'chat-changelog__change--indent' : ''}>
                                  {c.startsWith('  - ') ? c.trim() : `· ${c}`}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {/* Success with fidelity/repairs — show DoneSummaryCard for detail */}
                      {(msg.loopInfo.fidelity != null || msg.loopInfo.attempts.some(a => a.source === 'repair')) && (
                        <DoneSummaryCard
                          loopInfo={msg.loopInfo}
                          screenCount={screenCount}
                          onRegenerate={lastPrompt ? () => handleSubmitPrompt(lastPrompt) : undefined}
                        />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <span className="chat-msg__text">{msg.seed ? L.chat.greeting : msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-msg chat-msg--assistant animate-fade-in">
            <div className="chat-msg__bubble chat-msg__bubble--loading">
              <div className="loading-dots">
                <div className="loading-dot" style={{ animationDelay: '0ms' }} />
                <div className="loading-dot" style={{ animationDelay: '160ms' }} />
                <div className="loading-dot" style={{ animationDelay: '320ms' }} />
              </div>
              <span className="loading-label">{L.chat.loading}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="chat-panel__composer">
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={L.chat.placeholder}
            rows={1}
            className="composer-textarea"
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="composer-send-btn"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
