import { useEffect, useRef, useState, useCallback } from 'react';
import { ExternalLink, MonitorSmartphone } from 'lucide-react';

interface DartPadEmbedProps {
  code: string;
}

export function DartPadEmbed({ code }: DartPadEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pendingCodeRef = useRef<string>('');

  const dartPadUrl = 'https://dartpad.dev/embed-flutter.html?theme=dark&split=0&run=false';

  const sendCode = useCallback((sourceCode: string) => {
    if (!iframeRef.current || !sourceCode) return;
    iframeRef.current.contentWindow?.postMessage(
      { sourceCode, type: 'sourceCode' },
      '*'
    );
  }, []);

  useEffect(() => {
    if (!ready || !code) return;
    sendCode(code);
  }, [code, ready, sendCode]);

  const handleIframeLoad = () => {
    setTimeout(() => {
      setReady(true);
      if (pendingCodeRef.current) {
        sendCode(pendingCodeRef.current);
      }
    }, 1500);
  };

  useEffect(() => {
    pendingCodeRef.current = code;
  }, [code]);

  const handleOpenDartPad = () => {
    const encoded = encodeURIComponent(code);
    window.open(
      `https://dartpad.dev/?sample=flutter&code=${encoded}`,
      '_blank'
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-1">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-white/70">Flutter 미리보기</span>
        </div>
        <button
          onClick={handleOpenDartPad}
          disabled={!code}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-white/40 hover:text-white/70 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-md transition-all"
          title="DartPad에서 열기"
        >
          <ExternalLink className="w-3 h-3" />
          <span>DartPad</span>
        </button>
      </div>

      <div className="flex-1 relative">
        {!code && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <MonitorSmartphone className="w-6 h-6 text-primary/50" />
            </div>
            <p className="text-white/25 text-sm">앱을 생성하면 미리보기가 표시됩니다</p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={dartPadUrl}
          onLoad={handleIframeLoad}
          className="w-full h-full border-0"
          allow="clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title="DartPad 미리보기"
        />
      </div>
    </div>
  );
}
