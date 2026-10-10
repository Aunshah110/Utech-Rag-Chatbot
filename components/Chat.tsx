'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/types/chat';
import { useChatStream } from '@/lib/hooks/useChatWithSources';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { SuggestedQueries } from './SuggestedQueries';
import { ChatInput, ChatInputHandle } from './ChatInput';
import { LogoPlaceholder } from './LogoPlaceholder';
import { LanguageSelector } from './LanguageSelector';

const STORAGE_KEY = 'bbs-utech-chat-history-v1';
const MIN_THINKING_MS = 600;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thinkingStartRef = useRef<number>(0);

  const { language, setLanguage, t } = useLanguage();
  const { send, cancel, isStreaming } = useChatStream();
  
  // Inside Chat component:
  const chatInputRef = useRef<ChatInputHandle>(null);

  // After sending, ensure input stays focused:
  useEffect(() => {
    chatInputRef.current?.focus();
  }, [messages.length]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, showThinking]);

  const updateMessage = useCallback((updated: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === updated.id);
      if (idx === -1) return [...prev, updated];
      const copy = [...prev];
      copy[idx] = updated;
      return copy;
    });
  }, []);

  const handleSubmit = useCallback(
    async (query: string) => {
      const history = messages.slice();
      const userMsg: ChatMessage = {
        id: newId('u'),
        role: 'user',
        content: query,
      };
      setMessages((prev) => [...prev, userMsg]);

      thinkingStartRef.current = Date.now();
      setShowThinking(true);

      let hidden = false;
      const hideAfterMinimum = () => {
        if (hidden) return;
        hidden = true;
        const elapsed = Date.now() - thinkingStartRef.current;
        const remaining = Math.max(0, MIN_THINKING_MS - elapsed);
        if (remaining === 0) setShowThinking(false);
        else setTimeout(() => setShowThinking(false), remaining);
      };

      let firstDelta = true;

      try {
        await send(query, history, language, (delta) => {
          if (firstDelta && delta.content.length > 0) {
            firstDelta = false;
            hideAfterMinimum();
          }
          updateMessage(delta);
        });
      } finally {
        hideAfterMinimum();
      }
    },
    [messages, send, updateMessage, language]
  );

  const handleNewChat = () => {
    setMessages([]);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-shell flex h-[100dvh] flex-col">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="glass-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-4 sm:py-3">
          {/* Left: logo + title */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <LogoPlaceholder src="/uni_logo.png" size={36} />
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-sm sm:text-base font-semibold text-stone-900">
                {t.appTitle}
              </h1>
              <p className="hidden truncate text-[11px] text-stone-500 min-[400px]:block sm:text-xs">
                {t.appSubtitle}
              </p>
            </div>
          </div>

          {/* Right: language + new chat */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <LanguageSelector
              value={language}
              onChange={setLanguage}
              label={t.language}
            />
            <button
              type="button"
              onClick={handleNewChat}
              aria-label={t.newChat}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:px-3"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
              </svg>
              <span className="hidden md:inline">{t.newChat}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Messages ──────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center px-4 py-12">
            <SuggestedQueries onPick={handleSubmit} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-3 sm:px-4 py-5 sm:py-6">
            {messages.map((m) => {
              // Skip rendering empty streaming assistant messages — the
              // ThinkingIndicator covers that state.
              if (m.role === 'assistant' && m.isStreaming && m.content.length === 0) {
                return null;
              }
              return <MessageBubble key={m.id} message={m} />;
            })}
            {showThinking && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <ChatInput
        ref={chatInputRef}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onCancel={cancel}
        placeholder={t.placeholder}
        footerNote={t.footerNote}
        sendLabel={t.sendLabel}
        stopLabel={t.stopLabel}
      />
    </div>
  );
}