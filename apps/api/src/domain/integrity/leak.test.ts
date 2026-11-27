import { encodeFingerprint, weaveFingerprint } from '@athena/shared';
import { describe as group, expect, it } from 'vitest';
import { cleanText, matchedStems, normalizeCode, normalizeNumber, readMarks, tokenize, traceVariants, type PaperItem } from './leak';

const FALL = (h: number) =>
  `An object is dropped from rest from a height of ${h} m. Ignoring air resistance, how fast is it moving just before it hits the ground? Take $g = 9.8$ m/s².`;
const DERIVATIVE = (a: number) => `Let $f(x) = 3x^2 + 2x$. Evaluate $f'(x)$ at $x = ${a}$.`;
const CAR = (v: number, t: number) => `A car accelerates uniformly from rest to ${v} m/s in ${t} s. What is its acceleration?`;
const FORCE = 'A net force of 10 N acts on a 2 kg mass. Its acceleration is:';
const OPTIONS: Record<string, string> = { o1: '0.2 m/s²', o2: '5 m/s²', o3: '12 m/s²', o4: '20 m/s²' };
const AVL = 'Every AVL tree is also a binary search tree.';

interface Paper {
  id: string;
  h: number;
  a: number;
  v: number;
  t: number;
  order: string[];
  derivative?: boolean;
}

const PAPERS: Paper[] = [
  { id: 'p1', h: 40, a: 0, v: 18, t: 3, order: ['o3', 'o2', 'o4', 'o1'] },
  { id: 'p2', h: 45, a: 5, v: 20, t: 7, order: ['o2', 'o4', 'o1', 'o3'] },
  { id: 'p3', h: 40, a: 2, v: 26, t: 4, order: ['o3', 'o2', 'o4', 'o1'] },
  { id: 'p4', h: 50, a: 5, v: 18, t: 3, order: ['o4', 'o3', 'o2', 'o1'] },
  { id: 'p5', h: 45, a: 3, v: 20, t: 7, order: ['o1', 'o2', 'o3', 'o4'] },
  { id: 'p6', h: 40, a: 0, v: 26, t: 4, order: ['o2', 'o4', 'o1', 'o3'] },
];

function item(paper: string, questionId: string, position: number, type: string, content: Record<string, unknown>, variant: Record<string, unknown> = {}): PaperItem {
  return { attemptId: paper, examId: 'mech', questionId, title: questionId, position, type, content, variant };
}

function papers(list: Paper[] = PAPERS): PaperItem[] {
  return list.flatMap((p) => [
    item(p.id, 'fall', 1, 'numeric', { stem: FALL(p.h) }, { values: { h: p.h } }),
    ...(p.derivative === false ? [] : [item(p.id, 'derivative', 2, 'numeric', { stem: DERIVATIVE(p.a) }, { values: { a: p.a } })]),
    item(p.id, 'car', 3, 'numeric', { stem: CAR(p.v, p.t) }, { values: { v: p.v, t: p.t } }),
    item(p.id, 'force', 4, 'single_choice', { stem: FORCE, options: p.order.map((id) => ({ id, text: OPTIONS[id] })) }, { optionOrder: p.order }),
    item(p.id, 'avl', 5, 'true_false', { stem: AVL }),
  ]);
}

/** Paper p1 as it reads after a screenshot goes through OCR: no LaTeX, superscripts, option letters. */
const OCR_P1 = `Mechanics quiz 3 questions!! dont share
Q1. An object is dropped from rest from a height of 40 m. Ignoring air resistance, how fast is it moving just before it hits the ground? Take g = 9.8 m/s².
Q2. Let f(x) = 3x² + 2x. Evaluate f′(x) at x = 0.
Q3. A car accelerates uniformly from rest to 18 m/s in 3 s. What is its acceleration?
Q4. A net force of 10 N acts on a 2 kg mass. Its acceleration is:
A) 12 m/s²   B) 5 m/s²   C) 20 m/s²   D) 0.2 m/s²`;

group('invisible marks and typed codes', () => {
  it('reads an intact mark woven into a stem', () => {
    expect(readMarks(`Q4: ${weaveFingerprint(FORCE, 'P1CXH5')} anyone?`)).toEqual({ status: 'intact', codes: ['P1CXH5'] });
  });

  it('reports a truncated or altered mark as damaged', () => {
    const mark = encodeFingerprint('P1CXH5');
    expect(readMarks(`${FORCE}${mark.slice(0, -7)}`).status).toBe('damaged');
    const flipped = mark.slice(0, 5) + (mark[5] === '\u200B' ? '\u200C' : '\u200B') + mark.slice(6);
    expect(readMarks(`${FORCE}${flipped}`).status).toBe('damaged');
  });

  it('ignores a checksum-valid mark that does not decode to a paper code', () => {
    expect(readMarks(`${FORCE}${encodeFingerprint('AB\u0000CD')}`)).toEqual({ status: 'damaged', codes: [] });
  });

  it('does not mistake emoji joiners or Persian and Urdu text for a damaged mark', () => {
    expect(readMarks('👨\u200D👩\u200D👧 family pic, paper tomorrow').status).toBe('none');
    expect(readMarks('می\u200Cخواهم paper bhejo').status).toBe('none');
  });

  it('normalizes typed codes and folds look-alike letters', () => {
    expect(normalizeCode(' p1c-xh5 ')).toBe('P1CXH5');
    expect(normalizeCode('nes ep o')).toBe('NESEP0');
    expect(normalizeCode('FQH-OHZ')).toBe('FQH0HZ');
    expect(normalizeCode('abc')).toBeNull();
    expect(normalizeCode('P1CXH5U')).toBeNull();
  });
});

