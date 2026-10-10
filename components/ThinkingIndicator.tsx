'use client';

// ─── Component ────────────────────────────────────────────────────────────────
export function ThinkingIndicator() {
  return (
    <>

      <div className="ti-wrapper">
        {/* AI Avatar */}
        <div className="ti-avatar" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a1 1 0 011 1v1.07A7 7 0 0119 11v1a7 7 0 01-6 6.93V20a1 1 0 11-2 0v-1.07A7 7 0 015 12v-1A7 7 0 0111 4.07V3a1 1 0 011-1zm0 4a5 5 0 100 10A5 5 0 0012 6zM9.5 11a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zm-3.75 3h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 010-1.5z" />
          </svg>
        </div>

        {/* Thinking Bubble */}
        <div className="ti-bubble">
          <span className="sr-only">AI is thinking</span>
          <span className="ti-dot" style={{ animationDelay: '0ms' }} />
          <span className="ti-dot" style={{ animationDelay: '200ms' }} />
          <span className="ti-dot" style={{ animationDelay: '400ms' }} />
          <span className="ti-label">Thinking…</span>
        </div>
      </div>
    </>
  );
}