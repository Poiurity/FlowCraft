import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

interface Props {
  code: string | null;
}

export function CodeView({ code }: Props) {
  const { L } = useLang();
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <div className="code-view code-view--empty">
        <Code2Icon />
        <p>{L.code.empty}</p>
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="code-view">
      <div className="code-view__toolbar">
        <span className="code-view__lang">Dart / Flutter</span>
        <button className="code-view__copy-btn" onClick={handleCopy} title={L.code.copyTitle}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? L.code.copied : L.code.copy}</span>
        </button>
      </div>
      <div className="code-view__body">
        <SyntaxHighlighter
          language="dart"
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            fontSize: '0.8rem',
            lineHeight: '1.5',
            height: '100%',
            overflow: 'auto',
          }}
          showLineNumbers
          lineNumberStyle={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', minWidth: '2.5rem' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// Inline svg fallback icon
function Code2Icon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
