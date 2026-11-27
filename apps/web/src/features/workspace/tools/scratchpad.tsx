'use client';

import { Eraser, Highlighter, Paperclip, PenLine, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { getStroke } from 'perfect-freehand';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { workingEnabled } from '../lib/answers';
import { useEngine, useEngineSelector } from '../lib/use-engine';
import { GENERAL_PAGE, pageHasContent, questionPage, usePageLabel } from '../components/working';

/** Strokes live in page units: 1000 wide, so a page drawn on a phone looks the same on a laptop. */
const PAGE_W = 1000;
const PAGE_H = 1400;
const MAX_POINTS = 12_000;

type Tool = 'pen' | 'highlighter' | 'eraser';
type Ink = 'ink' | 'blue' | 'red' | 'green';

interface Stroke {
  tool: 'pen' | 'highlighter';
  color: Ink;
  size: number;
  /** Flat [x, y, pressure, x, y, pressure, …] in page units. */
  points: number[];
}

interface CanvasData {
  v: 1;
  strokes: Stroke[];
}

const INKS: { value: Ink; label: string; css: string }[] = [
  { value: 'ink', label: 'Ink', css: 'var(--label)' },
  { value: 'blue', label: 'Blue', css: 'var(--info)' },
  { value: 'red', label: 'Red', css: 'var(--danger)' },
  { value: 'green', label: 'Green', css: 'var(--success)' },
];

function readCanvas(data: Record<string, unknown> | undefined): Stroke[] {
  const strokes = (data as Partial<CanvasData> | undefined)?.strokes;
  if (!Array.isArray(strokes)) return [];
  return strokes.filter(
    (s): s is Stroke => !!s && typeof s === 'object' && Array.isArray((s as Stroke).points) && ((s as Stroke).tool === 'pen' || (s as Stroke).tool === 'highlighter'),
  );
}

function pathFromOutline(outline: number[][]): Path2D | null {
  if (outline.length < 2) return null;
  const path = new Path2D();
  const [first, ...rest] = outline;
  path.moveTo(first![0]!, first![1]!);
  for (let i = 0; i < rest.length; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = rest[i]!;
    path.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
  }
  path.closePath();
  return path;
}

function strokeOutline(s: Stroke, complete: boolean): number[][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 2 < s.points.length; i += 3) pts.push([s.points[i]!, s.points[i + 1]!, s.points[i + 2] ?? 0.5]);
  const pressured = pts.some((p) => p[2] !== 0.5);
  return getStroke(pts, {
    size: s.size,
    thinning: s.tool === 'highlighter' ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !pressured && s.tool === 'pen',
    last: complete,
    start: { cap: true },
    end: { cap: true },
  });
}

function resolveColor(el: HTMLElement, ink: Ink): string {
  const css = INKS.find((i) => i.value === ink)?.css ?? 'var(--label)';
  const name = css.slice(4, -1);
  return getComputedStyle(el).getPropertyValue(name).trim() || '#1d1d1f';
}

