import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to know the custom type scale, otherwise `text-title-1` is read as a colour
 * and silently dropped when it meets `text-label-secondary`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'large-title',
        'title-1',
        'title-2',
        'title-3',
        'headline',
        'body',
        'callout',
        'subheadline',
        'footnote',
        'caption',
      ],
      blur: ['material'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
