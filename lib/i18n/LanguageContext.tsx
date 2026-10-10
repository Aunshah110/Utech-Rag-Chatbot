'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { LanguageCode, getTranslations, Translations } from './translations';

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'bbs-utech-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [hydrated, setHydrated] = useState(false);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
      if (stored && ['en', 'ur', 'sd'].includes(stored)) {
        setLanguageState(stored);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Apply to <html> for RTL support and font selection
  useEffect(() => {
    if (!hydrated) return;
    const html = document.documentElement;
    const lang = language;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
  }, [language, hydrated]);

  const setLanguage = (code: LanguageCode) => {
    setLanguageState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  };

  const value: LanguageContextValue = {
    language,
    setLanguage,
    t: getTranslations(language),
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
