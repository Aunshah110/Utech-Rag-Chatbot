'use client';

import type { SourceCitation } from '@/types/chat';

interface Props {
  source: SourceCitation;
  index: number;
}

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

export function SourceCard({ source, index }: Props) {
  const title = source.title?.trim() || pathLabel(source.url);

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-amber-600 hover:bg-amber-50/50 focus:outline-none focus:ring-2 focus:ring-amber-600"
    >
      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-800 group-hover:text-amber-800">
          {title}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {hostname(source.url)}
        </span>
      </span>
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400 transition group-hover:text-amber-700"
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
  );
} 