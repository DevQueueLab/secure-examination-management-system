'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { WrittenText } from '@/components/ui/written-text';

/**
 * A headline that writes itself once, as it comes up into view. Until then it is plain text, so it reads the same
 * without script, and under reduced motion the shared WrittenText renders it finished.
 */
export function WriteOnView({ text, pen, className }: { text: string; pen?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Starts just before the line enters from below, so the pen is moving as the reader arrives.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setWriting(true);
        io.disconnect();
      },
      { rootMargin: '0px 0px 8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style = pen ? ({ '--written-stroke': pen } as CSSProperties) : undefined;
  if (writing) return <WrittenText text={text} className={className} style={style} />;
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
