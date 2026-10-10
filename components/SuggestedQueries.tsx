'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Props {
  onPick: (query: string) => void;
}

export function SuggestedQueries({ onPick }: Props) {
  const { t } = useLanguage();

  const suggestions = [
    t.suggestion1,
    t.suggestion2,
    t.suggestion3,
    t.suggestion4,
  ];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h2 className="mb-5 text-center text-base font-medium text-stone-700">
        {t.tryAsking}
      </h2>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-left text-sm font-medium text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span className="line-clamp-2 leading-snug">{q}</span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-amber-400 to-amber-600 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        ))}
      </div>
    </div>
  );
}