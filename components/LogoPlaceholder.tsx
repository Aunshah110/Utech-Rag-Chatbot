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
  size = 90,
}: Props) {
  const [failed, setFailed] = useState(false);

  // Common animation and circle styling
  const baseClasses = "flex items-center justify-center transition-base hover:scale-140";

  if (failed || !src) {
    return (
      <div
        className={`${baseClasses} bg-[var(--brown-mid)] text-[var(--cream)] font-bold`}
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
      // Added object-contain for proper scaling
      className={`${baseClasses} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}