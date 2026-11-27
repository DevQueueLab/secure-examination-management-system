import { Document, Page, Rect, Svg, Text, View, Line } from '@react-pdf/renderer';
import type { ExamAnalytics } from '../../analytics/analytics.service';
import { formatDuration } from '../../../domain/analytics/item-analysis';
import { MetaRow } from './meta-row';
import { C, base, fmtDateTime, fmtNum, pdfText } from './theme';

const SEVERITY = {
  critical: { label: 'Review', color: C.fail, soft: C.failSoft },
  warning: { label: 'Check', color: C.warn, soft: C.warnSoft },
  info: { label: 'Note', color: C.accent, soft: C.accentSoft },
  positive: { label: 'Good', color: C.pass, soft: C.passSoft },
} as const;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1, padding: 9, borderRadius: 8, backgroundColor: C.fill }}>
      <Text style={base.tiny}>{label}</Text>
      <Text style={[base.bold, { fontSize: 15, marginTop: 3 }]}>{value}</Text>
      {sub ? <Text style={[base.muted, { fontSize: 7.5, marginTop: 1 }]}>{pdfText(sub)}</Text> : null}
    </View>
  );
}

/** Score histogram drawn with react-pdf SVG primitives (10 bins of 10 percentage points). */
function Histogram({ bins, passPercent }: { bins: ExamAnalytics['summary']['histogram']; passPercent: number | null }) {
  const W = 507;
  const H = 120;
  const gap = 6;
  const bw = (W - gap * (bins.length - 1)) / bins.length;
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const passX = passPercent === null ? null : (passPercent / 100) * W;
  return (
    <View>
      <View style={[base.row, { width: W }]}>
        {bins.map((b, i) => (
          <Text key={i} style={{ width: bw, marginRight: i < bins.length - 1 ? gap : 0, textAlign: 'center', fontSize: 7.5, color: C.secondary }}>
            {b.count || ''}
          </Text>
        ))}
      </View>
      <Svg width={W} height={H}>
        <Line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke={C.hairline} strokeWidth={1} />
        {bins.map((b, i) => {
          const h = b.count ? Math.max(2, (b.count / peak) * (H - 6)) : 0;
          const below = passPercent !== null && b.to <= passPercent;
          return <Rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={3} ry={3} fill={below ? '#9fb7d9' : C.accent} />;
        })}
        {passX !== null && <Line x1={passX} y1={0} x2={passX} y2={H} stroke={C.ink} strokeWidth={0.75} strokeDasharray="3 2" />}
      </Svg>
      <View style={[base.row, { width: W, marginTop: 3 }]}>
        {bins.map((b, i) => (
          <Text key={i} style={{ width: bw, marginRight: i < bins.length - 1 ? gap : 0, textAlign: 'center', fontSize: 7, color: C.tertiary }}>
            {`${Math.round(b.from)}-${Math.round(b.to)}`}
          </Text>
        ))}
      </View>
      {passPercent !== null && <Text style={[base.tiny, { marginTop: 3 }]}>Dashed line: pass mark ({fmtNum(passPercent, 0)}%). Scores in percent.</Text>}
    </View>
  );
}

const cols = { q: 26, title: 150, type: 62, p: 34, d: 34, r: 34, skip: 34, time: 44, flags: 89 } as const;

