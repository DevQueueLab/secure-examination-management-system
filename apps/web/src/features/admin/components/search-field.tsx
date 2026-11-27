'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/** Search box that reports its value after typing pauses. Escape clears it. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  label,
  className,
  delay = 250,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  delay?: number;
}) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const last = useRef(value);

  // Follow external resets (e.g. "Clear filters").
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === last.current) return;
    const t = setTimeout(() => {
      last.current = draft;
      onChangeRef.current(draft);
    }, delay);
    return () => clearTimeout(t);
  }, [draft, delay]);

  return (
    <Input
      type="search"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && draft) {
          e.preventDefault();
          setDraft('');
        }
      }}
      leading={<Search aria-hidden />}
      trailing={
        draft ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setDraft('')}
            className="mr-1 inline-flex size-6 items-center justify-center rounded-full text-label-tertiary transition-colors hover:bg-fill hover:text-label"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : undefined
      }
      containerClassName={cn('w-full', className)}
      className="[&::-webkit-search-cancel-button]:appearance-none"
    />
  );
}
