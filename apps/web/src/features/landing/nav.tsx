'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, ViewTransition, type CSSProperties } from 'react';
import n from './nav.module.css';

/*
 * The landing page's navigation, mounted once by landing.tsx above the hero: a plain full-width bar.
 * The name sits on the left and carries the shared-element morph to the sign-in page; the links, Sign in and
 * the square carmine button sit on the right. A carmine needle, the Marks rule's needle, glides to the link
 * under the pointer or focus and otherwise rests under the section in view. The bar is clear at the top of
 * the page and takes a solid ground with a hairline once the page scrolls; over a section marked
 * data-nav-theme="dark" that ground is night. Phone: the name and a menu button that springs open a
 * full-screen marble sheet.
 */

const LINKS = [
  { id: 'exam', label: 'How it works' },
  { id: 'draw', label: 'Live draw' },
  { id: 'proof', label: 'Security' },
] as const;

type SectionId = (typeof LINKS)[number]['id'];

const SCROLLED_AT = 40;

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  const needleRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef<Partial<Record<SectionId, HTMLAnchorElement | null>>>({});
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pointed = useRef<SectionId | null>(null);
  const activeRef = useRef<SectionId | null>(null);
  const [active, setActive] = useState<SectionId | null>(null);
  const [open, setOpen] = useState(false);
  const sheetId = useId();

  // Glide the needle to a link (transform only), or fold it away when there is nothing to point at.
  const place = useCallback((id: SectionId | null) => {
    const needle = needleRef.current;
    if (!needle) return;
    const link = id ? linkRefs.current[id] : null;
    if (!link || link.offsetWidth === 0) {
      needle.dataset.shown = 'false';
      return;
    }
    const x = link.offsetLeft + link.offsetWidth / 2;
    if (needle.dataset.shown !== 'true') {
      // Appearing: jump into place without gliding, then fade in.
      needle.style.transition = 'none';
      needle.style.transform = `translateX(${x}px)`;
      void needle.offsetWidth;
      needle.style.transition = '';
    } else {
      needle.style.transform = `translateX(${x}px)`;
    }
    needle.dataset.shown = 'true';
  }, []);

  const point = (id: SectionId | null) => {
    // Leaving with the pointer while a link holds focus hands the needle back to that link.
    const focused = LINKS.find((l) => linkRefs.current[l.id] === document.activeElement)?.id ?? null;
    pointed.current = id ?? focused;
    place(pointed.current ?? activeRef.current);
  };

  // Scroll-spy: the section crossing a band just above the middle of the viewport is the one in view.
  useEffect(() => {
    const targets = LINKS.map((l) => document.getElementById(l.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const inBand = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) inBand.set(e.target.id, e.isIntersecting);
        setActive(LINKS.find((l) => inBand.get(l.id))?.id ?? null);
      },
      { rootMargin: '-42% 0px -56% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!pointed.current) place(active);
  }, [active, place]);

  // Keep the needle on its link when the links reflow (the webfont arriving, a resize).
  useEffect(() => {
    const rail = needleRef.current?.parentElement;
    if (!rail) return;
    const replace = () => place(pointed.current ?? activeRef.current);
    const ro = new ResizeObserver(replace);
    ro.observe(rail);
    document.fonts?.ready.then(replace).catch(() => {});
    return () => ro.disconnect();
  }, [place]);

  // Switch to the night ground while a dark section passes under the bar: a band about 4% down the viewport.
  useEffect(() => {
    const nav = navRef.current;
    const dark = document.querySelectorAll('[data-nav-theme="dark"]');
    if (!nav || dark.length === 0) return;
    const under = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) under.add(e.target);
          else under.delete(e.target);
        }
        nav.dataset.scheme = under.size > 0 ? 'dark' : 'light';
      },
      { rootMargin: '-4% 0px -95% 0px' },
    );
    dark.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Take a solid ground once the page has scrolled: one rAF-throttled read, written straight to a data attribute.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let raf = 0;
    let scrolled: boolean | null = null;
    const read = () => {
      raf = 0;
      const next = window.scrollY > SCROLLED_AT;
      if (next !== scrolled) {
        scrolled = next;
        nav.dataset.scrolled = String(next);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // The phone sheet: focus moves in and is held between the sheet and its button; Esc closes;
  // the page beneath stops scrolling; widening the window to desktop closes it.
  useEffect(() => {
    if (!open) return;
    const button = menuButtonRef.current;
    const sheet = sheetRef.current;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    sheet?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        button?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'Tab' || !sheet || !button) return;
      const items = [button, ...sheet.querySelectorAll<HTMLElement>('a[href], button')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
      e.preventDefault();
      items[next]?.focus({ preventScroll: true });
    };
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const closeForLink = () => {
    // Let the page scroll before the browser follows the link.
    document.documentElement.style.overflow = '';
    setOpen(false);
  };

  const primary = signedIn
    ? { href: '/dashboard', label: 'Open Athena' }
    : { href: '/sign-in', label: 'Try the live demo' };

  return (
    <nav ref={navRef} className={n.nav} aria-label="Primary" data-scheme="light" data-open={open || undefined}>
      <div className={n.bar}>
        <Link href="/" className={n.brand} aria-label="Athena, home">
          <ViewTransition name="athena-wordmark" share="morph" default="none">
            <span className={n.wordmark}>Athena</span>
          </ViewTransition>
        </Link>

        <div className={n.rail} onPointerLeave={() => point(null)}>
          <ul className={n.links}>
            {LINKS.map((l) => (
              <li key={l.id}>
                <a
                  ref={(el) => {
                    linkRefs.current[l.id] = el;
                  }}
                  href={`#${l.id}`}
                  className={n.link}
                  aria-current={active === l.id ? 'location' : undefined}
                  onPointerEnter={() => point(l.id)}
                  onFocus={() => point(l.id)}
                  onBlur={() => point(null)}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <span ref={needleRef} className={n.needle} aria-hidden data-shown="false" />
        </div>

        <div className={n.actions}>
          {!signedIn && (
            <Link href="/sign-in" className={n.signIn}>
              Sign in
            </Link>
          )}
          <Link href={primary.href} className={n.cta}>
            {primary.label}
          </Link>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          className={n.menuButton}
          aria-expanded={open}
          aria-controls={sheetId}
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={n.burger} aria-hidden>
            <span />
            <span />
          </span>
        </button>
      </div>

      <div id={sheetId} ref={sheetRef} className={n.sheet} data-open={open || undefined} inert={!open}>
        <ul className={n.sheetLinks}>
          {LINKS.map((l, i) => (
            <li key={l.id} className={n.sheetItem} style={{ '--i': i } as CSSProperties}>
              <a href={`#${l.id}`} className={n.sheetLink} aria-current={active === l.id ? 'location' : undefined} onClick={closeForLink}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className={`${n.sheetItem} ${n.sheetActions}`} style={{ '--i': LINKS.length } as CSSProperties}>
          {!signedIn && (
            <Link href="/sign-in" className={n.sheetSignIn} onClick={closeForLink}>
              Sign in
            </Link>
          )}
          <Link href={primary.href} className={n.sheetCta} onClick={closeForLink}>
            {primary.label}
          </Link>
        </div>
      </div>
    </nav>
  );
}
