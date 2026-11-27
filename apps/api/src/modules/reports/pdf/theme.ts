import { StyleSheet } from '@react-pdf/renderer';

/** Report palette: quiet neutrals, one accent, semantic pass/fail. Mirrors the web app's tokens. */
export const C = {
  ink: '#1d1d1f',
  secondary: '#6e6e73',
  tertiary: '#8e8e93',
  hairline: '#e5e5ea',
  fill: '#f5f5f7',
  accent: '#0a64d6',
  accentSoft: '#e8f1fd',
  pass: '#1f7a35',
  passSoft: '#e7f5ea',
  fail: '#c41a1a',
  failSoft: '#fdecec',
  warn: '#a05a00',
  warnSoft: '#fdf3e3',
};

/**
 * The built-in PDF fonts only cover WinAnsi (Latin-1 plus a few typographic marks). Map common symbols to
 * safe equivalents and drop anything else, so grader feedback never renders as garbage.
 */
const REPLACEMENTS: Record<string, string> = {
  '−': '-',
  '→': '->',
  '←': '<-',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '✓': '',
  '✔': '',
  '✕': 'x',
  '⚠': '!',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

export function pdfText(value: string | null | undefined): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    const mapped = REPLACEMENTS[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch === '\n' || ch === '\t' || (ch >= ' ' && ch <= 'ÿ') || WINANSI_EXTRA.has(ch)) out += ch;
  }
  return out;
}

export const base = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 9.5, color: C.ink, lineHeight: 1.4 },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: C.secondary },
  tiny: { fontSize: 7.5, color: C.tertiary },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 19, lineHeight: 1.2, marginBottom: 3 },
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 6, marginTop: 16 },
  row: { flexDirection: 'row' },
  rule: { borderBottomWidth: 0.75, borderBottomColor: C.hairline },
  footer: { position: 'absolute', bottom: 24, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.tertiary },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: C.secondary, paddingVertical: 4 },
  td: { paddingVertical: 4.5 },
  pill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, fontSize: 8, fontFamily: 'Helvetica-Bold' },
});

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' }) : '-';
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }) + ' PKT'
    : '-';
export const fmtNum = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '-' : Number(n.toFixed(digits)).toString());
