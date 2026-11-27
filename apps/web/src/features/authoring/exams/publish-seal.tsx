'use client';

import { motion } from 'motion/react';
import { useRef } from 'react';
import { useReducedMotion } from '@/lib/motion';

/**
 * The moment of publication: when this exam goes from draft to published while the page is open, a carmine seal
 * stamps down beside the next step. The ring draws itself, the seal lands with a slight overshoot and settles.
 * It plays once per transition and stays put; with reduced motion it simply appears.
 */
export function PublishSeal({ status, opensAt }: { status: string; opensAt: string }) {
  const previous = useRef(status);
  const stamped = useRef(false);
  if (previous.current !== status) {
    if (previous.current === 'draft' && status === 'published') stamped.current = true;
    if (status === 'draft') stamped.current = false;
    previous.current = status;
  }
  const reduced = useReducedMotion();
  if (!stamped.current) return null;

  const day = new Date(opensAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <motion.div
      aria-hidden
      className="relative size-16 shrink-0 text-accent"
      initial={reduced ? false : { scale: 1.7, rotate: -22, opacity: 0 }}
      animate={{ scale: 1, rotate: -8, opacity: 1 }}
      transition={{ type: 'spring', bounce: 0.38, visualDuration: 0.38 }}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full" fill="none">
        <motion.circle
          cx="32"
          cy="32"
          r="29"
          stroke="currentColor"
          strokeWidth="2"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
        />
        <circle cx="32" cy="32" r="24.5" stroke="currentColor" strokeWidth="0.75" strokeDasharray="1.5 2.5" />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[0.6875rem] font-semibold tracking-wide">Published</span>
        <span className="mt-1 text-[0.625rem] tabular-nums opacity-80">{day}</span>
      </span>
    </motion.div>
  );
}
