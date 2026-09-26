'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onSubmit: (query: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onCancel?: () => void;
}

export function ChatInput({ onSubmit, disabled, isStreaming, onCancel }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize up to a max height
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [value]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    // Changed border-t color to a neutral divider, and bg to footer-bg
    <div className="w-full border-t border-[var(--brown-mid)] bg-[var(--footer-bg)]">
      <div className="mx-auto max-w-3xl px-4 py-3">
        {/* The input box inside the black footer */}
        <div className="relative flex items-end gap-2 rounded-2xl border border-[var(--yellow)] bg-white p-2 shadow-sm transition-base focus-within:border-[var(--yellow)] focus-within:ring-2 focus-within:ring-[var(--yellow)]/30">

          {/* Search Icon */}
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-[var(--brown-mid)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            placeholder="Ask about admissions, programs, faculty..."
            className="flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-black placeholder:text-[var(--brown-mid)] focus:outline-none disabled:opacity-50"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brown-mid)] text-[var(--cream)] transition-base hover:bg-[var(--brown-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--brown-light)]"
              aria-label="Stop generating"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brown-mid)] text-[var(--cream)] transition-base hover:bg-[var(--brown-dark)] disabled:cursor-not-allowed disabled:bg-[var(--brown-light)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--brown-light)]"
              aria-label="Send message"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-6-6m6 6l-6 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Footer text - adjusted to be visible on black */}
        <p className="mt-2 text-center text-xs text-[var(--cream)]">
          Answers are based only on BBS-UTECH's published information.
        </p>
      </div>
    </div>
  );
}