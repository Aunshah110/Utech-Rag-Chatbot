'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/types/chat';
import { useChatStream } from '@/lib/hooks/useChatWithSources';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { SuggestedQueries } from './SuggestedQueries';
import { ChatInput } from './ChatInput';
import { LogoPlaceholder } from './LogoPlaceholder';

const STORAGE_KEY = 'bbs-utech-chat-history-v1';

// Minimum time (ms) to show the thinking indicator, even if the answer
// arrives faster. Prevents a jarring flash-and-vanish.
const MIN_THINKING_MS = 600;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thinkingStartRef = useRef<number>(0);

  // Restore session history
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on change
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, showThinking]);

  const { send, cancel, isStreaming } = useChatStream();

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

      // FIX: record when we started thinking
      thinkingStartRef.current = Date.now();
      setShowThinking(true);

      // FIX: use a flag + helper so we always wait MIN_THINKING_MS
      let hidden = false;
      const hideAfterMinimum = () => {
        if (hidden) return;
        hidden = true;
        const elapsed = Date.now() - thinkingStartRef.current;
        const remaining = Math.max(0, MIN_THINKING_MS - elapsed);
        if (remaining === 0) {
          setShowThinking(false);
        } else {
          setTimeout(() => setShowThinking(false), remaining);
        }
      };

      let firstDelta = true;

      try {
        await send(query, history, (delta) => {
          if (firstDelta && delta.content.length > 0) {
            firstDelta = false;
            // FIX: don't immediately hide — respect MIN_THINKING_MS
            hideAfterMinimum();
          }
          updateMessage(delta);
        });
      } finally {
        // FIX: always ensure the indicator is dismissed when streaming ends,
        // even if the stream errored or produced no tokens.
        hideAfterMinimum();
      }
    },
    [messages, send, updateMessage]
  );

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen flex-col bg-[var(--white)]">
      {/* Header */}
      <header className="mx-4 mt-4 rounded-2xl border border-[var(--brown-mid)] bg-[var(--brown-dark)] shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <LogoPlaceholder src="/uni_logo.png" size={40} />
            <div className="leading-tight">
              <h1 className="text-base font-semibold text-[var(--cream)]">
                BBS-UTECH Assistant
              </h1>
              <p className="text-xs text-[var(--cream)]">
                Grounded answers from the <span>university&apos;s published info</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setMessages([]);
              sessionStorage.removeItem(STORAGE_KEY);
            }}
            className="hidden sm:inline-flex items-center gap-1.5 btn-new-chat"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
            </svg>
            New chat
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center py-12">
            {/* The Center Square */}
            <div className="card">
              <div className="inner">
                <SuggestedQueries onPick={handleSubmit} />
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
            {messages.map((m) => {
  const isEmptyStreamingAI =
    m.role === 'assistant' && m.isStreaming && !m.content;
  if (isEmptyStreamingAI) return null;
  return <MessageBubble key={m.id} message={m} />;
})}
{showThinking && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSubmit={handleSubmit}
        disabled={isStreaming}
        isStreaming={isStreaming}
        onCancel={cancel}
      />
    </div>
  );
}