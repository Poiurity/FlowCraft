import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, CheckCircle2, Lightbulb, ListChecks } from 'lucide-react';
import type { Changelog } from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  changelog?: Changelog;
  timestamp: Date;
}

interface ChatPanelProps {
  onSend: (prompt: string) => Promise<Changelog>;
  isLoading: boolean;
}

function ChangelogMessage({ changelog }: { changelog: Changelog }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2 text-emerald-400">
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="text-[13px] font-medium leading-snug">{changelog.summary}</span>
      </div>

      {changelog.changes.length > 0 && (
        <div className="ml-6">
          <div className="flex items-center gap-1.5 text-[11px] text-white/35 mb-1">
            <ListChecks className="w-3 h-3" />
            <span>변경 사항</span>
          </div>
          <ul className="space-y-0.5">
            {changelog.changes.map((change, i) => {
              const isIndented = change.startsWith('  - ');
              return (
                <li
                  key={i}
                  className={`text-[12px] leading-relaxed ${isIndented ? 'ml-3 text-white/40' : 'text-white/60'}`}
                >
                  {isIndented ? change.trim() : `· ${change}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {changelog.usageTips.length > 0 && (
        <div className="ml-6 border-t border-white/5 pt-2">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80 mb-1">
            <Lightbulb className="w-3 h-3" />
            <span>사용법</span>
          </div>
          <ul className="space-y-0.5">
            {changelog.usageTips.map((tip, i) => (
              <li key={i} className="text-[12px] text-white/50 leading-relaxed">· {tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ onSend, isLoading }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content:
        '만들고 싶은 앱을 자유롭게 설명해 주세요.\n\n예: "할 일 목록이 있는 투두 앱 만들어줘"',
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const changelog = await onSend(trimmed);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
          changelog,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `오류가 발생했습니다: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-1">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-surface-3 text-white/75 border border-border rounded-bl-md'
              }`}
            >
              {msg.changelog ? (
                <ChangelogMessage changelog={msg.changelog} />
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-surface-3 border border-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-primary loading-dot" />
                <div className="w-1.5 h-1.5 rounded-full bg-primary loading-dot" />
                <div className="w-1.5 h-1.5 rounded-full bg-primary loading-dot" />
              </div>
              <span className="text-xs text-white/35">생성 중...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 focus-within:border-border-focus transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="앱을 설명해 주세요..."
            rows={1}
            className="flex-1 bg-transparent text-white text-[16px] resize-none outline-none placeholder:text-white/25 max-h-32 items-center"
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="p-2 rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 shrink-0 shadow-[0_0_8px_rgba(55,137,252,0.2)] hover:shadow-[0_0_16px_rgba(55,137,252,0.35)]"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
