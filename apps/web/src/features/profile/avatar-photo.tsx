'use client';

import { motion, type Transition } from 'motion/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { API_BASE } from '@/lib/api';
import { fade, useReducedMotion } from '@/lib/motion';

/**
 * Photo versions, bumped after an upload or removal so every avatar of that person refetches.
 * The API answers with an ETag and `no-cache`, so a plain reload revalidates without this.
 */
let version = 0;
const landedAt = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getVersion = () => version;
const getServerVersion = () => 0;

/** Call after the person's photo changed. Their avatars refetch, and the new photo lands with a spring. */
export function bumpAvatarVersion(userId: string) {
  version += 1;
  landedAt.set(userId, version);
  for (const listener of listeners) listener();
}

export function useAvatarVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

export function avatarUrl(userId: string, v: number): string {
  return `${API_BASE}/files/avatar/${encodeURIComponent(userId)}?v=${v}`;
}

const land: Transition = { type: 'spring', bounce: 0.28, visualDuration: 0.34 };
const settle: Transition = { type: 'spring', bounce: 0, visualDuration: 0.24 };

/**
 * The person's photo over their initials. Nothing renders until the image has loaded, so a missing
 * photo (204), a hidden one (404) or a broken file leaves the initials in place.
 */
export function AvatarPhoto({ userId }: { userId: string }) {
  const v = useAvatarVersion();
  const reduce = useReducedMotion();
  const src = avatarUrl(userId, v);
  // The last photo that loaded, kept on screen while a newer version loads. Tied to the person so a
  // reused row never shows someone else's face.
  const [shown, setShown] = useState<{ userId: string; src: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      if (!cancelled) setShown(probe.naturalWidth > 0 ? { userId, src } : null);
    };
    probe.onerror = () => {
      if (!cancelled) setShown(null);
    };
    probe.src = src;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [src, userId]);

  if (!shown || shown.userId !== userId) return null;
  const justLanded = landedAt.get(userId) === v && shown.src === src;

  return (
    <motion.img
      key={shown.src}
      src={shown.src}
      alt=""
      draggable={false}
      onError={() => setShown(null)}
      className="absolute inset-0 size-full rounded-full object-cover"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: justLanded ? 0.55 : 0.94 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={reduce ? fade : justLanded ? land : settle}
    />
  );
}
