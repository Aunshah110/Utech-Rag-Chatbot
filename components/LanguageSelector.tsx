'use client';

import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, LanguageCode, Language } from '@/lib/i18n/translations';

interface Props {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  /** Optional label shown before the dropdown (desktop only) */
  label?: string;
}

export function LanguageSelector({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = LANGUAGES.find((l) => l.code === value) ?? LANGUAGES[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label ?? 'Language'}: ${current.name}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {/* Globe icon */}
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>

        {/* Current language (native script) */}
        <span className="font-semibold text-stone-800">{current.nativeName}</span>

        {/* Chevron */}
        <svg
          className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label ?? 'Language'}
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {LANGUAGES.map((lang) => (
            <LanguageOption
              key={lang.code}
              language={lang}
              selected={lang.code === value}
              onSelect={() => {
                onChange(lang.code);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageOption({
  language,
  selected,
  onSelect,
}: {
  language: Language;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      dir="ltr"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
        selected
          ? 'bg-amber-50 text-amber-800'
          : 'text-stone-700 hover:bg-stone-50'
      }`}
    >
      {/* Native name — rendered in its own script and direction */}
      <span
        dir={language.direction}
        className="flex-1 font-medium"
        style={{ unicodeBidi: 'isolate' }}
      >
        {language.nativeName}
      </span>

      {/* English name — always LTR */}
      <span className="shrink-0 text-xs text-stone-400">{language.name}</span>

      {/* Checkmark */}
      {selected && (
        <svg
          className="h-4 w-4 shrink-0 text-amber-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}