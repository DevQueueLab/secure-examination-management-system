'use client';

import { Delete, GripHorizontal, X } from 'lucide-react';
import { motion, useDragControls } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent, useIsMobile } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { CalcError, evaluate, formatResult, type AngleMode } from './calc';

interface HistoryEntry {
  expr: string;
  result: string;
  value: number;
}

const KEYS: { label: string; insert?: string; action?: 'clear' | 'back' | 'equals'; kind?: 'fn' | 'op' | 'num' | 'eq'; aria?: string }[][] = [
  [
    { label: 'sin', insert: 'sin(', kind: 'fn' },
    { label: 'cos', insert: 'cos(', kind: 'fn' },
    { label: 'tan', insert: 'tan(', kind: 'fn' },
    { label: 'π', insert: 'π', kind: 'fn', aria: 'pi' },
    { label: 'e', insert: 'e', kind: 'fn', aria: 'Euler’s number' },
  ],
  [
    { label: 'ln', insert: 'ln(', kind: 'fn' },
    { label: 'log', insert: 'log(', kind: 'fn', aria: 'log base 10' },
    { label: '√', insert: '√(', kind: 'fn', aria: 'square root' },
    { label: 'xʸ', insert: '^', kind: 'fn', aria: 'power' },
    { label: '( )', insert: '()', kind: 'fn', aria: 'parentheses' },
  ],
  [
    { label: '7', insert: '7', kind: 'num' },
    { label: '8', insert: '8', kind: 'num' },
    { label: '9', insert: '9', kind: 'num' },
    { label: '÷', insert: '÷', kind: 'op', aria: 'divide' },
    { label: 'C', action: 'clear', kind: 'op', aria: 'clear' },
  ],
  [
    { label: '4', insert: '4', kind: 'num' },
    { label: '5', insert: '5', kind: 'num' },
    { label: '6', insert: '6', kind: 'num' },
    { label: '×', insert: '×', kind: 'op', aria: 'multiply' },
    { label: '⌫', action: 'back', kind: 'op', aria: 'delete' },
  ],
  [
    { label: '1', insert: '1', kind: 'num' },
    { label: '2', insert: '2', kind: 'num' },
    { label: '3', insert: '3', kind: 'num' },
    { label: '−', insert: '−', kind: 'op', aria: 'minus' },
    { label: 'Ans', insert: 'Ans', kind: 'fn', aria: 'last answer' },
  ],
  [
    { label: '0', insert: '0', kind: 'num' },
    { label: '.', insert: '.', kind: 'num', aria: 'point' },
    { label: '%', insert: '%', kind: 'op', aria: 'percent' },
    { label: '+', insert: '+', kind: 'op', aria: 'plus' },
    { label: '=', action: 'equals', kind: 'eq', aria: 'equals' },
  ],
];

