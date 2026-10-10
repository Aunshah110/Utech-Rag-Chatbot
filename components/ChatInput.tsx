'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

interface Props {
  onSubmit: (query: string) => void;
  isStreaming?: boolean;
  onCancel?: () => void;
  placeholder?: string;
  footerNote?: string;
  sendLabel?: string;
  stopLabel?: string;
}

export interface ChatInputHandle {
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { onSubmit, isStreaming, onCancel, placeholder, footerNote, sendLabel, stopLabel },
  ref
) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [value]);

  // Expose focus to parent
  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  // Keep focus always — even after send, even during streaming
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    onSubmit(q);
    setValue('');
    // Refocus after clear (the browser sometimes blurs on value='')
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-input-footer border-t border-stone-200/60 bg-white/60 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-3 sm:px-4 py-3">
        <div className="glass-input relative flex items-end gap-2 p-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder ?? 'Ask about admissions, programs, faculty...'}
            className="chat-input-textarea flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label={stopLabel ?? 'Stop generating'}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-stone-800 text-white transition hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              aria-label={sendLabel ?? 'Send message'}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-700 text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-stone-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-6-6m6 6l-6 6" />
              </svg>
            </button>
          )}
        </div>
        {footerNote && (
          <p className="mt-2 text-center text-xs text-stone-400">{footerNote}</p>
        )}
      </div>
    </div>
  );
});