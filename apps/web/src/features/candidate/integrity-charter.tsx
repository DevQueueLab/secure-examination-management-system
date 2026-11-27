import type { ExamLobby } from '@athena/shared';
import { Check, Fingerprint, Minus, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

function Item({ children, kind }: { children: ReactNode; kind: 'recorded' | 'never' }) {
  return (
    <li className="flex items-start gap-2.5 text-callout text-label">
      <span
        aria-hidden
        className={
          kind === 'recorded'
            ? 'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-text'
            : 'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-fill text-label-secondary'
        }
      >
        {kind === 'recorded' ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Exactly what the exam watches and what it never does, in plain words, before the candidate agrees to start. */
export function IntegrityCharter({ lobby }: { lobby: Pick<ExamLobby, 'integrity'> }) {
  const { integrity } = lobby;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-headline text-label">Recorded during the exam</h3>
          <ul className="mt-3 flex flex-col gap-2.5" aria-label="Recorded during the exam">
            {integrity.detectFocusLoss && <Item kind="recorded">When you switch away from the exam tab, and for how long</Item>}
            {integrity.requireFullscreen && <Item kind="recorded">When you leave full screen</Item>}
            {integrity.blockCopyPaste ? (
              <Item kind="recorded">Copy and paste are turned off; attempts to use them are noted</Item>
            ) : (
              <Item kind="recorded">When you paste into an answer, and how much</Item>
            )}
            <Item kind="recorded">Whether written answers were typed or pasted, so your own work is clear</Item>
            <Item kind="recorded">Right-click and print attempts, and a second display where the browser reports one</Item>
          </ul>
        </div>
        <div>
          <h3 className="text-headline text-label">Never recorded</h3>
          <ul className="mt-3 flex flex-col gap-2.5" aria-label="Never recorded">
            <Item kind="never">No camera, microphone or screen recording</Item>
            <Item kind="never">Nothing outside this tab: no other tabs, apps or browsing history</Item>
            <Item kind="never">No keystrokes outside your answer boxes</Item>
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t pt-5">
        <p className="flex items-start gap-2.5 text-callout text-label-secondary">
          <UsersRound aria-hidden className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
          <span>
            <span className="font-medium text-label">People review indicators, in context.</span> None of them is an automatic penalty, and you can
            dispute any decision about your work.
          </span>
        </p>
        {(integrity.watermark || !integrity.blockCopyPaste) && (
          <p className="flex items-start gap-2.5 text-callout text-label-secondary">
            <Fingerprint aria-hidden className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
            <span>
              {integrity.watermark && !integrity.blockCopyPaste
                ? 'Questions carry a faint code unique to your paper, and so does any question text you copy, so a leaked copy can be traced to where it came from.'
                : integrity.watermark
                  ? 'Questions carry a faint code unique to your paper, so a leaked copy can be traced to where it came from.'
                  : 'Question text you copy carries an invisible code unique to your paper, so a leaked copy can be traced to where it came from.'}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