function CalculatorBody({ onClose, dragHandle }: { onClose: () => void; dragHandle?: (e: ReactPointerEvent) => void }) {
  const [expr, setExpr] = useState('');
  const [angle, setAngle] = useState<AngleMode>('deg');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ans = history[0]?.value ?? 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const preview = (() => {
    if (!expr.trim()) return null;
    try {
      return formatResult(evaluate(expr, { angle, ans }));
    } catch {
      return null;
    }
  })();

  function insert(text: string) {
    const el = inputRef.current;
    const startsWithOperator = /^[+×÷^%−*/]/.test(text);
    let base = expr;
    let start = el?.selectionStart ?? expr.length;
    let end = el?.selectionEnd ?? expr.length;
    if (justEvaluated) {
      // After a result: an operator continues from it, anything else starts afresh.
      base = startsWithOperator ? 'Ans' : '';
      start = end = base.length;
    }
    const next = base.slice(0, start) + text + base.slice(end);
    const caret = start + (text === '()' ? 1 : text.length);
    setExpr(next);
    setError(null);
    setJustEvaluated(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  function equals() {
    if (!expr.trim()) return;
    try {
      const value = evaluate(expr, { angle, ans });
      const result = formatResult(value);
      setHistory((h) => [{ expr, result, value }, ...h].slice(0, 20));
      setExpr(result.replace('−', '-'));
      setError(null);
      setJustEvaluated(true);
    } catch (e) {
      setError(e instanceof CalcError ? e.message : 'Check the calculation');
    }
  }

  function press(key: (typeof KEYS)[number][number]) {
    if (key.action === 'clear') {
      setExpr('');
      setError(null);
      setJustEvaluated(false);
      inputRef.current?.focus();
    } else if (key.action === 'back') {
      setExpr((v) => v.slice(0, -1));
      setJustEvaluated(false);
      inputRef.current?.focus();
    } else if (key.action === 'equals') equals();
    else if (key.insert) insert(key.insert);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {dragHandle ? (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onPointerDown={dragHandle}
            className="flex h-8 flex-1 cursor-grab touch-none items-center gap-2 text-headline text-label active:cursor-grabbing"
          >
            <GripHorizontal className="size-4 text-label-tertiary" />
            Calculator
          </button>
        ) : (
          <p className="flex-1 text-headline text-label">Calculator</p>
        )}
        <SegmentedControl
          size="sm"
          aria-label="Angle unit"
          value={angle}
          onValueChange={setAngle}
          options={[
            { value: 'deg', label: 'Deg' },
            { value: 'rad', label: 'Rad' },
          ]}
        />
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close calculator" className="max-md:size-11">
          <X aria-hidden />
        </Button>
      </div>

      {history.length > 0 && (
        <ol aria-label="History" className="flex max-h-20 flex-col gap-0.5 overflow-y-auto">
          {history.slice(0, 6).map((h, i) => (
            <li key={`${h.expr}-${i}`}>
              <button
                type="button"
                onClick={() => insert(h.result.replace('−', '-'))}
                className="flex w-full items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5 text-right text-footnote text-label-secondary hover:bg-fill-secondary"
                aria-label={`${h.expr} equals ${h.result}. Insert the result`}
              >
                <span className="truncate font-mono">{h.expr}</span>
                <span className="shrink-0 font-mono text-label" data-numeric>
                  = {h.result}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="rounded-xl bg-surface-sunken px-3 py-2.5 ring-1 ring-separator focus-within:ring-2 focus-within:ring-accent">
        <input
          ref={inputRef}
          value={expr}
          onChange={(e) => {
            setExpr(e.target.value);
            setError(null);
            setJustEvaluated(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === '=') {
              e.preventDefault();
              equals();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (expr) setExpr('');
              else onClose();
            } else if (justEvaluated && e.key.length === 1 && !/[+\-*/^%×÷]/.test(e.key)) {
              setExpr('');
              setJustEvaluated(false);
            } else if (justEvaluated && /[+\-*/^%]/.test(e.key)) {
              e.preventDefault();
              insert(e.key);
            }
          }}
          inputMode="none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Calculation"
          aria-describedby="calc-result"
          className="w-full bg-transparent text-right font-mono text-title-3 text-label outline-none placeholder:text-placeholder"
          placeholder="0"
        />
        <p id="calc-result" aria-live="polite" className={cn('min-h-5 text-right font-mono text-subheadline', error ? 'text-danger-text' : 'text-label-secondary')} data-numeric>
          {error ?? (preview && !justEvaluated ? `= ${preview}` : '')}
        </p>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {KEYS.flat().map((key) => (
          <button
            key={key.label}
            type="button"
            onClick={() => press(key)}
            aria-label={key.aria}
            className={cn(
              'flex h-11 items-center justify-center rounded-[10px] text-callout font-medium transition-[background-color,transform] duration-100 active:scale-95',
              'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus',
              key.kind === 'num' && 'bg-fill text-label hover:bg-fill-strong',
              key.kind === 'fn' && 'bg-fill-secondary text-label-secondary hover:bg-fill hover:text-label',
              key.kind === 'op' && 'bg-accent-tint text-accent-text hover:bg-accent/15',
              key.kind === 'eq' && 'bg-accent text-on-accent hover:bg-accent-hover',
            )}
          >
            {key.label === '⌫' ? <Delete aria-hidden className="size-[18px]" /> : key.label}
          </button>
        ))}
      </div>
      <p className="text-caption text-label-tertiary">Type or tap. Enter shows the result; Esc clears, then closes.</p>
    </div>
  );
}

/** A scientific calculator that floats over the paper (a sheet on phones), so the question stays in view. */
export function CalculatorPanel({ onClose }: { onClose: () => void }) {
  const mobile = useIsMobile();
  const controls = useDragControls();
  const constraints = useRef<HTMLDivElement>(null);

  if (mobile) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()} side="bottom">
        <SheetContent title="Calculator" hideHeader>
          <CalculatorBody onClose={onClose} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div ref={constraints} className="pointer-events-none fixed inset-x-4 bottom-4 top-20 z-40">
      <motion.section
        aria-label="Calculator"
        role="dialog"
        aria-modal={false}
        drag
        dragControls={controls}
        dragListener={false}
        dragMomentum={false}
        dragConstraints={constraints}
        dragElastic={0.08}
        className="pointer-events-auto absolute bottom-0 right-0 w-[19.5rem] rounded-2xl bg-surface-raised p-4 shadow-xl ring-1 ring-separator"
      >
        <CalculatorBody onClose={onClose} dragHandle={(e) => controls.start(e)} />
      </motion.section>
    </div>
  );
}
