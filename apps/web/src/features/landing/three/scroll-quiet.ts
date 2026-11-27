/**
 * The canvas's one-off work (its chunk, its GL context, its compiles) waits until the page has stopped
 * scrolling, so scrolling into the section never stutters. The still covers the wait.
 */
export const QUIET_MS = 250;

let last = Number.NEGATIVE_INFINITY;
let users = 0;
const mark = () => {
  last = performance.now();
};

/** Starts tracking page scrolls and returns the matching stop. */
export function watchScroll(): () => void {
  if (users++ === 0) window.addEventListener('scroll', mark, { passive: true });
  return () => {
    if (--users === 0) window.removeEventListener('scroll', mark);
  };
}

/** How much longer the page has to stay put before it counts as still; 0 once it does. */
export function stillIn(): number {
  return Math.max(0, last + QUIET_MS - performance.now());
}
