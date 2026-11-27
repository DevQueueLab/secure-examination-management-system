import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { ResultCard } from '../../results/result-card';
import { MetaRow } from './meta-row';
import { C, base, fmtDate, fmtDateTime, fmtNum, pdfText } from './theme';

export interface CandidateReportProps {
  card: ResultCard;
  /** Present only for published results; a provisional copy carries no verification. */
  verification: { code: string; url: string; qrDataUrl: string; keyId: string; issuedAt: Date } | null;
  showFeedback: boolean;
}

function Bar({ percent, color = C.accent }: { percent: number; color?: string }) {
  const w = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ height: 5, backgroundColor: C.fill, borderRadius: 3, width: '100%' }}>
      <View style={{ height: 5, width: `${w}%`, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

const barColor = (p: number) => (p >= 70 ? C.pass : p >= 50 ? C.accent : C.fail);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={base.tiny}>{label}</Text>
      <Text style={{ marginTop: 2 }}>{pdfText(value)}</Text>
    </View>
  );
}

/** A candidate's result report: score, breakdowns, feedback and a QR code that proves authenticity. */
export function CandidateReport({ card, verification, showFeedback }: CandidateReportProps) {
  const passLabel = card.pass === null ? null : card.pass ? 'PASS' : 'NOT PASSED';
  const feedbackItems = showFeedback ? card.items.filter((i) => i.feedback || i.rubric.length) : [];
  return (
    <Document title={`${card.exam.title} result - ${card.candidate.name}`} author={card.organization.name} creator="Athena" producer="Athena">
      <Page size="A4" style={base.page}>
        {/* Letterhead */}
        <View style={[base.row, { justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 }, base.rule]}>
          <Text style={[base.bold, { fontSize: 10.5 }]}>{pdfText(card.organization.name)}</Text>
        </View>

        {!verification && (
          <View style={{ marginTop: 12, padding: 8, borderRadius: 6, backgroundColor: C.warnSoft }}>
            <Text style={{ color: C.warn, fontSize: 8.5 }}>
              Provisional copy. Results are not published yet, so this report has no verification code and may change.
            </Text>
          </View>
        )}

        <View style={{ marginTop: 16 }}>
          <Text style={base.h1}>{pdfText(card.exam.title)}</Text>
          <MetaRow items={['Result report', card.exam.code, `Results version ${card.exam.resultsVersion}`, card.exam.publishedAt ? `Published ${fmtDate(card.exam.publishedAt)}` : null]} />
        </View>

        <View style={[base.row, { marginTop: 14, gap: 12 }]}>
          <Field label="Candidate" value={card.candidate.name} />
          <Field label="Roll number" value={card.candidate.rollNumber ?? '-'} />
          <Field label="Submitted" value={fmtDateTime(card.submittedAt)} />
        </View>

        {/* Score */}
        <View style={[base.row, { marginTop: 18, padding: 14, borderRadius: 10, backgroundColor: C.fill, alignItems: 'center' }]}>
          <View style={{ width: 150 }}>
            <Text style={[base.bold, { fontSize: 30, lineHeight: 1 }]}>{fmtNum(card.percent)}%</Text>
            <Text style={[base.muted, { marginTop: 4 }]}>
              {fmtNum(card.score, 2)} of {fmtNum(card.maxScore, 2)} marks
            </Text>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {passLabel && (
              <View style={base.row}>
                <Text style={[base.pill, { color: card.pass ? C.pass : C.fail, backgroundColor: card.pass ? C.passSoft : C.failSoft }]}>{passLabel}</Text>
                {card.exam.passPercent !== null && <Text style={[base.muted, { marginLeft: 6, fontSize: 8.5, paddingTop: 2 }]}>Pass mark {fmtNum(card.exam.passPercent, 0)}%</Text>}
              </View>
            )}
            {card.cohort.percentile !== null && (
              <Text style={{ fontSize: 9 }}>
                Scored higher than {card.cohort.percentile}% of {card.cohort.size} candidates
                {card.cohort.rank ? ` (rank ${card.cohort.rank})` : ''}. Cohort average {fmtNum(card.cohort.meanPercent)}%.
              </Text>
            )}
            {card.gradingStatus !== 'complete' && <Text style={{ fontSize: 8.5, color: C.warn }}>Some answers are still being graded.</Text>}
          </View>
        </View>

        {/* Sections */}
        {card.sections.length > 0 && (
          <View wrap={false}>
            <Text style={base.h2}>By section</Text>
            <View style={[base.row, base.rule]}>
              <Text style={[base.th, { flex: 3 }]}>Section</Text>
              <Text style={[base.th, { flex: 1, textAlign: 'right' }]}>Marks</Text>
              <Text style={[base.th, { flex: 1, textAlign: 'right' }]}>Score</Text>
              <View style={{ flex: 2 }} />
            </View>
            {card.sections.map((s) => (
              <View key={s.id} style={[base.row, base.rule, { alignItems: 'center' }]}>
                <Text style={[base.td, { flex: 3 }]}>{pdfText(s.title)}</Text>
                <Text style={[base.td, { flex: 1, textAlign: 'right' }]}>
                  {fmtNum(s.score, 2)} / {fmtNum(s.max, 2)}
                </Text>
                <Text style={[base.td, base.bold, { flex: 1, textAlign: 'right' }]}>{fmtNum(s.percent)}%</Text>
                <View style={{ flex: 2, paddingLeft: 12 }}>
                  <Bar percent={s.percent} color={barColor(s.percent)} />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Topics */}
        {card.topics.length > 0 && (
          <View wrap={false}>
            <Text style={base.h2}>By topic</Text>
            {card.topics.map((t) => (
              <View key={t.category} style={[base.row, base.rule, { alignItems: 'center' }]}>
                <Text style={[base.td, { flex: 3 }]}>{pdfText(t.category)}</Text>
                <Text style={[base.td, base.muted, { flex: 1, textAlign: 'right' }]}>
                  {t.items} question{t.items === 1 ? '' : 's'}
                </Text>
                <Text style={[base.td, base.bold, { flex: 1, textAlign: 'right' }]}>{fmtNum(t.percent)}%</Text>
                <View style={{ flex: 2, paddingLeft: 12 }}>
                  <Bar percent={t.percent} color={barColor(t.percent)} />
                </View>
              </View>
            ))}
            {(card.strengths.length > 0 || card.weaknesses.length > 0) && (
              <View style={[base.row, { marginTop: 8, gap: 12 }]}>
                {card.strengths.length > 0 && (
                  <View style={{ flex: 1, padding: 8, borderRadius: 6, backgroundColor: C.passSoft }}>
                    <Text style={[base.bold, { color: C.pass, fontSize: 8.5 }]}>Strengths</Text>
                    <Text style={{ marginTop: 2 }}>{pdfText(card.strengths.join(', '))}</Text>
                  </View>
                )}
                {card.weaknesses.length > 0 && (
                  <View style={{ flex: 1, padding: 8, borderRadius: 6, backgroundColor: C.failSoft }}>
                    <Text style={[base.bold, { color: C.fail, fontSize: 8.5 }]}>To work on</Text>
                    <Text style={{ marginTop: 2 }}>{pdfText(card.weaknesses.join(', '))}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Per question */}
        <View>
          <Text style={base.h2}>Questions</Text>
          <View style={[base.row, base.rule]} fixed={false}>
            <Text style={[base.th, { width: 28 }]}>#</Text>
            <Text style={[base.th, { flex: 1 }]}>Question</Text>
            <Text style={[base.th, { width: 70, textAlign: 'right' }]}>Score</Text>
          </View>
          {card.items.map((it) => (
            <View key={it.itemId} style={[base.row, base.rule]} wrap={false}>
              <Text style={[base.td, base.muted, { width: 28 }]}>{it.number}</Text>
              <Text style={[base.td, { flex: 1 }]}>
                {pdfText(it.title)}
                <Text style={[base.muted, { fontSize: 8 }]}>{`\n${pdfText(it.typeLabel)}`}</Text>
              </Text>
              <Text style={[base.td, base.bold, { width: 70, textAlign: 'right' }]}>
                {it.voidReason ? 'Dropped' : it.score === null ? 'Pending' : `${fmtNum(it.score, 2)} / ${fmtNum(it.max, 2)}`}
              </Text>
            </View>
          ))}
        </View>

        {/* Feedback */}
        {feedbackItems.length > 0 && (
          <View>
            <Text style={base.h2}>Feedback from your graders</Text>
            {feedbackItems.map((it) => (
              <View key={it.itemId} style={{ marginBottom: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: C.accent }} wrap={false}>
                <Text style={base.bold}>
                  Q{it.number}. {pdfText(it.title)}
                  <Text style={[base.muted, { fontFamily: 'Helvetica' }]}>{it.score !== null ? `  ${fmtNum(it.score, 2)} / ${fmtNum(it.max, 2)}` : ''}</Text>
                </Text>
                {it.rubric.map((r, n) => (
                  <Text key={n} style={[base.muted, { fontSize: 8.5, marginTop: 1 }]}>
                    {pdfText(`${r.points > 0 ? '+' : ''}${fmtNum(r.points, 2)}  ${r.label}`)}
                  </Text>
                ))}
                {it.feedback && <Text style={{ marginTop: 2 }}>{pdfText(it.feedback)}</Text>}
              </View>
            ))}
          </View>
        )}

        {/* Verification */}
        {verification && (
          <View style={[base.row, { marginTop: 18, padding: 12, borderRadius: 10, borderWidth: 0.75, borderColor: C.hairline, alignItems: 'center' }]} wrap={false}>
            <Image src={verification.qrDataUrl} style={{ width: 84, height: 84 }} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={base.bold}>Verify this report</Text>
              <Text style={[base.muted, { marginTop: 2, fontSize: 8.5 }]}>
                Scan the code or visit the address below. The page confirms the score and whether this report is still current, and discloses nothing else.
              </Text>
              <Text style={[base.bold, { marginTop: 6, fontSize: 12, letterSpacing: 1 }]}>{verification.code}</Text>
              <Text style={{ color: C.accent, fontSize: 8.5 }}>{verification.url}</Text>
              <Text style={[base.tiny, { marginTop: 4 }]}>
                Issued {fmtDateTime(verification.issuedAt)}. Signed with Ed25519, key {verification.keyId}.
              </Text>
            </View>
          </View>
        )}

        <View style={base.footer} fixed>
          <Text>{pdfText(`${card.candidate.name}, ${card.exam.title}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
