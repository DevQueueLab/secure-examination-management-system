'use client';

import { getStroke } from 'perfect-freehand';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import type { ScratchPage } from '../types';

/**
 * Renders a candidate's scratch page for the grader. The workspace stores pages as loose JSON, so this reads
 * the shapes it may contain (pen strokes, a raster snapshot, typed notes) and ignores anything else.
 */

type Point = [number, number, number];
interface Stroke {
  points: Point[];
  color: string;
  size: number;
  erase: boolean;
}

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function readPoint(p: unknown): Point | null {
  if (Array.isArray(p) && p.length >= 2) return [num(p[0]), num(p[1]), num(p[2], 0.5)];
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.y === 'number') return [o.x, o.y, num(o.pressure ?? o.p, 0.5)];
  }
  return null;
}

function readStrokes(data: Record<string, unknown>): Stroke[] {
  const raw = Array.isArray(data.strokes) ? data.strokes : Array.isArray(data.paths) ? data.paths : [];
  const out: Stroke[] = [];
  for (const s of raw.slice(0, 5000)) {
    const obj = (Array.isArray(s) ? { points: s } : s) as Record<string, unknown>;
    const pts = Array.isArray(obj.points) ? (obj.points as unknown[]).map(readPoint).filter((p): p is Point => !!p) : [];
    if (!pts.length) continue;
    const color = typeof obj.color === 'string' && SAFE_COLOR.test(obj.color) ? obj.color : '#1d1d1f';
    out.push({ points: pts, color, size: Math.min(48, Math.max(1, num(obj.size ?? obj.width, 3))), erase: obj.tool === 'eraser' || obj.erase === true });
  }
  return out;
}

/** perfect-freehand outline to an SVG path (quadratic midpoints). */
function pathOf(stroke: Stroke): string {
  const outline = getStroke(stroke.points, { size: stroke.size * 1.6, thinning: 0.55, smoothing: 0.5, streamline: 0.5, simulatePressure: stroke.points.every((p) => p[2] === 0.5) });
  if (!outline.length) return '';
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
      return acc;
    },
    ['M', ...outline[0]!, 'Q'],
  );
  return `${d.join(' ')} Z`;
}

function snapshotOf(data: Record<string, unknown>): string | null {
  for (const key of ['dataUrl', 'image', 'png', 'snapshot']) {
    const v = data[key];
    if (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v)) return v;
  }
  return null;
}

function notesOf(data: Record<string, unknown>): string | null {
  for (const key of ['text', 'content', 'markdown', 'notes']) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

export function ScratchPageView({ page, index, className }: { page: ScratchPage; index: number; className?: string }) {
  const data = page.data ?? {};
  const strokes = useMemo(() => readStrokes(data), [data]);
  const snapshot = snapshotOf(data);
  const notes = notesOf(data);

  const box = useMemo(() => {
    const w = num(data.width);
    const h = num(data.height);
    if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
    if (!strokes.length) return { x: 0, y: 0, w: 800, h: 500 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of strokes)
      for (const [x, y] of s.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    const pad = 24;
    return { x: minX - pad, y: minY - pad, w: Math.max(80, maxX - minX + pad * 2), h: Math.max(60, maxY - minY + pad * 2) };
  }, [data, strokes]);

  const title = `Scratch page ${index + 1}`;
  const empty = !strokes.length && !snapshot && !notes;

  return (
    <figure className={cn('flex flex-col gap-1.5', className)}>
      {empty ? (
        <div className="flex h-24 items-center justify-center rounded-lg bg-fill-secondary text-footnote text-label-tertiary">This page is blank</div>
      ) : page.kind === 'notes' || (!strokes.length && !snapshot && notes) ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-fill-secondary p-3 font-mono text-subheadline text-label">{notes}</pre>
      ) : snapshot && !strokes.length ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL from the candidate's own page
        <img src={snapshot} alt={title} className="max-h-[28rem] w-full rounded-lg bg-white object-contain ring-1 ring-separator" />
      ) : (
        <svg
          role="img"
          aria-label={`${title}: ${strokes.length} pen strokes`}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="max-h-[28rem] w-full rounded-lg bg-white ring-1 ring-separator"
          preserveAspectRatio="xMidYMid meet"
        >
          {strokes.map((s, i) => (
            <path key={i} d={pathOf(s)} fill={s.erase ? '#ffffff' : s.color} />
          ))}
        </svg>
      )}
      <figcaption className="text-footnote text-label-secondary">{title}</figcaption>
    </figure>
  );
}
