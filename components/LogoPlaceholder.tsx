'use client';

import { useState } from 'react';

interface Props {
  /** Path to the logo file — drop it in /public and set this. */
  src?: string;
  /** Text to show if no logo is present. */
  fallbackText?: string;
  size?: number;
}

export function LogoPlaceholder({
  src = '/uni_logo.png',
  fallbackText = 'BBS',
  size = 40,
}: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold shadow-sm"
        style={{ width: size, height: size, fontSize: size * 0.35 }}
        aria-label="University logo placeholder"
      >
        {fallbackText}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="University logo"
      width={size}
      height={size}
      className="rounded-lg object-contain"
      onError={() => setFailed(true)}
    />
  );
}