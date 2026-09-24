'use client';

export function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white border border-slate-200 px-4 py-3 shadow-sm">
        <span className="sr-only">Thinking</span>
        <span className="h-2 w-2 rounded-full bg-amber-600 animate-bounce [animation-delay:-300ms]" />
        <span className="h-2 w-2 rounded-full bg-amber-600 animate-bounce [animation-delay:-150ms]" />
        <span className="h-2 w-2 rounded-full bg-amber-600 animate-bounce" />
      </div>
    </div>
  );
}