import { Languages } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { LANGS } from '../i18n/dict';

const SHORT: Record<string, string> = { ko: '한', en: 'EN' };

export function LanguageToggle() {
  const { lang, setLang } = useLang();

  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <Languages size={13} className="lang-toggle__icon" aria-hidden="true" />
      {LANGS.map((id) => (
        <button
          key={id}
          className={`lang-toggle__btn${lang === id ? ' lang-toggle__btn--active' : ''}`}
          onClick={() => setLang(id)}
          aria-pressed={lang === id}
        >
          {SHORT[id]}
        </button>
      ))}
    </div>
  );
}
