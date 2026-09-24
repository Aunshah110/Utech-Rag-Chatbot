'use client';

interface Props {
  onPick: (query: string) => void;
}

const SUGGESTIONS = [
  'What are the admission requirements for MS Civil Engineering?',
  'Who teaches in the Computer Science department?',
  'What programs does the university offer?',
  'What is the fee structure for BS programs?',
];

export function SuggestedQueries({ onPick }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4">
      <h2 className="mb-4 text-center text-lg font-medium text-slate-700">
        Try asking about...
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 shadow-sm transition hover:border-amber-600 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}