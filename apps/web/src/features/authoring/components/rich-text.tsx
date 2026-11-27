'use client';

import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/cn';

/**
 * Question text as candidates will see it: Markdown (GFM) with $inline$ and $$display$$ maths via KaTeX.
 * Raw HTML is not rendered (react-markdown escapes it), so authored text cannot inject markup.
 */
export function RichText({ children, className, inline = false }: { children: string; className?: string; inline?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-0 break-words text-body text-label',
        '[&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold [&_em]:italic',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.9em]',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_a]:text-accent-text [&_a]:underline',
        '[&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1',
        '[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        inline && '[&_p]:inline',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
