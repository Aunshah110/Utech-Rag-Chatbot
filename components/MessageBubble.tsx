'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/types/chat';
import { SourceCard } from './SourceCard';

interface Props {
  message: ChatMessage;
}

/**
 * Preprocesses the assistant's markdown to convert [N] citation markers into
 * a special inline code token that ReactMarkdown renders as a clickable pill.
 * Using a code span avoids ReactMarkdown stripping raw HTML.
 */
function injectCitationTokens(content: string): string {
  // Replace [N] with `[N]` (inline code) — the custom renderer will detect it.
  return content.replace(/\[(\d+)\]/g, '`[cit:$1]`');
}

/**
 * Custom renderer for paragraphs, lists, code, etc.
 * Renders [cit:N] tokens as interactive citation pills.
 */
function renderText(text: string, onClick: (n: number) => void): React.ReactNode {
  // Split on `[cit:N]` inline-code tokens
  const parts = text.split(/`\[cit:(\d+)\]`/g);
  if (parts.length === 1) return text;

  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) out.push(parts[i]);
    } else {
      const n = Number(parts[i]) - 1;
      out.push(
        <button
          key={`cit-${i}`}
          type="button"
          onClick={() => onClick(n)}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 align-middle text-[10px] font-semibold text-amber-800 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label={`Citation ${parts[i]}`}
        >
          {parts[i]}
        </button>
      );
    }
  }
  return out;
}

/**
 * Recursively walk React children and render citation tokens found in strings.
 */
function withCitations(
  children: React.ReactNode,
  onClick: (n: number) => void
): React.ReactNode {
  if (typeof children === 'string') {
    return renderText(children, onClick);
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => <span key={i}>{withCitations(c, onClick)}</span>);
  }
  return children;
}

export function MessageBubble({ message }: Props) {
  const [showSources, setShowSources] = useState(true);

  const isUser = message.role === 'user';
  const isRefusal = message.isRefusal;
  const hasSources = (message.sources?.length ?? 0) > 0;

  const handleCitationClick = (n: number) => {
    setShowSources(true);
    const el = document.getElementById(`${message.id}-source-${n}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const bubbleClasses = useMemo(() => {
    const base =
      'max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm';
    if (isUser) {
      return `${base} bg-amber-700 text-white rounded-br-md`;
    }
    if (isRefusal) {
      return `${base} bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-md`;
    }
    return `${base} bg-white text-slate-800 border border-slate-200 rounded-bl-md`;
  }, [isUser, isRefusal]);

  // Preprocess content for the assistant (inject citation tokens)
  const preparedContent = isUser
    ? message.content
    : injectCitationTokens(message.content);

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="flex w-full flex-col items-start gap-2">
        <div
          className={bubbleClasses}
          style={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}
        >
          {isRefusal && (
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-700">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z"
                />
              </svg>
              Not enough information
            </div>
          )}

          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="prose-chat break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => (
                    <p className="mb-2 last:mb-0">
                      {withCitations(children, handleCitationClick)}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">
                      {withCitations(children, handleCitationClick)}
                    </li>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-slate-900">
                      {withCitations(children, handleCitationClick)}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic">{withCitations(children, handleCitationClick)}</em>
                  ),
                  code: ({ children }) => {
                    // Citation tokens land here as code spans
                    const text = String(children);
                    const match = text.match(/^\[cit:(\d+)\]$/);
                    if (match) {
                      const n = Number(match[1]) - 1;
                      return (
                        <button
                          type="button"
                          onClick={() => handleCitationClick(n)}
                          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 align-middle text-[10px] font-semibold text-amber-800 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          aria-label={`Citation ${match[1]}`}
                        >
                          {match[1]}
                        </button>
                      );
                    }
                    return (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono text-slate-800">
                        {children}
                      </code>
                    );
                  },
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 underline hover:text-amber-900"
                    >
                      {children}
                    </a>
                  ),
                  h1: ({ children }) => (
                    <h3 className="mb-2 mt-3 text-base font-semibold text-slate-900 first:mt-0">
                      {withCitations(children, handleCitationClick)}
                    </h3>
                  ),
                  h2: ({ children }) => (
                    <h3 className="mb-2 mt-3 text-base font-semibold text-slate-900 first:mt-0">
                      {withCitations(children, handleCitationClick)}
                    </h3>
                  ),
                  h3: ({ children }) => (
                    <h4 className="mb-1 mt-2 text-[15px] font-semibold text-slate-900 first:mt-0">
                      {withCitations(children, handleCitationClick)}
                    </h4>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="mb-2 border-l-2 border-amber-300 pl-3 italic text-slate-700">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-3 border-slate-200" />,
                  table: ({ children }) => (
                    <div className="mb-2 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold">
                      {withCitations(children, handleCitationClick)}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-slate-200 px-2 py-1">
                      {withCitations(children, handleCitationClick)}
                    </td>
                  ),
                }}
              >
                {preparedContent}
              </ReactMarkdown>
            </div>
          )}

          {message.isStreaming && !isUser && (
            <span className="ml-0.5 inline-block h-4 w-[2px] -mb-0.5 animate-pulse bg-amber-600 align-middle" />
          )}

          {message.error && (
            <div className="mt-2 text-xs text-red-600">Error: {message.error}</div>
          )}
        </div>

        {hasSources && !isUser && (
          <div className="w-full max-w-[85%] md:max-w-[75%]">
            <button
              type="button"
              onClick={() => setShowSources((s) => !s)}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-amber-800 focus:outline-none"
            >
              <svg
                className={`h-3 w-3 transition-transform ${showSources ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Sources ({message.sources!.length})
            </button>
            {showSources && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {message.sources!.map((s, i) => (
                  <div key={`${message.id}-source-${i}`} id={`${message.id}-source-${i}`}>
                    <SourceCard source={s} index={i} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}