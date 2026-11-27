'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Toaster as Sonner, toast } from 'sonner';
import { useTheme } from '@/lib/theme';
import { Spinner } from './spinner';

/**
 * Apple-styled notifications. Use `toast.success('Saved')`, `toast.error(message)`,
 * `toast.promise(p, { loading, success, error })`. Keep copy short and specific.
 */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="top-center"
      gap={8}
      offset={{ top: 16 }}
      mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}
      visibleToasts={4}
      icons={{
        success: <CircleCheck className="size-[18px] text-success" aria-hidden />,
        error: <CircleAlert className="size-[18px] text-danger" aria-hidden />,
        warning: <TriangleAlert className="size-[18px] text-warning" aria-hidden />,
        info: <Info className="size-[18px] text-accent" aria-hidden />,
        loading: <Spinner size={16} label={null} className="text-label-secondary" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            'material group pointer-events-auto flex w-full items-start gap-3 rounded-2xl px-4 py-3 shadow-lg sm:w-[22rem]',
            'text-callout text-label',
          ].join(' '),
          icon: 'mt-px flex size-[18px] shrink-0 items-center justify-center',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'font-semibold leading-5',
          description: 'text-subheadline text-label-secondary',
          actionButton:
            'ml-auto h-7 shrink-0 rounded-md bg-accent px-2.5 text-subheadline font-medium text-on-accent hover:bg-accent-hover',
          cancelButton: 'ml-auto h-7 shrink-0 rounded-md bg-fill px-2.5 text-subheadline font-medium text-label hover:bg-fill-strong',
          closeButton: 'text-label-secondary',
        },
      }}
    />
  );
}

export { toast };
