/**
 * A small, safe expression evaluator for the exam calculator: a tokenizer and a recursive-descent parser.
 * No eval, no Function, no property access: only numbers, the operators below, and a fixed set of functions.
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary | implicit-multiply)*
 *   unary   := ('+' | '-') unary | power
 *   power   := postfix ('^' unary)?            (right associative, binds tighter than unary minus on its left)
 *   postfix := primary ('!' | '%')*
 *   primary := number | constant | func '(' expr ')' | '(' expr ')' | '√' unary
 */

export type AngleMode = 'deg' | 'rad';

type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' | '!' | '%' }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'id'; v: string }
  | { t: 'sqrt' };

export class CalcError extends Error {}

const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'sqrt', 'abs', 'exp']);
const CONSTS = new Set(['pi', 'π', 'e', 'ans']);

function tokenize(src: string): Token[] {
  const s = src
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^');
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new CalcError('Check the number');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if ('+-*/^!%'.includes(c)) {
      out.push({ t: 'op', v: c as '+' });
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rp' });
      i++;
      continue;
    }
    if (c === '√') {
      out.push({ t: 'sqrt' });
      i++;
      continue;
    }
    if (c === 'π') {
      out.push({ t: 'id', v: 'pi' });
      i++;
      continue;
    }
    const m = /^[a-z]+/i.exec(s.slice(i));
    if (m) {
      const word = m[0].toLowerCase();
      if (!FUNCS.has(word) && !CONSTS.has(word)) throw new CalcError(`Unknown “${m[0]}”`);
      out.push({ t: 'id', v: word });
      i += m[0].length;
      continue;
    }
    throw new CalcError(`Unexpected “${c}”`);
  }
  return out;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorial needs a whole number');
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

export function evaluate(src: string, opts: { angle: AngleMode; ans: number }): number {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new CalcError('Enter a calculation');
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const toRad = (x: number) => (opts.angle === 'deg' ? (x * Math.PI) / 180 : x);
  const fromRad = (x: number) => (opts.angle === 'deg' ? (x * 180) / Math.PI : x);
  // Trig of whole multiples of 180° should give exact zeros, not 1.2e-16.
  const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);

  function startsPrimary(tok: Token | undefined): boolean {
    return !!tok && (tok.t === 'num' || tok.t === 'lp' || tok.t === 'id' || tok.t === 'sqrt');
  }

  function expr(): number {
    let v = term();
    for (let tok = peek(); tok && tok.t === 'op' && (tok.v === '+' || tok.v === '-'); tok = peek()) {
      next();
      const r = term();
      v = tok.v === '+' ? v + r : v - r;
    }
    return v;
  }

  function term(): number {
    let v = unary();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === 'op' && (tok.v === '*' || tok.v === '/')) {
        next();
        const r = unary();
        if (tok.v === '/' && r === 0) throw new CalcError('Can’t divide by zero');
        v = tok.v === '*' ? v * r : v / r;
      } else if (startsPrimary(tok)) {
        // 2π, 3(4+1), 2sin(30)
        v *= unary();
      } else return v;
    }
  }

  function unary(): number {
    const tok = peek();
    if (tok && tok.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      next();
      const v = unary();
      return tok.v === '-' ? -v : v;
    }
    return power();
  }

  function power(): number {
    const base = postfix();
    const tok = peek();
    if (tok && tok.t === 'op' && tok.v === '^') {
      next();
      const exp = unary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function postfix(): number {
    let v = primary();
    for (let tok = peek(); tok && tok.t === 'op' && (tok.v === '!' || tok.v === '%'); tok = peek()) {
      next();
      v = tok.v === '!' ? factorial(v) : v / 100;
    }
    return v;
  }

  function group(): number {
    const open = next();
    if (!open || open.t !== 'lp') throw new CalcError('Missing (');
    const v = expr();
    const close = next();
    if (!close || close.t !== 'rp') throw new CalcError('Missing )');
    return v;
  }

  function primary(): number {
    const tok = peek();
    if (!tok) throw new CalcError('Incomplete calculation');
    if (tok.t === 'num') {
      next();
      return tok.v;
    }
    if (tok.t === 'lp') return group();
    if (tok.t === 'sqrt') {
      next();
      const v = peek()?.t === 'lp' ? group() : power();
      if (v < 0) throw new CalcError('Square root of a negative number');
      return Math.sqrt(v);
    }
    if (tok.t === 'id') {
      next();
      if (tok.v === 'pi') return Math.PI;
      if (tok.v === 'e') return Math.E;
      if (tok.v === 'ans') return opts.ans;
      const arg = peek()?.t === 'lp' ? group() : power();
      switch (tok.v) {
        case 'sin':
          return clean(Math.sin(toRad(arg)));
        case 'cos':
          return clean(Math.cos(toRad(arg)));
        case 'tan': {
          const c = Math.cos(toRad(arg));
          if (Math.abs(c) < 1e-12) throw new CalcError('tan is undefined here');
          return clean(Math.tan(toRad(arg)));
        }
        case 'asin':
          if (arg < -1 || arg > 1) throw new CalcError('asin needs a value from −1 to 1');
          return fromRad(Math.asin(arg));
        case 'acos':
          if (arg < -1 || arg > 1) throw new CalcError('acos needs a value from −1 to 1');
          return fromRad(Math.acos(arg));
        case 'atan':
          return fromRad(Math.atan(arg));
        case 'log':
          if (arg <= 0) throw new CalcError('log needs a positive number');
          return Math.log10(arg);
        case 'ln':
          if (arg <= 0) throw new CalcError('ln needs a positive number');
          return Math.log(arg);
        case 'sqrt':
          if (arg < 0) throw new CalcError('Square root of a negative number');
          return Math.sqrt(arg);
        case 'abs':
          return Math.abs(arg);
        case 'exp':
          return Math.exp(arg);
      }
    }
    throw new CalcError('Check the calculation');
  }

  const value = expr();
  if (pos < tokens.length) throw new CalcError(tokens[pos]!.t === 'rp' ? 'Unmatched )' : 'Check the calculation');
  if (Number.isNaN(value)) throw new CalcError('Not a number');
  return value;
}

/** Up to 12 significant digits, without float noise like 0.30000000000000004. */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e12 || abs < 1e-9) return value.toExponential(8).replace(/\.?0+e/, 'e').replace('-', '−');
  return String(Number(value.toPrecision(12))).replace('-', '−');
}
