import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DICT, type Dict, type Lang } from './dict';

const STORAGE_KEY = 'flowcraft.lang';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  L: Dict;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return 'ko';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'ko' || stored === 'en') return stored;
  // Fall back to the browser preference, defaulting to Korean
  return window.navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ko';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  };

  useEffect(() => {
    document.documentElement.lang = DICT[lang].htmlLang;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, L: DICT[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used inside <LanguageProvider>');
  return ctx;
}