function DrawingPage({ pageKey, disabled }: { pageKey: string; disabled: boolean }) {
  const engine = useEngine();
  const confirm = useConfirm();
  const stored = useEngineSelector((s) => s.scratchpads[pageKey]);
  const [strokes, setStrokesState] = useState<Stroke[]>(() => readCanvas(stored?.data));
  const strokesRef = useRef(strokes);
  const setStrokes = useCallback((next: Stroke[]) => {
    strokesRef.current = next;
    setStrokesState(next);
  }, []);
  const [undo, setUndo] = useState<Stroke[][]>([]);
  const [redo, setRedo] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [ink, setInk] = useState<Ink>('ink');
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  const erasing = useRef<{ before: Stroke[]; changed: boolean } | null>(null);
  const [width, setWidth] = useState(0);

  // Another page, or the server's copy after a reload.
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (lastKey.current !== pageKey) {
      lastKey.current = pageKey;
      setStrokes(readCanvas(stored?.data));
      setUndo([]);
      setRedo([]);
    }
  }, [pageKey, stored, setStrokes]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = width / PAGE_W;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = PAGE_H * scale;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    const all = live.current ? [...strokes, live.current] : strokes;
    for (const s of all) {
      const path = pathFromOutline(strokeOutline(s, s !== live.current));
      if (!path) continue;
      ctx.globalAlpha = s.tool === 'highlighter' ? 0.32 : 1;
      ctx.fillStyle = resolveColor(canvas, s.tool === 'highlighter' && s.color === 'ink' ? 'blue' : s.color);
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
  }, [strokes, width, scale]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Repaint when the theme changes the ink colours.
  useEffect(() => {
    const mo = new MutationObserver(() => draw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => mo.disconnect();
  }, [draw]);

  const commit = (next: Stroke[], before: Stroke[]) => {
    setUndo((u) => [...u.slice(-49), before]);
    setRedo([]);
    setStrokes(next);
    engine.setScratchpad(pageKey, 'canvas', { v: 1, strokes: next } satisfies CanvasData);
  };

  const toPage = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(((e.clientX - rect.left) / rect.width) * PAGE_W * 10) / 10, y: Math.round(((e.clientY - rect.top) / rect.height) * PAGE_H * 10) / 10 };
  };

  const eraseAt = (x: number, y: number) => {
    const radius = 14;
    const current = erasing.current;
    if (!current) return;
    const list = strokesRef.current;
    const kept = list.filter((s) => {
      for (let i = 0; i < s.points.length; i += 3) {
        const dx = s.points[i]! - x;
        const dy = s.points[i + 1]! - y;
        if (dx * dx + dy * dy < (radius + s.size / 2) ** 2) return false;
      }
      return true;
    });
    if (kept.length !== list.length) {
      current.changed = true;
      setStrokes(kept);
    }
  };

  const totalPoints = useMemo(() => strokes.reduce((n, s) => n + s.points.length / 3, 0), [strokes]);
  const full = totalPoints >= MAX_POINTS;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toPage(e);
    if (tool === 'eraser') {
      erasing.current = { before: strokesRef.current, changed: false };
      eraseAt(x, y);
      return;
    }
    if (full) {
      toast.info('This page is full. Clear it or use another page.');
      return;
    }
    const pressure = e.pointerType === 'pen' ? Math.round((e.pressure || 0.5) * 100) / 100 : 0.5;
    live.current = { tool, color: ink, size: tool === 'highlighter' ? 26 : 5, points: [x, y, pressure] };
    draw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'eraser' && erasing.current) {
      const { x, y } = toPage(e);
      eraseAt(x, y);
      return;
    }
    const s = live.current;
    if (!s) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * PAGE_W * 10) / 10;
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * PAGE_H * 10) / 10;
      const n = s.points.length;
      const dx = x - s.points[n - 3]!;
      const dy = y - s.points[n - 2]!;
      if (dx * dx + dy * dy < 2.25) continue;
      const pressure = ev.pointerType === 'pen' ? Math.round((ev.pressure || 0.5) * 100) / 100 : 0.5;
      s.points.push(x, y, pressure);
    }
    draw();
  };

  const onPointerUp = () => {
    if (erasing.current) {
      const { before, changed } = erasing.current;
      erasing.current = null;
      if (changed) {
        setUndo((u) => [...u.slice(-49), before]);
        setRedo([]);
        engine.setScratchpad(pageKey, 'canvas', { v: 1, strokes: strokesRef.current } satisfies CanvasData);
      }
      return;
    }
    const s = live.current;
    live.current = null;
    if (!s) return;
    commit([...strokes, s], strokes);
  };

  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo((u) => u.slice(0, -1));
    setRedo((r) => [...r, strokes]);
    setStrokes(prev);
    engine.setScratchpad(pageKey, 'canvas', { v: 1, strokes: prev } satisfies CanvasData);
  };

  const doRedo = () => {
    const next = redo[redo.length - 1];
    if (!next) return;
    setRedo((r) => r.slice(0, -1));
    setUndo((u) => [...u, strokes]);
    setStrokes(next);
    engine.setScratchpad(pageKey, 'canvas', { v: 1, strokes: next } satisfies CanvasData);
  };

  const clear = async () => {
    if (!strokes.length) return;
    const ok = await confirm({ title: 'Clear this page?', description: 'You can undo this while the scratchpad stays open.', confirmLabel: 'Clear page', destructive: true });
    if (ok) commit([], strokes);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" role="toolbar" aria-label="Drawing tools">
        <SegmentedControl
          size="sm"
          aria-label="Tool"
          value={tool}
          onValueChange={setTool}
          options={[
            { value: 'pen', label: <PenLine aria-label="Pen" className="size-4" /> },
            { value: 'highlighter', label: <Highlighter aria-label="Highlighter" className="size-4" /> },
            { value: 'eraser', label: <Eraser aria-label="Eraser" className="size-4" /> },
          ]}
        />
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
          {INKS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={ink === c.value}
              aria-label={c.label}
              onClick={() => {
                setInk(c.value);
                if (tool === 'eraser') setTool('pen');
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-full outline-none focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-1 focus-visible:outline-focus',
                ink === c.value && 'ring-2 ring-accent',
              )}
            >
              <span aria-hidden className="size-4.5 rounded-full" style={{ background: c.css }} />
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Undo">
            <Button variant="ghost" size="icon" onClick={doUndo} disabled={!undo.length} aria-label="Undo">
              <Undo2 aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Redo">
            <Button variant="ghost" size="icon" onClick={doRedo} disabled={!redo.length} aria-label="Redo">
              <Redo2 aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Clear page">
            <Button variant="ghost" size="icon" onClick={() => void clear()} disabled={!strokes.length} aria-label="Clear page">
              <Trash2 aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface" data-vaul-no-drag>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={strokes.length ? `Drawing with ${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'}` : 'Empty drawing page'}
          style={{
            width: '100%',
            height: width ? PAGE_H * scale : 0,
            touchAction: 'none',
            cursor: tool === 'eraser' ? 'cell' : 'crosshair',
            backgroundImage: 'radial-gradient(circle, var(--separator-strong) 1px, transparent 1.2px)',
            backgroundSize: `${Math.max(12, 28 * scale)}px ${Math.max(12, 28 * scale)}px`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-vaul-no-drag
        />
      </div>
      {full && <p className="border-t px-3 py-2 text-footnote text-warning-text">This page is full. Clear it, or switch to another page.</p>}
    </div>
  );
}

function NotesPage({ pageKey, disabled }: { pageKey: string; disabled: boolean }) {
  const engine = useEngine();
  const key = `n:${pageKey}`.slice(0, 64);
  const stored = useEngineSelector((s) => s.scratchpads[key]);
  const text = typeof stored?.data.text === 'string' ? stored.data.text : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <Textarea
        value={text}
        disabled={disabled}
        autoGrow={false}
        maxLength={20_000}
        onChange={(e) => engine.setScratchpad(key, 'notes', { text: e.target.value })}
        placeholder="Notes only you can see, unless you attach this page to your working."
        aria-label="Notes"
        className="min-h-0 flex-1 resize-none bg-surface"
      />
    </div>
  );
}

/** Pen, highlighter and eraser on pages that save like answers, plus a notes page. */
export function ScratchpadPanel({ pageKey, onPageChange, onClose }: { pageKey: string; onPageChange: (key: string) => void; onClose: () => void }) {
  const engine = useEngine();
  const items = useEngineSelector((s) => s.items);
  const current = useEngineSelector((s) => s.current);
  const scratchpads = useEngineSelector((s) => s.scratchpads);
  const record = useEngineSelector((s) => (s.items[s.current] ? s.answers[s.items[s.current]!.id] : undefined));
  const ready = useEngineSelector((s) => s.phase === 'ready');
  const pageLabel = usePageLabel();
  const [mode, setMode] = useState<'draw' | 'notes'>('draw');

  const item = items[current];
  const options = useMemo(() => {
    const keys = [GENERAL_PAGE, ...(item ? [questionPage(item.id)] : []), ...Object.keys(scratchpads).filter((k) => !k.startsWith('n:'))];
    if (!keys.includes(pageKey)) keys.push(pageKey);
    return keys.filter((k, i) => keys.indexOf(k) === i).map((k) => ({ value: k, label: pageLabel(k) }));
  }, [item, pageKey, pageLabel, scratchpads]);

  const working = item ? workingEnabled(item) : null;
  const attached = record?.working?.scratchPages ?? [];
  const isAttached = attached.includes(pageKey);
  const canAttach = !!item && !!working?.enabled && ready && engine.canEdit(item.id) && pageHasContent(scratchpads[pageKey]) && !isAttached && attached.length < 10;

  const attach = () => {
    if (!item || !canAttach) return;
    engine.setAnswer(item.id, { working: { text: record?.working?.text ?? '', scratchPages: [...attached, pageKey] } });
    toast.success(`Attached to question ${current + 1}`, { description: 'It’s part of your working now.' });
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <p className="text-headline text-label">Scratchpad</p>
        <div className="min-w-0 flex-1">
          <Select aria-label="Page" size="sm" value={pageKey} onValueChange={onPageChange} options={options} className="w-full max-w-52" />
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close scratchpad">
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <SegmentedControl
          size="sm"
          aria-label="Page type"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'draw', label: 'Draw' },
            { value: 'notes', label: 'Notes' },
          ]}
        />
        {working?.enabled && (
          <Button variant={isAttached ? 'gray' : 'tinted'} size="sm" className="ml-auto" onClick={attach} disabled={!canAttach}>
            <Paperclip aria-hidden />
            {isAttached ? `Attached to Q${current + 1}` : `Attach to Q${current + 1} working`}
          </Button>
        )}
      </div>
      {mode === 'draw' ? <DrawingPage key={pageKey} pageKey={pageKey} disabled={!ready} /> : <NotesPage pageKey={pageKey} disabled={!ready} />}
    </div>
  );
}
