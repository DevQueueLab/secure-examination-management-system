import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_ASSETS, HERO_LOOP, type BrandAssetKey, type HeroLoop, type ResolvedImage } from './brand-assets';

const PUBLIC_DIR = join(process.cwd(), 'public');
const has = (url: string) => existsSync(join(PUBLIC_DIR, url));

/** Width and height from a WebP file's header (VP8, VP8L or VP8X), so a client file of any size lays out without a shift. */
function webpSize(url: string): { width: number; height: number } | null {
  let fd: number | null = null;
  try {
    fd = openSync(join(PUBLIC_DIR, url), 'r');
    const b = Buffer.alloc(30);
    readSync(fd, b, 0, 30, 0);
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Resolves one picture from public/brand, or null when its file is missing, so the page leaves it out. */
export function resolveBrandImage(key: BrandAssetKey): ResolvedImage | null {
  const spec = BRAND_ASSETS[key];
  const base = `/brand/${spec.client}`;
  const webp1600 = `${base}-1600.webp`;
  if (!has(webp1600) || !has(`${base}-960.webp`)) return null;
  const size = webpSize(webp1600) ?? { width: spec.width, height: spec.height };
  const w960 = Math.round((size.width / Math.max(size.width, size.height)) * 960);
  const sources: ResolvedImage['sources'] = [];
  if (has(`${base}-1600.avif`) && has(`${base}-960.avif`)) sources.push({ type: 'image/avif', srcSet: `${base}-960.avif ${w960}w, ${base}-1600.avif ${size.width}w` });
  sources.push({ type: 'image/webp', srcSet: `${base}-960.webp ${w960}w, ${webp1600} ${size.width}w` });
  return { key, src: webp1600, sources, width: size.width, height: size.height, alt: spec.alt, blend: spec.blend };
}

export function resolveBrandImages<K extends BrandAssetKey>(keys: readonly K[]): Record<K, ResolvedImage | null> {
  return Object.fromEntries(keys.map((k) => [k, resolveBrandImage(k)])) as Record<K, ResolvedImage | null>;
}

/** The hero's moving picture, when the client has delivered it (WebM first, MP4 for Safari). */
export function resolveHeroLoop(): HeroLoop | null {
  const webm = has(HERO_LOOP.webm) ? HERO_LOOP.webm : null;
  const mp4 = has(HERO_LOOP.mp4) ? HERO_LOOP.mp4 : null;
  return webm || mp4 ? { webm, mp4 } : null;
}
