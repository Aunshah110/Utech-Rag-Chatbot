'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/types/chat';
import { SourceCard } from './SourceCard';

// ─── Styles ──────────────────────────────────────────────────────────────────
const STYLES = `
  @keyframes mb-fade-in-up {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes mb-cursor-glow {
    0%, 100% { opacity: 1;   box-shadow: 0 0 5px rgba(255,182,39,0.65); }
    50%       { opacity: 0.2; box-shadow: none; }
  }

  /* Wrapper */
  .mb-wrapper {
    display: flex;
    width: 100%;
    align-items: flex-end;
    gap: 9px;
    animation: mb-fade-in-up 0.36s cubic-bezier(.2,.9,.3,1) both;
  }

  /* ── Avatars ────────────────────────────── */
  .mb-avatar-ai {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, #7a5230 0%, rgba(112,62,35,0.9) 100%);
    box-shadow: 0 2px 8px rgba(112,62,35,0.34), inset 0 1px 0 rgba(255,255,255,0.15);
    color: #f5f5dc;
    align-self: flex-end;
    margin-bottom: 2px;
  }
  .mb-avatar-user {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ffb627 0%, #d2a679 100%);
    box-shadow: 0 2px 8px rgba(255,182,39,0.28);
    font-size: 11px;
    font-weight: 700;
    color: rgba(50,25,8,0.9);
    align-self: flex-end;
    margin-bottom: 2px;
  }

  /* ── Bubbles ────────────────────────────── */
  .mb-bubble-user {
    max-width: 80%;
    padding: 11px 16px;
    border-radius: 18px 18px 4px 18px;
    background: linear-gradient(145deg, #7a5230 0%, rgba(112,62,35,0.93) 100%);
    color: #f5f5dc;
    box-shadow: 0 4px 20px rgba(112,62,35,0.3), inset 0 1px 0 rgba(255,255,255,0.11);
    font-size: 15px;
    line-height: 1.62;
    word-break: break-words;
  }
  .mb-bubble-ai {
    max-width: 84%;
    padding: 13px 16px;
    border-radius: 18px 18px 18px 4px;
    background: rgba(255,251,245,0.97);
    border: 1px solid rgba(122,82,48,0.16);
    color: rgba(38,20,7,0.9);
    box-shadow: 0 4px 16px rgba(112,62,35,0.07), inset 0 1px 0 rgba(255,255,255,0.92);
    backdrop-filter: blur(4px);
    font-size: 15px;
    line-height: 1.65;
    word-break: break-words;
  }
  .mb-bubble-refusal {
    max-width: 84%;
    padding: 13px 16px;
    border-radius: 18px 18px 18px 4px;
    background: rgba(255,246,228,0.97);
    border: 1px solid rgba(255,182,39,0.28);
    color: rgba(65,35,15,0.9);
    box-shadow: 0 4px 14px rgba(255,182,39,0.1);
    font-size: 15px;
    line-height: 1.65;
    word-break: break-words;
  }

  /* ── Refusal header ─────────────────────── */
  .mb-refusal-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #7a5230;
    margin-bottom: 8px;
    padding: 4px 9px;
    border-radius: 6px;
    background: rgba(255,182,39,0.1);
    width: fit-content;
  }

  /* ── Citation pills ─────────────────────── */
  .mb-citation-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    font-size: 10px;
    font-weight: 700;
    color: rgba(50,25,8,0.92);
    background: linear-gradient(135deg, #ffb627 0%, #d2a679 100%);
    box-shadow: 0 1px 5px rgba(255,182,39,0.38);
    margin: 0 2px;
    vertical-align: middle;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    border: none;
    line-height: 1;
  }
  .mb-citation-pill:hover {
    transform: scale(1.12);
    box-shadow: 0 2px 8px rgba(255,182,39,0.55);
    outline: none;
  }
  .mb-citation-pill:focus-visible {
    outline: 2px solid rgba(255,182,39,0.6);
    outline-offset: 1px;
  }

  /* ── Sources toggle button ──────────────── */
  .mb-sources-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px 5px 9px;
    border-radius: 20px;
    border: 1px solid rgba(122,82,48,0.2);
    background: rgba(255,251,245,0.85);
    font-size: 12px;
    font-weight: 600;
    color: #7a5230;
    cursor: pointer;
    transition: all 0.22s ease;
    margin-bottom: 8px;
    backdrop-filter: blur(4px);
  }
  .mb-sources-btn:hover {
    background: rgba(255,246,220,0.99);
    border-color: rgba(255,182,39,0.4);
    color: rgba(50,25,8,0.9);
    box-shadow: 0 2px 8px rgba(255,182,39,0.14);
  }
  .mb-sources-btn:focus-visible {
    outline: 2px solid rgba(255,182,39,0.55);
    outline-offset: 2px;
  }
  .mb-sources-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 8.5px;
    background: linear-gradient(135deg, #ffb627 0%, #d2a679 100%);
    font-size: 9px;
    font-weight: 700;
    color: rgba(50,25,8,0.9);
    line-height: 1;
  }

  /* ── Streaming cursor ───────────────────── */
  .mb-cursor {
    display: inline-block;
    width: 2px;
    height: 15px;
    margin-left: 2px;
    margin-bottom: -2px;
    border-radius: 1px;
    background: #ffb627;
    vertical-align: middle;
    animation: mb-cursor-glow 1s ease-in-out infinite;
  }

  /* ── Error pill ─────────────────────────── */
  .mb-error-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
    padding: 5px 10px;
    border-radius: 20px;
    background: rgba(220,38,38,0.07);
    border: 1px solid rgba(220,38,38,0.2);
    color: #dc2626;
    font-size: 12px;
    font-weight: 500;
  }
`;

