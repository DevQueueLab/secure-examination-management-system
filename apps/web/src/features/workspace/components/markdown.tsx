'use client';

import 'katex/dist/katex.min.css';
import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/cn';
import styles from './markdown.module.css';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: Parameters<typeof ReactMarkdown>[0]['rehypePlugins'] = [[rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' }]];

const blockComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};

const inlineComponents: Components = {
  ...blockComponents,
  p: ({ node: _node, ...props }) => <span {...props} />,
};

export interface MarkdownProps {
  children: string;
  /** Options and short labels: no paragraph spacing. */
  inline?: boolean;
  className?: string;
}

/**
 * Markdown with GitHub tables, $math$ and $$display math$$ (KaTeX, with MathML for screen readers).
 * Raw HTML in the source is dropped, never rendered.
 */
export const Markdown = memo(function Markdown({ children, inline = false, className }: MarkdownProps) {
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={cn(styles.prose, inline && styles.inline, className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={inline ? inlineComponents : blockComponents}
        skipHtml
      >
        {children}
      </ReactMarkdown>
    </Wrapper>
  );
});
