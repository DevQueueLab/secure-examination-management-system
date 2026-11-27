import type { CSSProperties } from 'react';
import type { ResolvedImage } from './brand-assets';

interface Props {
  image: ResolvedImage;
  className?: string;
  imgClassName?: string;
  sizes?: string;
  /** The first screen's picture loads eagerly with high priority; everything else is lazy. */
  priority?: boolean;
  /** Decorative repeats (a twin stacked under its pair) are hidden from assistive technology. */
  decorative?: boolean;
  style?: CSSProperties;
}

/** One brand picture: AVIF and WebP sources when the client's files exist, WebP for the found stand-ins. */
export function BrandPicture({ image, className, imgClassName, sizes = '(max-width: 768px) 90vw, 50vw', priority, decorative, style }: Props) {
  return (
    <picture className={className} style={style}>
      {image.sources.map((s) => (
        <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={sizes} />
      ))}
      <img
        src={image.src}
        width={image.width}
        height={image.height}
        alt={decorative ? '' : image.alt}
        aria-hidden={decorative || undefined}
        className={imgClassName}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}
