import { useEffect, useRef, useState, useCallback } from 'react';
import { ExternalLink, MonitorSmartphone, Tablet, Monitor, Loader2 } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

type FrameSize = 'phone' | 'tablet' | 'desktop';

interface Props {
  code: string | null;
  isRegenerating?: boolean;
}

const DARTPAD_URL = 'https://dartpad.dev/embed-flutter.html?theme=dark&split=0&run=false';

const FRAME_SIZES: { id: FrameSize; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'phone',   Icon: MonitorSmartphone },
  { id: 'tablet',  Icon: Tablet },
  { id: 'desktop', Icon: Monitor },
];

export function DeviceFrame({ code, isRegenerating = false }: Props) {
  const { L } = useLang();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [frameSize, setFrameSize] = useState<FrameSize>('phone');
  const lastGoodCodeRef = useRef<string>('');
  const pendingCodeRef = useRef<string>('');

  const sendCode = useCallback((sourceCode: string) => {
    if (!iframeRef.current || !sourceCode) return;
    iframeRef.current.contentWindow?.postMessage(
      { sourceCode, type: 'sourceCode' },
      '*'
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Hold last-good code during repair (v0 "LLM Suspense" — never flash broken build)
    if (!isRegenerating && code) {
      lastGoodCodeRef.current = code;
      sendCode(code);
    }
  }, [code, ready, isRegenerating, sendCode]);

  const handleIframeLoad = () => {
    setTimeout(() => {
      setReady(true);
      const toSend = pendingCodeRef.current;
      if (toSend) sendCode(toSend);
    }, 1500);
  };

  useEffect(() => {
    if (code) pendingCodeRef.current = code;
  }, [code]);

  const handleOpenDartPad = () => {
    const target = lastGoodCodeRef.current || code || '';
    if (!target) return;
    window.open(
      `https://dartpad.dev/?sample=flutter&code=${encodeURIComponent(target)}`,
      '_blank'
    );
  };

  return (
    <div className="device-frame">
      <div className="device-frame__toolbar">
        <div className="device-frame__toolbar-left">
          <MonitorSmartphone size={14} className="text-primary" />
          <span>{L.device.previewLabel}</span>
        </div>
        {/* Responsive size toggle */}
        <div className="device-frame__size-toggle">
          {FRAME_SIZES.map(({ id, Icon }) => (
            <button
              key={id}
              className={`device-frame__size-btn${frameSize === id ? ' device-frame__size-btn--active' : ''}`}
              onClick={() => setFrameSize(id)}
              title={L.device[id]}
            >
              <Icon size={12} />
            </button>
          ))}
        </div>
        <button
          onClick={handleOpenDartPad}
          disabled={!code && !lastGoodCodeRef.current}
          className="device-frame__open-btn"
          title={L.device.openDartPad}
        >
          <ExternalLink size={12} />
          <span>DartPad</span>
        </button>
      </div>

      <div className="device-frame__body">
        {!code && (
          <div className="device-frame__empty">
            <div className="device-frame__empty-icon">
              <MonitorSmartphone size={24} />
            </div>
            <p>{L.device.empty}</p>
          </div>
        )}

        {/* Regenerating overlay — holds last-good preview underneath */}
        {isRegenerating && (
          <div className="device-frame__overlay">
            <Loader2 size={20} className="device-frame__overlay-spinner" />
            <span>{L.device.regenerating}</span>
          </div>
        )}

        {/* Phone/tablet bezel wrapper */}
        <div className={`device-bezel device-bezel--${frameSize}`}>
          {frameSize === 'phone' && (
            <div className="device-bezel__notch" aria-hidden="true" />
          )}
          <iframe
            ref={iframeRef}
            src={DARTPAD_URL}
            onLoad={handleIframeLoad}
            className="device-frame__iframe"
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            title={L.device.iframeTitle}
          />
          {frameSize === 'phone' && (
            <div className="device-bezel__home" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}