// ─── Citation helpers ─────────────────────────────────────────────────────────

/**
 * Converts [N] markers into `[cit:N]` inline-code tokens for ReactMarkdown.
 */
function injectCitationTokens(content: string): string {
  return content.replace(/\[(\d+)\]/g, '`[cit:$1]`');
}

/**
 * Splits a plain text string on citation tokens and replaces them with pill buttons.
 */
function renderText(text: string, onClick: (n: number) => void): React.ReactNode {
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
          className="mb-citation-pill"
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
 * Recursively walks React children and replaces citation token strings with pills.
 */
function withCitations(
  children: React.ReactNode,
  onClick: (n: number) => void
): React.ReactNode {
  if (typeof children === 'string') return renderText(children, onClick);
  if (Array.isArray(children)) {
    return children.map((c, i) => <span key={i}>{withCitations(c, onClick)}</span>);
  }
  return children;
}

// ─── Avatar sub-components ────────────────────────────────────────────────────

function AIAvatar() {
  return (
    <div className="mb-avatar-ai" aria-hidden>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a1 1 0 011 1v1.07A7 7 0 0119 11v1a7 7 0 01-6 6.93V20a1 1 0 11-2 0v-1.07A7 7 0 015 12v-1A7 7 0 0111 4.07V3a1 1 0 011-1zm0 4a5 5 0 100 10A5 5 0 0012 6zM9.5 11a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zm-3.75 3h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 010-1.5z" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="mb-avatar-user" aria-hidden>
      You
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const [showSources, setShowSources] = useState(true);

  const isUser    = message.role === 'user';
  const isRefusal = message.isRefusal;
  const hasSources = (message.sources?.length ?? 0) > 0;

  const handleCitationClick = (n: number) => {
    setShowSources(true);
    const el = document.getElementById(`${message.id}-source-${n}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const bubbleClass = useMemo(() => {
    if (isUser)    return 'mb-bubble-user';
    if (isRefusal) return 'mb-bubble-refusal';
    return 'mb-bubble-ai';
  }, [isUser, isRefusal]);

  const preparedContent = isUser
    ? message.content
    : injectCitationTokens(message.content);

  return (
    <>
      <style>{STYLES}</style>

      <div className={`mb-wrapper ${isUser ? 'justify-end' : 'justify-start'}`}>

        {/* AI avatar — left side */}
        {!isUser && <AIAvatar />}

        {/* Column: bubble + sources */}
        <div
          className="flex flex-col gap-2 min-w-0"
          style={{ flex: 1 }}
        >
          {/* ── Bubble ───────────────────────────────── */}
          <div
            className={bubbleClass}
            style={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}
          >
            {/* Refusal header */}
            {isRefusal && (
              <div className="mb-refusal-header">
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
                </svg>
                Insufficient information
              </div>
            )}

            {/* Content */}
            {isUser ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
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
                      <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="leading-relaxed">
                        {withCitations(children, handleCitationClick)}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ fontWeight: 700, color: 'rgba(38,20,7,0.96)' }}>
                        {withCitations(children, handleCitationClick)}
                      </strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic">{withCitations(children, handleCitationClick)}</em>
                    ),
                    code: ({ children }) => {
                      // Intercept citation pill tokens
                      const text = String(children);
                      const match = text.match(/^\[cit:(\d+)\]$/);
                      if (match) {
                        const n = Number(match[1]) - 1;
                        return (
                          <button
                            type="button"
                            onClick={() => handleCitationClick(n)}
                            className="mb-citation-pill"
                            aria-label={`Citation ${match[1]}`}
                          >
                            {match[1]}
                          </button>
                        );
                      }
                      // Regular inline code
                      return (
                        <code
                          style={{
                            background: 'rgba(65,35,15,0.07)',
                            border: '1px solid rgba(122,82,48,0.12)',
                            borderRadius: '4px',
                            padding: '2px 7px',
                            fontSize: '0.87em',
                            fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
                            color: 'rgba(55,28,8,0.88)',
                          }}
                        >
                          {children}
                        </code>
                      );
                    },
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#7a5230', textDecoration: 'underline', fontWeight: 500, transition: 'color 0.18s' }}
                        onMouseOver={(e) => (e.currentTarget.style.color = '#b07a33')}
                        onMouseOut={(e) => (e.currentTarget.style.color = '#7a5230')}
                      >
                        {children}
                      </a>
                    ),
                    h1: ({ children }) => (
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(38,20,7,0.95)', margin: '12px 0 6px 0' }}>
                        {withCitations(children, handleCitationClick)}
                      </h3>
                    ),
                    h2: ({ children }) => (
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(38,20,7,0.95)', margin: '10px 0 5px 0' }}>
                        {withCitations(children, handleCitationClick)}
                      </h3>
                    ),
                    h3: ({ children }) => (
                      <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(38,20,7,0.92)', margin: '8px 0 4px 0' }}>
                        {withCitations(children, handleCitationClick)}
                      </h4>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote
                        style={{
                          borderLeft: '3px solid #ffb627',
                          paddingLeft: '12px',
                          paddingTop: '5px',
                          paddingBottom: '5px',
                          margin: '8px 0',
                          color: 'rgba(65,35,15,0.7)',
                          fontStyle: 'italic',
                          background: 'rgba(255,182,39,0.07)',
                          borderRadius: '0 6px 6px 0',
                        }}
                      >
                        {children}
                      </blockquote>
                    ),
                    hr: () => (
                      <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid rgba(122,82,48,0.14)' }} />
                    ),
                    table: ({ children }) => (
                      <div style={{ overflowX: 'auto', marginBottom: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th
                        style={{
                          border: '1px solid rgba(122,82,48,0.15)',
                          background: 'rgba(122,82,48,0.06)',
                          padding: '6px 10px',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: '13px',
                        }}
                      >
                        {withCitations(children, handleCitationClick)}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td
                        style={{
                          border: '1px solid rgba(122,82,48,0.12)',
                          padding: '6px 10px',
                          fontSize: '13px',
                        }}
                      >
                        {withCitations(children, handleCitationClick)}
                      </td>
                    ),
                  }}
                >
                  {preparedContent}
                </ReactMarkdown>
              </div>
            )}

            {/* Streaming cursor */}
            {message.isStreaming && !isUser && (
              <span className="mb-cursor" aria-hidden />
            )}

            {/* Error */}
            {message.error && (
              <div className="mb-error-pill">
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                </svg>
                {message.error}
              </div>
            )}
          </div>

          {/* ── Sources ──────────────────────────────── */}
          {hasSources && !isUser && (
            <div style={{ alignSelf: 'flex-start', width: '100%', maxWidth: '84%' }}>
              {/* Toggle button */}
              <button
                type="button"
                className="mb-sources-btn"
                onClick={() => setShowSources((s) => !s)}
              >
                <svg
                  width="11"
                  height="11"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  style={{
                    transition: 'transform 0.22s ease',
                    transform: showSources ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Sources
                <span className="mb-sources-count">{message.sources!.length}</span>
              </button>

              {/* Source cards grid */}
              {showSources && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {message.sources!.map((s, i) => (
                    <div
                      key={`${message.id}-source-${i}`}
                      id={`${message.id}-source-${i}`}
                    >
                      <SourceCard source={s} index={i} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User avatar — right side */}
        {isUser && <UserAvatar />}
      </div>
    </>
  );
}