'use client';

import { RT, type AnnouncementView, type ClarificationView } from '@athena/shared';
import { useMemo } from 'react';
import { useSocketRoom } from '@/lib/socket';
import type { AttemptEngine } from '../sync/engine';

/**
 * Live pushes for this attempt. They only speed things up: every one is also picked up by the next sync,
 * so a blocked websocket never loses an announcement, an extension or a forced submit.
 */
export function useAttemptSocket(engine: AttemptEngine, enabled: boolean) {
  const join = useMemo(() => (enabled ? ({ kind: 'attempt', attemptId: engine.attemptId } as const) : null), [enabled, engine.attemptId]);
  return useSocketRoom(join, {
    [RT.announcement]: (payload: AnnouncementView) => engine.receiveAnnouncement(payload),
    [RT.clarificationAnswered]: (payload: ClarificationView) => engine.receiveClarification(payload),
    [RT.timeExtended]: (payload: { deadlineAt?: string }) => engine.receiveTimeExtended(payload ?? {}),
    [RT.forceSubmitted]: () => engine.receiveForceSubmitted(),
    [RT.sessionTakenOver]: () => engine.receiveSessionTakenOver(),
  });
}
