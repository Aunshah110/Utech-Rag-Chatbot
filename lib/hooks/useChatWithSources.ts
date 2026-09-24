'use client';

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, SourceCitation } from '@/types/chat';

interface UseChatStreamOptions {
  onFinish?: (message: ChatMessage) => void;
}

export function useChatStream(opts: UseChatStreamOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (
      query: string,
      history: ChatMessage[],
      onDelta: (message: ChatMessage) => void
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const buildMessage = (
        content: string,
        extra: Partial<ChatMessage> = {}
      ): ChatMessage => ({
        id: assistantId,
        role: 'assistant',
        content,
        isStreaming: true,
        ...extra,
      });

      onDelta(buildMessage(''));

      try {
        const messages = [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: query },
        ];

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let sources: SourceCitation[] = [];
        let isRefusal = false;
        let diagnostics: ChatMessage['diagnostics'] | undefined;

        const flush = () => {
          onDelta(
            buildMessage(accumulated, {
              sources: sources.length > 0 ? sources : undefined,
              isRefusal,
              diagnostics,
            })
          );
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }

            if (dataLines.length === 0) continue;

            let payload: any;
            try {
              payload = JSON.parse(dataLines.join('\n'));
            } catch {
              continue;
            }

            switch (eventName) {
              case 'metadata': {
                diagnostics = payload;
                if (payload.confident === false) {
                  isRefusal = true;
                }
                break;
              }
              case 'text': {
                accumulated += payload.delta ?? '';
                flush();
                break;
              }
              case 'sources': {
                sources = Array.isArray(payload.sources)
                  ? payload.sources.map((s: any) =>
                      typeof s === 'string'
                        ? { url: s, title: '' }
                        : { url: s.url, title: s.title ?? '' }
                    )
                  : [];
                flush();
                break;
              }
              case 'error': {
                throw new Error(payload.message ?? 'Stream error');
              }
              case 'done': {
                break;
              }
            }
          }
        }

        const finalMessage = buildMessage(accumulated, {
          sources: sources.length > 0 ? sources : undefined,
          isRefusal,
          diagnostics,
          isStreaming: false,
        });

        onDelta(finalMessage);
        opts.onFinish?.(finalMessage);
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          onDelta(
            buildMessage('(cancelled)', {
              isStreaming: false,
            })
          );
          return;
        }

        onDelta(
          buildMessage(
            "I'm having trouble reaching the assistant right now. Please try again in a moment.",
            {
              isStreaming: false,
              error: err?.message ?? 'Unknown error',
            }
          )
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [opts]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, isStreaming };
}