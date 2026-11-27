'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/cn';
import { useIntegrityOverview } from '../api';
import type { CandidateRef, SimilarityPair, SimilarityReport } from '../types';

/**
 * The similarity constellation: every candidate as a star, linked by the pairs the similarity check listed.
 * Edge thickness is the number of uncommon shared wrong answers (a dashed hairline when only the wording overlaps);
 * a carmine ring marks a listed candidate. A small force simulation (repulsion, springs, centring) lays it out
 * on requestAnimationFrame and stops once it settles. Under reduced motion it runs to the end before painting.
 */

// The canvas: wide on a desktop, taller and narrower on a phone so the stars stay legible.
const WIDE = { w: 720, h: 380 };
const NARROW = { w: 400, h: 460 };
type Box = typeof WIDE;
const MAX_NODES = 60;
const MAX_TICKS = 420;
const REST = 96;

interface Node {
  id: string;
  candidate: CandidateRef;
  linked: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

interface Edge {
  pair: SimilarityPair;
  source: number;
  target: number;
  shared: number;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** One step of the simulation. Returns the kinetic energy left, so the loop knows when it has settled. */
function tick(nodes: Node[], edges: Edge[], alpha: number, { w: W, h: H }: Box): number {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (i - j) * 0.5 || 0.5;
        dy = 0.5;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const force = (2600 * alpha) / d2;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  for (const e of edges) {
    const a = nodes[e.source]!;
    const b = nodes[e.target]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    // Stronger links pull closer: more uncommon shared answers, shorter rest length.
    const rest = REST - Math.min(40, e.shared * 8);
    const k = 0.04 * alpha * (d - rest);
    const fx = (dx / d) * k;
    const fy = (dy / d) * k;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }
  let energy = 0;
  for (const node of nodes) {
    // Centring: linked stars gather in the middle, lone ones keep a looser orbit.
    const pull = node.linked ? 0.012 : 0.006;
    node.vx += (W / 2 - node.x) * pull * alpha;
    node.vy += (H / 2 - node.y) * pull * alpha;
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= 0.82;
    node.vy *= 0.82;
    node.x = Math.min(W - 24, Math.max(24, node.x + node.vx));
    node.y = Math.min(H - 24, Math.max(24, node.y + node.vy));
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  return energy;
}

export function SimilarityConstellation({
  examId,
  report,
  selectedId,
  onSelect,
}: {
  examId: string;
  report: SimilarityReport;
  selectedId: string | null;
  onSelect: (pairId: string) => void;
}) {
  const overview = useIntegrityOverview(examId);
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState<{ node?: number; edge?: number } | null>(null);
  const raf = useRef<number | null>(null);
  const drag = useRef<{ index: number; pointerId: number; moved: boolean } | null>(null);

  // Nodes and edges, built once per report: listed candidates first, then the rest of the cohort up to 60.
  const figureRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box>(WIDE);
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBox((entry?.contentRect.width ?? 720) < 560 ? NARROW : WIDE));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { w: W, h: H } = box;

  const graph = useMemo(() => {
    const byId = new Map<string, CandidateRef>();
    const linked = new Set<string>();
    for (const p of report.pairs) {
      byId.set(p.a.attemptId, p.a);
      byId.set(p.b.attemptId, p.b);
      linked.add(p.a.attemptId);
      linked.add(p.b.attemptId);
    }
    for (const a of overview.data?.attempts ?? []) {
      if (byId.size >= MAX_NODES) break;
      if (!byId.has(a.candidate.attemptId)) byId.set(a.candidate.attemptId, a.candidate);
    }
    const ids = [...byId.keys()];
    const index = new Map(ids.map((id, i) => [id, i]));
    const nodes: Node[] = ids.map((id, i) => {
      // A deterministic golden-angle spiral start, so every load settles into the same picture.
      const angle = i * 2.399963;
      const radius = 30 + 9 * Math.sqrt(i) * 6;
      return {
        id,
        candidate: byId.get(id)!,
        linked: linked.has(id),
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius * 0.6,
        vx: 0,
        vy: 0,
        fixed: false,
      };
    });
    const edges: Edge[] = report.pairs.map((pair) => ({
      pair,
      source: index.get(pair.a.attemptId)!,
      target: index.get(pair.b.attemptId)!,
      shared: pair.objective?.sharedWrong.length ?? 0,
    }));
    return { nodes, edges };
  }, [report.pairs, overview.data?.attempts, W, H]);

  const run = useCallback(
    (startAlpha: number) => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      let alpha = startAlpha;
      let ticks = 0;
      const step = () => {
        const energy = tick(graph.nodes, graph.edges, alpha, box);
        alpha = Math.max(0.02, alpha * 0.985);
        ticks++;
        setFrame((f) => f + 1);
        // Stop once settled (or after a bounded number of steps): nothing loops forever.
        if (!drag.current && (energy < 0.02 || ticks > MAX_TICKS)) {
          raf.current = null;
          return;
        }
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [graph, box],
  );

  useEffect(() => {
    if (reduced) {
      // Reduced motion: run the whole simulation now and paint only the settled layout.
      let alpha = 1;
      for (let i = 0; i < MAX_TICKS; i++) {
        if (tick(graph.nodes, graph.edges, alpha, box) < 0.02) break;
        alpha = Math.max(0.02, alpha * 0.985);
      }
      setFrame((f) => f + 1);
      return;
    }
    run(1);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [graph, box, reduced, run]);

  const toSvg = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
  };

  const onPointerDown = (index: number) => (e: ReactPointerEvent<SVGGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-released pointer cannot be captured; dragging still works while it stays over the star.
    }
    drag.current = { index, pointerId: e.pointerId, moved: false };
    graph.nodes[index]!.fixed = true;
    if (!reduced) run(0.6);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toSvg(e);
    const node = graph.nodes[d.index]!;
    if (Math.abs(p.x - node.x) + Math.abs(p.y - node.y) > 2) d.moved = true;
    node.x = Math.min(W - 24, Math.max(24, p.x));
    node.y = Math.min(H - 24, Math.max(24, p.y));
    if (reduced) {
      // No animation: settle the rest of the web around the dragged star at once.
      for (let i = 0; i < 60; i++) tick(graph.nodes, graph.edges, 0.3, box);
      setFrame((f) => f + 1);
    }
  };
  const onPointerUp = (index: number) => (e: ReactPointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    graph.nodes[index]!.fixed = false;
    drag.current = null;
    // A tap (no drag) opens the candidate's strongest listed pair; a cancelled gesture only lets the web settle.
    if (!d.moved && e.type === 'pointerup') {
      const edge = graph.edges.filter((x) => x.source === index || x.target === index).sort((p, q) => q.shared - p.shared)[0];
      if (edge) onSelect(edge.pair.id);
    }
    if (!reduced) run(0.4);
  };

  const { nodes, edges } = graph;
  if (nodes.length < 2) return null;
  const activeNode = hover?.node;
  const activeEdge = hover?.edge;
  const edgeActive = (i: number, e: Edge) =>
    activeEdge === i || (activeNode !== undefined && (e.source === activeNode || e.target === activeNode)) || e.pair.id === selectedId;
  const nodeActive = (i: number) =>
    activeNode === i ||
    (activeEdge !== undefined && (edges[activeEdge]!.source === i || edges[activeEdge]!.target === i)) ||
    edges.some((e) => e.pair.id === selectedId && (e.source === i || e.target === i));
  const dim = hover !== null;

  return (
    <figure ref={figureRef} className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Similarity constellation: ${nodes.length} candidates, ${edges.length} listed ${edges.length === 1 ? 'pair' : 'pairs'}`}
        className="h-auto w-full touch-none select-none"
        onPointerLeave={() => setHover(null)}
      >
        {edges.map((e, i) => {
          const a = nodes[e.source]!;
          const b = nodes[e.target]!;
          const on = edgeActive(i, e);
          return (
            <g key={e.pair.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={e.shared > 0 ? 'var(--data-1)' : 'var(--data-2)'}
                strokeWidth={(e.shared > 0 ? 1.5 + e.shared * 1.5 : 1.25) + (e.pair.id === selectedId ? 1 : 0)}
                strokeDasharray={e.shared > 0 ? undefined : '4 4'}
                strokeLinecap="round"
                opacity={dim && !on ? 0.15 : on ? 1 : 0.7}
                className="transition-opacity duration-150"
              />
              {/* A wide invisible stroke makes the edge easy to hover and click. */}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={16}
                className="cursor-pointer"
                onPointerEnter={() => setHover({ edge: i })}
                onClick={() => onSelect(e.pair.id)}
              >
                <title>
                  {e.pair.a.name} and {e.pair.b.name}
                  {e.shared > 0 ? `: ${e.shared} uncommon shared wrong answers` : ': wording overlap'}
                </title>
              </line>
            </g>
          );
        })}
        {nodes.map((node, i) => {
          const on = nodeActive(i);
          const r = node.linked ? 15 : 5;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              className={cn(node.linked ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
              opacity={dim && !on && !(activeNode === undefined && activeEdge === undefined) ? 0.35 : 1}
              onPointerEnter={() => setHover({ node: i })}
              onPointerDown={node.linked ? onPointerDown(i) : undefined}
              onPointerMove={node.linked ? onPointerMove : undefined}
              onPointerUp={node.linked ? onPointerUp(i) : undefined}
              onPointerCancel={node.linked ? onPointerUp(i) : undefined}
              tabIndex={node.linked ? 0 : undefined}
              role={node.linked ? 'button' : undefined}
              aria-label={node.linked ? `${node.candidate.name}, open their listed pair` : undefined}
              onKeyDown={(e) => {
                if (!node.linked || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                const edge = edges.filter((x) => x.source === i || x.target === i).sort((p, q) => q.shared - p.shared)[0];
                if (edge) onSelect(edge.pair.id);
              }}
              onFocus={() => setHover({ node: i })}
              onBlur={() => setHover(null)}
            >
              <title>{node.candidate.name}</title>
              <circle
                r={r}
                fill={node.linked ? 'var(--surface)' : 'var(--data-5)'}
                stroke={node.linked ? 'var(--data-1)' : 'var(--data-2)'}
                strokeWidth={node.linked ? (on ? 3 : 2) : 1}
              />
              {node.linked && (
                <>
                  <text textAnchor="middle" dy="0.35em" className="fill-label text-[10px] font-semibold" style={{ fontSize: 10 }}>
                    {initials(node.candidate.name)}
                  </text>
                  <text
                    textAnchor="middle"
                    y={r + 14}
                    className="fill-label-secondary"
                    style={{ fontSize: 11, paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3, strokeLinejoin: 'round' }}
                  >
                    {node.candidate.name.split(/\s+/)[0]}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-footnote text-label-secondary">
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="22" height="8">
            <line x1="1" y1="4" x2="21" y2="4" stroke="var(--data-1)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Uncommon shared wrong answers, thicker for more
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="22" height="8">
            <line x1="1" y1="4" x2="21" y2="4" stroke="var(--data-2)" strokeWidth="1.25" strokeDasharray="4 4" />
          </svg>
          Wording overlap only
        </span>
        <span>Drag a star to pull the web; select one to compare the pair.</span>
      </figcaption>
    </figure>
  );
}
