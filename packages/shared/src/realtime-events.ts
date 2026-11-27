/**
 * Socket.IO event names. Payloads never include answer keys or unpublished scores.
 * Clients join rooms by emitting `join` with { kind: 'exam-staff', examId } or { kind: 'attempt', attemptId }.
 */
export const RT = {
  // to exam staff (monitor)
  attemptStarted: 'attempt:started',
  attemptProgress: 'attempt:progress', // { attemptId, answeredCount, itemCount, flaggedCount, lastSeenAt, online, rttMs }
  attemptSubmitted: 'attempt:submitted',
  attemptIncident: 'attempt:incident', // { attemptId, event }
  attemptConnectivity: 'attempt:connectivity', // { attemptId, online }
  clarificationAsked: 'clarification:asked',
  // to candidates
  announcement: 'announcement:new', // AnnouncementView
  clarificationAnswered: 'clarification:answered', // ClarificationView
  timeExtended: 'attempt:time-extended', // { attemptId, deadlineAt, reason }
  forceSubmitted: 'attempt:force-submitted', // { attemptId, reason }
  sessionTakenOver: 'attempt:session-taken-over', // { attemptId }
  // to a user
  notification: 'notification:new',
} as const;
