'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Sculpture twins for empty and error states. Marble shows in light and sepia themes, glass in dark. */
export type EmptyStateArt = 'owl' | 'helmet' | 'amphora' | 'shield' | 'laurel' | 'column' | 'athena' | 'parthenon';

export interface EmptyStateProps {
  /** An icon element, e.g. <Inbox />. Rendered large and calm; also the fallback when `art` has no file yet. */
  icon?: ReactNode;
  /**
   * A sculpture twin instead of the icon: owl (nothing yet), helmet (no exams scheduled), amphora (question bank
   * empty), shield (no access), laurel (published, success), column (not found), athena, parthenon.
   * Decorative and lazy-loaded. A twin whose file is missing (laurel, column and parthenon have no marble yet)
   * shows the icon in that twin's themes, in the same fixed box.
   */
  art?: EmptyStateArt;
  title: ReactNode;
  /** Say what will appear here and how to make it appear. */
  description?: ReactNode;
  /** Primary and secondary actions (Buttons or Links styled as buttons). */
  action?: ReactNode;
  /** Compact for use inside a card or a table body. */
  size?: 'sm' | 'md';
  /** Draws its own surface. Default true; pass false inside an existing surface. */
  surface?: boolean;
  className?: string;
}

type Stage = 'avif' | 'webp' | 'failed';

/**
 * One twin as <picture>: AVIF, then WebP, then nothing. A <picture> does not fall through to the next source
 * on a 404, so each failure steps the chain down in state. Hidden twins (display: none via the theme token)
 * are lazy, so they are never fetched until their theme is shown.
 */
function Twin({ name, material, onFail }: { name: EmptyStateArt; material: 'marble' | 'glass'; onFail: () => void }) {
  const [stage, setStage] = useState<Stage>('avif');
  const ref = useRef<HTMLImageElement>(null);
  const base = `/brand/${name}-${material}-960`;
  const fail = () => {
    if (stage === 'avif') setStage('webp');
    else if (stage === 'webp') {
      setStage('failed');
      onFail();
    }
  };

  // An error can land before hydration, when onError is not attached yet.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  if (stage === 'failed') return null;
  return (
    <picture
      key={stage}
      className="absolute inset-0"
      style={{ display: material === 'marble' ? 'var(--art-marble)' : 'var(--art-glass)' }}
    >
      {stage === 'avif' && <source srcSet={`${base}.avif`} type="image/avif" />}
      <img
        ref={ref}
        src={`${base}.webp`}
        alt=""
        width={768}
        height={960}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={fail}
        className="size-full select-none object-contain [mix-blend-mode:var(--art-blend)]"
      />
    </picture>
  );
}

function Art({ name, size, icon }: { name: EmptyStateArt; size: 'sm' | 'md'; icon?: ReactNode }) {
  const [failed, setFailed] = useState<Record<'marble' | 'glass', boolean>>({ marble: false, glass: false });
  const box = size === 'md' ? 'h-[200px] w-[160px]' : 'h-[110px] w-[88px]';
  const fallback = (material: 'marble' | 'glass') =>
    icon &&
    failed[material] && (
      // Inside the same fixed box, so a missing file never shifts the layout; shown only for that twin's themes.
      <div className="absolute inset-0" style={{ display: material === 'marble' ? 'var(--art-marble)' : 'var(--art-glass)' }}>
        <div className="flex size-full items-center justify-center">
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-fill-secondary text-label-tertiary',
              size === 'md' ? 'size-16 [&_svg]:size-8' : 'size-10 [&_svg]:size-5',
            )}
          >
            {icon}
          </div>
        </div>
      </div>
    );
  return (
    <div aria-hidden className={cn('relative shrink-0', box)}>
      <Twin name={name} material="marble" onFail={() => setFailed((f) => ({ ...f, marble: true }))} />
      <Twin name={name} material="glass" onFail={() => setFailed((f) => ({ ...f, glass: true }))} />
      {fallback('marble')}
      {fallback('glass')}
    </div>
  );
}

/** What a region shows when it has nothing yet. Teaches the next step instead of saying "nothing here". */
export function EmptyState({ icon, art, title, description, action, size = 'md', surface = true, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        surface && 'rounded-xl bg-surface ring-1 ring-separator',
        size === 'md' ? 'gap-3 px-6 py-12 sm:py-14' : 'gap-2 px-4 py-8',
        className,
      )}
    >
      {art ? (
        <Art name={art} size={size} icon={icon} />
      ) : (
        icon && (
          <div
            aria-hidden
            className={cn(
              'flex items-center justify-center rounded-full bg-fill-secondary text-label-tertiary',
              size === 'md' ? 'mb-1 size-14 [&_svg]:size-7' : 'size-10 [&_svg]:size-5',
            )}
          >
            {icon}
          </div>
        )
      )}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3
          className={cn(
            'text-label',
            size === 'md' ? 'font-display text-title-2 font-semibold tracking-[-0.02em]' : 'text-headline',
          )}
        >
          {title}
        </h3>
        {description && <p className="text-callout text-label-secondary">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
