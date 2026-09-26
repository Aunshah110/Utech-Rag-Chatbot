'use client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const STYLES = `
  @keyframes ti-wave {
    0%, 60%, 100% { transform: translateY(0);    opacity: 0.35; }
    30%            { transform: translateY(-7px); opacity: 1;    }
  }
  @keyframes ti-glow-pulse {
    0%, 100% { box-shadow: 0 4px 16px rgba(122,82,48,0.09), inset 0 1px 0 rgba(255,255,255,0.75); }
    50%       { box-shadow: 0 4px 24px rgba(255,182,39,0.18), inset 0 1px 0 rgba(255,255,255,0.75); }
  }
  @keyframes ti-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes ti-text-fade {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1;   }
  }
  .ti-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    animation: ti-fade-in 0.32s cubic-bezier(.2,.9,.3,1) both;
  }
  .ti-avatar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #7a5230 0%, rgba(112,62,35,0.9) 100%);
    box-shadow: 0 2px 10px rgba(112,62,35,0.38), inset 0 1px 0 rgba(255,255,255,0.15);
    color: #f5f5dc;
  }
  .ti-bubble {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 16px;
    border-radius: 18px 18px 18px 4px;
    background: rgba(255,251,245,0.97);
    border: 1px solid rgba(122,82,48,0.17);
    backdrop-filter: blur(6px);
    animation: ti-glow-pulse 2.2s ease-in-out infinite;
  }
  .ti-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ffb627, #7a5230);
    box-shadow: 0 2px 5px rgba(255,182,39,0.4);
    animation: ti-wave 1.5s ease-in-out infinite;
  }
  .ti-label {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.3px;
    color: #7a5230;
    animation: ti-text-fade 1.5s ease-in-out infinite;
    margin-left: 2px;
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────
export function ThinkingIndicator() {
  return (
    <>
      <style>{STYLES}</style>

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