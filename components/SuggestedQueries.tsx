'use client';

interface Props {
  onPick: (query: string) => void;
}

const SUGGESTIONS = [
  'What are the admission requirements for MS Civil Engineering?',
  'Who teaches in the Computer Science department?',
  'What programs does the university offer?',
  'What is the fee structure for BS programs?',
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const STYLES = `
  /* ── Badge pill ── */
  .sq-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 20px;
    border: 1px solid rgba(255,182,39,0.35);
    background: rgba(255,182,39,0.1);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: #ffb627;
  }
  .sq-badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #ffb627;
    box-shadow: 0 0 6px rgba(255,182,39,0.7);
  }

  /* ============================================================
     HERO TITLE — cursor-tracked background highlight
     Existing headline dimensions/layout are intentionally preserved.
     ============================================================ */
  .sq-headline {
    position: relative;
    z-index: 2;
    display: block;
    font-size: clamp(1.35rem, 3.5vw, 2rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-align: center;
    color: var(--brown-900, #262424);
    cursor: default;
    text-shadow: 0 2px 8px rgba(255, 255, 255, 0.55);
    isolation: isolate;
  }

  /* The visible dark text — base layer */
  .sq-headline-text {
    position: relative;
    z-index: 1;
  }

  /* The black circle that follows the cursor */
  .sq-headline::before {
    content: '';
    position: absolute;
    width: 60px;
    height: 60px;
    left: var(--cursor-x, 50%);
    top: var(--cursor-y, 50%);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #262424;
    opacity: var(--cursor-opacity, 0);
    pointer-events: none;
    z-index: 2;
    transition:
      left 0.08s linear,
      top 0.08s linear,
      opacity 0.2s ease;
  }

  /* Golden copy of the text, revealed only inside the circle */
  .sq-headline::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;

    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    line-height: inherit;

    color: #f1e5c4;
    -webkit-text-fill-color: #f1e5c4;
    text-shadow: 0 0 10px rgba(255, 218, 121, 0.6);

    -webkit-mask-image: radial-gradient(
      circle 32.5px at var(--cursor-x, 50%) var(--cursor-y, 50%),
      #000 99%,
      transparent 100%
    );
    mask-image: radial-gradient(
      circle 32.5px at var(--cursor-x, 50%) var(--cursor-y, 50%),
      #000 99%,
      transparent 100%
    );

    opacity: var(--cursor-opacity, 0);
    transition:
      -webkit-mask-image 0.08s linear,
      mask-image 0.08s linear,
      opacity 0.2s ease;
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────
export function SuggestedQueries({ onPick }: Props) {
  const handleHeadlineMove = (event: React.MouseEvent<HTMLHeadingElement>) => {
    const element = event.currentTarget;
    const textElement = element.querySelector('.sq-headline-text');

    if (!textElement) return;

    const rect = element.getBoundingClientRect();
    const textRect = textElement.getBoundingClientRect();

    // Activate only when the cursor is close to the visible slogan text.
    const proximity = 35;
    const closestX = Math.max(textRect.left, Math.min(event.clientX, textRect.right));
    const closestY = Math.max(textRect.top, Math.min(event.clientY, textRect.bottom));
    const distance = Math.hypot(event.clientX - closestX, event.clientY - closestY);

    if (distance > proximity) {
      element.style.setProperty('--cursor-opacity', '0');
      return;
    }

    element.style.setProperty('--cursor-x', `${event.clientX - rect.left}px`);
    element.style.setProperty('--cursor-y', `${event.clientY - rect.top}px`);
    element.style.setProperty('--cursor-opacity', '1');
  };

  const handleHeadlineLeave = (
    event: React.MouseEvent<HTMLHeadingElement>
  ) => {
    event.currentTarget.style.setProperty('--cursor-opacity', '0');
  };

  return (
    <>
      <style>{STYLES}</style>

      <div className="mx-auto max-w-2xl w-full px-4">

        {/* ── Slogan Hero ───────────────────────────────── */}
        {/* <div className="sq-hero"> */}

        {/* Main slogan */}
        <h2
          className="sq-headline"
          data-text="Ask Anything. Know Everything."
          onMouseMove={handleHeadlineMove}
          onMouseLeave={handleHeadlineLeave}
        >
          <span className="sq-headline-text">
            Ask Anything. Know Everything.
          </span>
        </h2>

        {/* Gold divider */}
        <span className="sq-divider" aria-hidden />
      </div>

      {/* ── Suggested Queries Label ───────────────────── */}
      <h3
        style={{
          marginBottom: '14px',
          textAlign: 'center',
          fontSize: '13px',
          fontWeight: 500,
          color: 'rgba(245,245,220,0.5)',
          letterSpacing: '0.3px',
        }}
      >
        Try asking about…
      </h3>

      {/* ── Suggestion Buttons ────────────────────────── */}
      <div className="buttons-container">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="suggestion-btn"
          >
            <span>{q}</span>
          </button>
        ))}
      </div>
    </>
  );
}