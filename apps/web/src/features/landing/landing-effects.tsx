'use client';

import { useEffect } from 'react';

/** Fits a one-line display title to a share of its container's width, by measurement. */
function fitTitles() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-fit]')) {
    const share = Number(el.dataset.fit) || 0.85;
    const box = el.parentElement;
    if (!box) continue;
    const target = box.clientWidth * share;
    const prevWidth = el.style.width;
    el.style.width = 'max-content';
    const size = parseFloat(getComputedStyle(el).fontSize);
    // Layout width, not the painted box: the hero title is scaled by the scroll scene once the page moves.
    const natural = el.offsetWidth;
    el.style.width = prevWidth;
    if (!natural || !size) continue;
    const capByHeight = window.innerHeight * 0.36;
    el.style.fontSize = `${Math.min((size * target) / natural, capByHeight)}px`;
  }
}

/**
 * Page-wide behaviour that needs the browser: notices when the Athens display face has loaded (it is set
 * without the fallback's tighter tracking) and keeps display titles fitted to their share of the width.
 */
export function LandingEffects() {
  useEffect(() => {
    const html = document.documentElement;
    let cancelled = false;

    fitTitles();
    document.fonts
      ?.load('700 100px Athens')
      .then((faces) => {
        if (cancelled) return;
        if (faces.length > 0) html.classList.add('athens');
        fitTitles();
      })
      .catch(() => {});
    void document.fonts?.ready.then(() => !cancelled && fitTitles());

    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitTitles);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      html.classList.remove('athens');
    };
  }, []);
  return null;
}
