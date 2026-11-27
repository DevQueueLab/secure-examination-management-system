'use client';

import { Clock, HardDrive, Maximize, WifiOff } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useEngineSelector } from '../lib/use-engine';

function Banner({ tone, icon, children, action }: { tone: 'warning' | 'info' | 'neutral'; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-2.5 text-callout sm:items-center sm:px-6',
        tone === 'warning' && 'bg-warning-tint text-warning-text',
        tone === 'info' && 'bg-info-tint text-info-text',
        tone === 'neutral' && 'bg-fill-secondary text-label',
      )}
    >
      <span aria-hidden className="mt-0.5 shrink-0 sm:mt-0 [&_svg]:size-4">
        {icon}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/** Status lines under the header: offline, an estimated clock, storage that won't survive a reload, full screen. */
export function WorkspaceBanners({ fullscreenPrompt, onEnterFullscreen }: { fullscreenPrompt: boolean; onEnterFullscreen: () => void }) {
  const offline = useEngineSelector((s) => s.phase === 'ready' && (s.sync.state === 'offline' || !s.sync.online));
  const estimated = useEngineSelector((s) => s.clockEstimated);
  const durable = useEngineSelector((s) => s.durable);
  const stack = useRef<HTMLDivElement>(null);

  // Publish the stack's height so the navigator and scratchpad rails sit below it instead of under it.
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--ws-banners', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--ws-banners');
    };
  }, []);

  return (
    // Sticky under the header so the offline notice stays in view; the page colour sits under the translucent tints.
    <div ref={stack} aria-live="polite" className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 bg-bg">
        {offline && (
          <Banner key="offline" tone="warning" icon={<WifiOff />}>
            You’re offline. Keep answering — your work is stored on this device and syncs automatically. The timer keeps running.
          </Banner>
        )}
        {estimated && !offline && (
          <Banner key="estimated" tone="info" icon={<Clock />}>
            Showing time from this device’s clock until Athena reconnects. Athena’s clock decides the deadline.
          </Banner>
        )}
        {!durable && (
          <Banner key="durable" tone="neutral" icon={<HardDrive />}>
            This browser can’t keep answers offline (a private window?). Your answers save while you’re connected; stay online.
          </Banner>
        )}
        {fullscreenPrompt && (
          <Banner
            key="fullscreen"
            tone="info"
            icon={<Maximize />}
            action={
              <Button variant="filled" size="sm" onClick={onEnterFullscreen} className="shrink-0">
                Return to full screen
              </Button>
            }
          >
            This exam runs in full screen. Leaving it is noted for your examiner, who reviews it in context.
          </Banner>
        )}
    </div>
  );
}