group('reading text', () => {
  it('cleans markup so source and screen text tokenize alike', () => {
    const source = tokenize(cleanText(DERIVATIVE(5))).map((t) => t.value);
    const screen = tokenize(cleanText("Let f(x) = 3x² + 2x. Evaluate f′(x) at x = 5.")).map((t) => t.value);
    expect(screen).toEqual(source);
    expect(normalizeNumber('7.50')).toBe('7.5');
    expect(normalizeNumber('02')).toBe('2');
    expect(normalizeNumber('1,000')).toBe('1000');
    expect(normalizeNumber('0,2')).toBe('0.2');
  });
});

group('variant forensics', () => {
  it('narrows OCR text of one paper down to that paper alone', () => {
    const [trace] = traceVariants(OCR_P1, papers());
    expect(trace!.questions.map((q) => q.questionId)).toEqual(['fall', 'derivative', 'car', 'force']);
    expect(trace!.fitting).toEqual(['p1']);
    expect(trace!.confidence).toBe('strong');
    const byKind = Object.fromEntries(trace!.observations.map((o) => [`${o.questionId}:${o.kind}`, o.fitting.sort()]));
    expect(byKind['fall:numbers']).toEqual(['p1', 'p3', 'p6']);
    expect(byKind['derivative:numbers']).toEqual(['p1', 'p6']);
    expect(byKind['car:numbers']).toEqual(['p1', 'p4']);
    expect(byKind['force:order']).toEqual(['p1', 'p3']);
    expect(trace!.observations.find((o) => o.kind === 'order')!.sequence).toEqual(['12 m/s²', '5 m/s²', '20 m/s²', '0.2 m/s²']);
  });

  it('still requires a value that equals a constant in the stem (a = 2 in 3x² + 2x)', () => {
    const list = PAPERS.slice(0, 3); // a = 0, 5, 2
    const five = traceVariants(DERIVATIVE(5), papers(list))[0]!;
    expect(five.observations.find((o) => o.kind === 'numbers')!.fitting).toEqual(['p2']);
    const two = traceVariants(`Let f(x) = 3x² + 2x. Evaluate f′(x) at x = 2.`, papers(list))[0]!;
    expect(two.observations.find((o) => o.kind === 'numbers')!.fitting).toEqual(['p3']);
  });

  it('names nobody when the text only has a question every paper shared', () => {
    const [trace] = traceVariants(`lol who knows this one: ${AVL} true or false??`, papers());
    expect(trace!.questions.map((q) => q.questionId)).toEqual(['avl']);
    expect(trace!.observations).toEqual([]);
    expect(trace!.fitting).toHaveLength(6);
    expect(trace!.narrowed).toBe(false);
    expect(trace!.confidence).toBe('none');
  });

  it('keeps tied papers as one unordered group', () => {
    const [trace] = traceVariants(`${FORCE}\n12 m/s²\n5 m/s²\n20 m/s²\n0.2 m/s²`, papers());
    expect(trace!.fitting.sort()).toEqual(['p1', 'p3']);
    expect(trace!.confidence).toBe('weak');
  });

  it('excludes papers that did not draw a question the text contains', () => {
    const list = PAPERS.map((p) => (p.id === 'p6' ? { ...p, derivative: false } : p));
    const [trace] = traceVariants(OCR_P1, papers(list));
    const drawn = trace!.observations.find((o) => o.kind === 'drawn')!;
    expect(drawn.questionId).toBe('derivative');
    expect(drawn.fitting).not.toContain('p6');
    expect(trace!.fitting).toEqual(['p1']);
  });

  it('does not rule out papers without the question when the match is loose', () => {
    // p6 never drew the car question. A loose match could be a different question, so it can't exclude p6.
    const items = papers().filter((i) => !(i.attemptId === 'p6' && i.questionId === 'car'));
    const loose = traceVariants('car accelerates from rest to 18 m/s in 3 s, acceleration?', items)[0]!;
    expect(loose.questions.find((q) => q.questionId === 'car')!.coverage).toBeLessThan(0.75);
    expect(loose.observations.map((o) => o.kind)).toEqual(['numbers']);
    expect(loose.fitting.sort()).toEqual(['p1', 'p4', 'p6']);
    const sure = traceVariants(CAR(18, 3), items)[0]!;
    expect(sure.observations.map((o) => o.kind).sort()).toEqual(['drawn', 'numbers']);
    expect(sure.fitting.sort()).toEqual(['p1', 'p4']);
  });

  it('does not see a question whose words appear only out of order', () => {
    // The derivative stem shares "evaluate", 3, x and 2 with "Evaluate ∫₀² 3x² dx" but in a different order.
    const integral = PAPERS.map((p) => item(p.id, 'integral', 6, 'single_choice', { stem: 'Evaluate $\\displaystyle\\int_0^2 3x^2\\,dx$.', options: [] }));
    const traces = traceVariants(`Let f(x) = 3x² + 2x. Evaluate f′(x) at x = 0.`, [...papers(), ...integral]);
    expect(traces[0]!.questions.map((q) => q.questionId)).toEqual(['derivative']);
    const seen = traceVariants('Evaluate ∫₀² 3x² dx.', integral);
    expect(seen[0]!.questions.map((q) => q.questionId)).toEqual(['integral']);
  });

  it('recognises nothing in unrelated chat', () => {
    expect(traceVariants('kal ka paper kesa tha? physics was hard, see you at 5', papers())).toEqual([]);
  });
});

group('matched stems', () => {
  it('lists which of a paper’s questions appear in the text', () => {
    const p1 = papers().filter((i) => i.attemptId === 'p1');
    expect(matchedStems(OCR_P1, p1).map((m) => m.position)).toEqual([1, 2, 3, 4]);
  });
});
