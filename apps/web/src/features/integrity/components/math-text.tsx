'use client';

import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/cn';

/** Question text and option labels as candidates saw them: Markdown with $maths$. Raw HTML is escaped. */
export function MathText({ children, className, inline = false }: { children: string; className?: string; inline?: boolean }) {
  return (
    <span
      className={cn(
        'min-w-0 break-words [&_p]:my-0 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_code]:text-[0.9em]',
        inline ? '[&_p]:inline' : 'block [&_p+p]:mt-2',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        components={inline ? { p: ({ children: inner }) => <span>{inner}</span> } : undefined}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
