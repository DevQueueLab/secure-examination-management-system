'use client';

import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/cn';

/**
 * Question stems as candidates saw them: Markdown with $maths$ (KaTeX). Raw HTML is escaped by react-markdown,
 * so authored text cannot inject markup.
 */
export function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 break-words text-body text-label',
        '[&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold [&_em]:italic',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_code]:text-[0.9em]',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
