'use client';

import { useEffect } from 'react';

/**
 * Pointer parallax for the hero's layers. Each `[data-depth]` element moves by its depth in pixels against the
 * pointer, and `[data-tilt]` elements also lean towards it, eased on one animation frame loop that stops when the
 * layers settle. Transform only. Fine pointers only, and never under reduced motion.
 */
export function HeroParallax() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    if (!hero) return;
    const layers = Array.from(hero.querySelectorAll<HTMLElement>('[data-depth]')).map((el) => ({
      el,
      depth: Number(el.dataset.depth) || 0,
      tilt: el.hasAttribute('data-tilt'),
    }));
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let frame = 0;

    const step = () => {
      x += (tx - x) * 0.075;
      y += (ty - y) * 0.075;
      for (const { el, depth, tilt } of layers) {
        const move = `translate3d(${(-x * depth).toFixed(2)}px, ${(-y * depth).toFixed(2)}px, 0)`;
        el.style.transform = tilt ? `perspective(1200px) ${move} rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)` : move;
      }
      frame = Math.abs(tx - x) > 0.0005 || Math.abs(ty - y) > 0.0005 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      for (const { el } of layers) el.style.transform = '';
    };
  }, []);
  return null;
}
