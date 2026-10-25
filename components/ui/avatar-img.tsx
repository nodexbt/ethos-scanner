"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Profile picture with a fallback. Avatar URLs come from X and Ethos and
 * go stale; without this a dead link renders the browser's broken-image
 * box with the alt text spilling out of the circle.
 *
 * `name` supplies the fallback initial (omit it for tiny avatars, which
 * fall back to a plain circle). `className` sizes and shapes both states.
 */
export function AvatarImg({
  src,
  alt = "",
  name,
  title,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  name?: string | null;
  title?: string;
  className?: string;
}) {
  // Remember which URL failed rather than a boolean, so a new src (e.g.
  // the card is reused for another profile) gets its own attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    const initial = name?.trim().match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase();
    return (
      <span
        aria-hidden={alt ? undefined : true}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        title={title}
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-medium select-none shrink-0",
          className
        )}
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailedSrc(src)}
      // Server-rendered images can fail before React hydrates and attaches
      // onError; catch those on mount.
      ref={(el) => {
        if (el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
      }}
    />
  );
}