/** Exam summary report: descriptive statistics, histogram, item analysis and the leading insights. */
export function ExamReport({ data, organizationName }: { data: ExamAnalytics; organizationName: string }) {
  const s = data.summary;
  const r = s.reliability;
  return (
    <Document title={`${data.exam.title} - examination report`} author={organizationName} creator="Athena" producer="Athena">
      <Page size="A4" style={base.page}>
        <View style={[base.row, { justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 }, base.rule]}>
          <Text style={[base.bold, { fontSize: 10.5 }]}>{pdfText(organizationName)}</Text>
        </View>
        <View style={{ marginTop: 16 }}>
          <Text style={base.h1}>{pdfText(data.exam.title)}</Text>
          <MetaRow items={['Examination report', data.exam.code, `Results ${data.exam.resultsStatus}`, `Generated ${fmtDateTime(data.generatedAt)}`]} />
        </View>

        <View style={[base.row, { marginTop: 16, gap: 8 }]}>
          <Stat label="Candidates" value={String(s.n)} sub={s.pending ? `${s.pending} still being graded` : 'all graded'} />
          <Stat label="Mean" value={`${fmtNum(s.percent.mean)}%`} sub={`${fmtNum(s.score.mean, 2)} of ${fmtNum(s.maxScore, 0)} marks`} />
          <Stat label="Median" value={`${fmtNum(s.percent.median)}%`} sub={`SD ${fmtNum(s.percent.sd)} pts`} />
          <Stat label="Range" value={`${fmtNum(s.percent.min, 0)}-${fmtNum(s.percent.max, 0)}%`} />
          <Stat label="Pass rate" value={s.passRate === null ? '-' : `${fmtNum(s.passRate * 100, 0)}%`} sub={s.passPercent === null ? 'no pass mark' : `${s.passed} passed`} />
          <Stat label={r.method === 'KR-20' ? 'KR-20' : 'Alpha'} value={r.value === null ? '-' : r.value.toFixed(2)} sub={r.band ?? r.note ?? ''} />
        </View>

        <Text style={base.h2}>Score distribution</Text>
        <Histogram bins={s.histogram} passPercent={s.passPercent} />

        {(data.sections.length > 1 || data.topics.length > 0) && (
          <View style={[base.row, { gap: 16 }]} wrap={false}>
            {data.sections.length > 1 && (
              <View style={{ flex: 1 }}>
                <Text style={base.h2}>Sections</Text>
                {data.sections.map((sec) => (
                  <View key={sec.sectionId} style={[base.row, base.rule, { justifyContent: 'space-between' }]}>
                    <Text style={base.td}>{pdfText(sec.title)}</Text>
                    <Text style={[base.td, base.bold]}>{fmtNum(sec.meanPercent)}%</Text>
                  </View>
                ))}
              </View>
            )}
            {data.topics.length > 0 && (
              <View style={{ flex: 1 }}>
                <Text style={base.h2}>Topic mastery</Text>
                {data.topics.map((t) => (
                  <View key={t.category} style={[base.row, base.rule, { justifyContent: 'space-between' }]}>
                    <Text style={base.td}>{pdfText(t.category)}</Text>
                    <Text style={[base.td, base.bold]}>{fmtNum(t.meanPercent)}%</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <Text style={base.h2} break={data.items.length > 8}>
          Item analysis
        </Text>
        <Text style={[base.tiny, { marginBottom: 4 }]}>
          p = difficulty (share of marks earned; higher is easier). D = discrimination (top 27% minus bottom 27%). r = corrected point-biserial.
        </Text>
        <View style={[base.row, base.rule]} fixed>
          <Text style={[base.th, { width: cols.q }]}>Q</Text>
          <Text style={[base.th, { width: cols.title }]}>Question</Text>
          <Text style={[base.th, { width: cols.type }]}>Type</Text>
          <Text style={[base.th, { width: cols.p, textAlign: 'right' }]}>p</Text>
          <Text style={[base.th, { width: cols.d, textAlign: 'right' }]}>D</Text>
          <Text style={[base.th, { width: cols.r, textAlign: 'right' }]}>r</Text>
          <Text style={[base.th, { width: cols.skip, textAlign: 'right' }]}>Skip</Text>
          <Text style={[base.th, { width: cols.time, textAlign: 'right' }]}>Time</Text>
          <Text style={[base.th, { width: cols.flags, paddingLeft: 8 }]}>Findings</Text>
        </View>
        {data.items.map((it) => {
          const worst = it.insights.find((i) => i.severity === 'critical') ?? it.insights.find((i) => i.severity === 'warning') ?? it.insights[0];
          const sev = worst ? SEVERITY[worst.severity] : null;
          return (
            <View key={it.questionId} style={[base.row, base.rule, { alignItems: 'center' }]} wrap={false}>
              <Text style={[base.td, base.bold, { width: cols.q }]}>{it.label}</Text>
              <Text style={[base.td, { width: cols.title, paddingRight: 6 }]}>{pdfText(it.title)}</Text>
              <Text style={[base.td, base.muted, { width: cols.type, fontSize: 8 }]}>{pdfText(it.typeLabel)}</Text>
              <Text style={[base.td, { width: cols.p, textAlign: 'right' }]}>{fmtNum(it.difficulty, 2)}</Text>
              <Text style={[base.td, { width: cols.d, textAlign: 'right', color: it.discrimination !== null && it.discrimination < 0 ? C.fail : C.ink }]}>
                {fmtNum(it.discrimination, 2)}
              </Text>
              <Text style={[base.td, { width: cols.r, textAlign: 'right' }]}>{fmtNum(it.pointBiserial, 2)}</Text>
              <Text style={[base.td, { width: cols.skip, textAlign: 'right' }]}>{fmtNum(it.skipRate * 100, 0)}%</Text>
              <Text style={[base.td, { width: cols.time, textAlign: 'right' }]}>{it.avgTimeMs ? formatDuration(it.avgTimeMs) : '-'}</Text>
              <View style={{ width: cols.flags, paddingLeft: 8 }}>
                {worst && sev ? <Text style={{ fontSize: 7.5, color: sev.color }}>{pdfText(worst.title)}</Text> : <Text style={base.tiny}>-</Text>}
              </View>
            </View>
          );
        })}

        {data.insights.length > 0 && (
          <View>
            <Text style={base.h2}>What to look at</Text>
            {data.insights.slice(0, 10).map((i, idx) => {
              const sev = SEVERITY[i.severity];
              return (
                <View key={idx} style={[base.row, { marginBottom: 6 }]} wrap={false}>
                  <Text style={[base.pill, { color: sev.color, backgroundColor: sev.soft, width: 46, textAlign: 'center', marginRight: 8 }]}>{sev.label}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={base.bold}>{pdfText(i.label && !i.title.startsWith(i.label) ? `${i.label}: ${i.title}` : i.title)}</Text>
                    <Text style={base.muted}>{pdfText(i.detail)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={base.footer} fixed>
          <Text>{pdfText(`${data.exam.title}, real attempts only (examiner previews excluded)`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
