'use client';

import type { SourceCitation } from '@/types/chat';

interface Props {
  source: SourceCitation;
  index: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pathLabel(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    return segments[segments.length - 1]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const STYLES = `
  @keyframes sc-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0);   }
  }
  .sc-link {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-decoration: none;
    border-radius: 10px;
    border: 1px solid rgba(122,82,48,0.18);
    background: rgba(255,251,245,0.96);
    padding: 10px 12px 10px 15px;
    transition: all 0.26s cubic-bezier(.2,.9,.3,1);
    box-shadow: 0 2px 8px rgba(112,62,35,0.07);
    animation: sc-fade-in 0.35s cubic-bezier(.2,.9,.3,1) both;
  }
  .sc-link:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(112,62,35,0.16), 0 2px 6px rgba(255,182,39,0.1);
    border-color: rgba(122,82,48,0.38);
    background: rgba(255,248,235,0.99);
  }
  .sc-link:focus-visible {
    outline: 2px solid rgba(255,182,39,0.6);
    outline-offset: 2px;
  }
  /* Left accent bar */
  .sc-link::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, #ffb627 0%, #7a5230 100%);
    border-radius: 10px 0 0 10px;
    transition: width 0.24s ease;
  }
  .sc-link:hover::before {
    width: 4px;
  }
  /* Shimmer sweep on hover */
  .sc-link::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg, transparent 0%, rgba(255,182,39,0.1) 50%, transparent 100%);
    transform: translateX(-110%);
    transition: transform 0.55s ease;
    pointer-events: none;
  }
  .sc-link:hover::after {
    transform: translateX(110%);
  }
  /* Number badge */
  .sc-badge {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    color: rgba(50,25,8,0.9);
    background: linear-gradient(135deg, #ffb627 0%, #d2a679 100%);
    box-shadow: 0 2px 5px rgba(255,182,39,0.32);
    margin-top: 1px;
    line-height: 1;
  }
  /* External link arrow */
  .sc-arrow {
    flex-shrink: 0;
    margin-top: 2px;
    color: rgba(122,82,48,0.35);
    transition: transform 0.24s ease, color 0.24s ease;
  }
  .sc-link:hover .sc-arrow {
    transform: translate(2px, -2px);
    color: #ffb627;
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────
export function SourceCard({ source, index }: Props) {
  const title = source.title?.trim() || pathLabel(source.url);
  const domain = hostname(source.url);
  const faviconSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;

  return (
    <>
      <style>{STYLES}</style>

      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="sc-link"
        style={{ animationDelay: `${index * 65}ms` }}
      >
        {/* Number badge */}
        <span className="sc-badge" aria-hidden>
          {index + 1}
        </span>

        {/* Text content */}
        <span style={{ minWidth: 0, flex: 1 }}>
          {/* Title row */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              marginBottom: '3px',
            }}
          >
            {/* Favicon */}
            <img
              src={faviconSrc}
              alt=""
              width={12}
              height={12}
              style={{ borderRadius: '2px', flexShrink: 0, opacity: 0.8 }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {/* Title */}
            <span
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '13px',
                fontWeight: 600,
                color: 'rgba(50,28,10,0.92)',
                lineHeight: 1.35,
              }}
            >
              {title}
            </span>
          </span>

          {/* Domain */}
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '11px',
              color: '#7a5230',
              opacity: 0.65,
            }}
          >
            {domain}
          </span>
        </span>

        {/* External link icon */}
        <svg
          className="sc-arrow"
          width="14"
          height="14"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    </>
  );
}