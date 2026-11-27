/**
 * The landing page's live demonstration: four candidates' papers drawn from one pool,
 * by the same rules as the server's paper selection (apps/api/src/domain/paper/select.ts):
 *
 *   p = (10 · prior + n · observedP) / (10 + n), priors easy .8, medium .6, hard .4
 *   expected marks = marks · p
 *   draw 4 of 8; balanced mode draws stratified by label, then swaps within the pool until the
 *   paper's expected score is within 2% of the total marks from the pool target.
 *
 * Pure and seeded, so the server can deal the first hand and the browser deals the same one.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type DrawMode = 'balanced' | 'chance';

export interface PoolQuestion {
  id: string;
  title: string;
  difficulty: Difficulty;
  marks: number;
  /** Real attempts so far and the share of marks earned on them (sample figures for the demonstration). */
  observedN: number;
  observedP: number;
}

export const PRIOR: Record<Difficulty, number> = { easy: 0.8, medium: 0.6, hard: 0.4 };
export const PRIOR_WEIGHT = 10;
export const DRAW_COUNT = 4;
export const TOLERANCE_PERCENT = 2;
export const CANDIDATES = ['FA24-BCS-007', 'FA24-BCS-012', 'FA24-BCS-019', 'FA24-BCS-023'] as const;

export const POOL: PoolQuestion[] = [
  { id: 'bsearch', title: 'Binary search on a sorted array', difficulty: 'easy', marks: 5, observedN: 64, observedP: 0.88 },
  { id: 'bfs', title: 'BFS shortest path', difficulty: 'medium', marks: 5, observedN: 64, observedP: 0.57 },
  { id: 'heap', title: 'Heap parent index', difficulty: 'easy', marks: 5, observedN: 64, observedP: 0.71 },
  { id: 'hash', title: 'Hash table average lookup', difficulty: 'easy', marks: 5, observedN: 64, observedP: 0.79 },
  { id: 'avl', title: 'AVL height balance', difficulty: 'medium', marks: 5, observedN: 64, observedP: 0.49 },
  { id: 'stack', title: 'Stack LIFO order', difficulty: 'easy', marks: 5, observedN: 64, observedP: 0.94 },
  { id: 'rbtree', title: 'Red-black tree height bound', difficulty: 'hard', marks: 5, observedN: 64, observedP: 0.36 },
  { id: 'trie', title: 'Trie prefix search', difficulty: 'medium', marks: 5, observedN: 12, observedP: 0.7 },
];

export function estimateP(q: PoolQuestion): number {
  return (PRIOR_WEIGHT * PRIOR[q.difficulty] + q.observedN * q.observedP) / (PRIOR_WEIGHT + q.observedN);
}

export const expectedMarks = (q: PoolQuestion) => q.marks * estimateP(q);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** mulberry32: small, fast, good enough for dealing papers. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T,>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  return { next, shuffle, pick };
}
type Rng = ReturnType<typeof createRng>;

const LABELS: Difficulty[] = ['easy', 'medium', 'hard'];

/** Each label receives its proportional share of the draw (largest remainder, ties broken by the seed). */
function stratifiedDraw(pool: PoolQuestion[], k: number, rng: Rng): PoolQuestion[] {
  const strata = LABELS.map((d) => pool.filter((q) => q.difficulty === d)).filter((s) => s.length > 0);
  const exact = strata.map((s) => (k * s.length) / pool.length);
  const quota = exact.map((x) => Math.floor(x + 1e-9));
  let remaining = k - sum(quota);
  const order = strata
    .map((_, i) => ({ i, rem: exact[i]! - quota[i]!, tie: rng.next() }))
    .sort((a, b) => b.rem - a.rem || a.tie - b.tie);
  for (const { i } of order) {
    if (remaining <= 0) break;
    if (quota[i]! < strata[i]!.length) {
      quota[i]!++;
      remaining--;
    }
  }
  return strata.flatMap((s, i) => rng.shuffle(s).slice(0, quota[i]));
}

export interface Paper {
  candidate: string;
  questions: PoolQuestion[];
  totalMarks: number;
  expected: number;
  swaps: number;
  withinTolerance: boolean;
  /** Another candidate in this deal who drew the same four questions (in a different order), if any. */
  sameAs: string | null;
}

export interface Deal {
  seed: number;
  mode: DrawMode;
  target: number;
  tolerance: number;
  papers: Paper[];
  /** Expected score of the easiest paper minus the hardest. */
  spread: number;
}

/** Pool target: the expected score of a purely random paper. */
export const poolTarget = () => (DRAW_COUNT * sum(POOL.map(expectedMarks))) / POOL.length;

function drawPaper(candidate: string, mode: DrawMode, rng: Rng): Paper {
  let chosen = mode === 'balanced' ? stratifiedDraw(POOL, DRAW_COUNT, rng) : rng.shuffle(POOL).slice(0, DRAW_COUNT);
  let rest = POOL.filter((q) => !chosen.includes(q));
  const totalMarks = sum(chosen.map((q) => q.marks));
  const target = poolTarget();
  const tolerance = (TOLERANCE_PERCENT / 100) * totalMarks;
  let expected = sum(chosen.map(expectedMarks));
  let swaps = 0;
  if (mode === 'balanced') {
    while (swaps < 200 && Math.abs(expected - target) > tolerance + 1e-9) {
      const gap = Math.abs(expected - target);
      const options: { out: number; in: number; next: number; sameLabel: boolean }[] = [];
      chosen.forEach((o, oi) =>
        rest.forEach((n, ni) => {
          if (n.marks !== o.marks) return;
          const next = expected - expectedMarks(o) + expectedMarks(n);
          if (Math.abs(next - target) < gap - 1e-9) options.push({ out: oi, in: ni, next, sameLabel: n.difficulty === o.difficulty });
        }),
      );
      if (options.length === 0) break;
      const finishing = options.filter((s) => Math.abs(s.next - target) <= tolerance + 1e-9);
      const tier = finishing.length > 0 ? finishing : options;
      const keepsLabel = tier.filter((s) => s.sameLabel);
      const swap = rng.pick(keepsLabel.length > 0 ? keepsLabel : tier);
      const removed = chosen[swap.out]!;
      chosen = chosen.map((q, i) => (i === swap.out ? rest[swap.in]! : q));
      rest = rest.map((q, i) => (i === swap.in ? removed : q));
      expected = swap.next;
      swaps++;
    }
  }
  // Questions are shuffled per candidate, as the exam's default shuffleQuestions setting does.
  const ordered = rng.shuffle(chosen);
  return { candidate, questions: ordered, totalMarks, expected, swaps, withinTolerance: Math.abs(expected - target) <= tolerance + 1e-9, sameAs: null };
}

export function dealPapers(seed: number, mode: DrawMode): Deal {
  const rng = createRng(seed);
  const papers = CANDIDATES.map((c) => drawPaper(c, mode, rng));
  const key = (p: Paper) => p.questions.map((q) => q.id).sort().join(',');
  papers.forEach((p, i) => {
    const twin = papers.slice(0, i).find((o) => key(o) === key(p));
    p.sameAs = twin ? twin.candidate : null;
  });
  const scores = papers.map((p) => p.expected);
  const total = papers[0]?.totalMarks ?? 20;
  return {
    seed,
    mode,
    target: poolTarget(),
    tolerance: (TOLERANCE_PERCENT / 100) * total,
    papers,
    spread: Math.max(...scores) - Math.min(...scores),
  };
}

/** One decimal, with a real minus sign never needed (scores are positive). */
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const fmtP = (n: number) => n.toFixed(2).replace(/^0/, '');
