/**
 * Every picture on the public pages, in one place.
 *
 * Each object exists as two twins with an identical silhouette and framing: a marble twin on pure white
 * (multiplied onto the light grounds) and a glass twin lit from inside on pure black (screened onto the dark
 * grounds). The files live in public/brand as <client>-960.avif, <client>-1600.webp and so on.
 *
 * The server checks for each file on every request (see brand-assets.server.ts). A missing file leaves that
 * picture off the page rather than breaking it.
 */

export interface AssetSpec {
  /** The file stem in public/brand. */
  client: string;
  /** Size of the 1600 rendition, used only if the file's own header cannot be read. */
  width: number;
  height: number;
  /** screen: a glass twin on black, for dark grounds. multiply: a marble twin on white, for light grounds. */
  blend: 'screen' | 'multiply';
  alt: string;
}

export const BRAND_ASSETS = {
  /** Hero: the helmeted bust, left half polished, right half fluted like a Doric column, screened over the lettering. */
  athenaGlass: {
    client: 'athena-glass',
    width: 1280,
    height: 1600,
    blend: 'screen',
    alt: 'A helmeted bust of Athena in glass, lit from inside in carmine and amber, its right half fluted like a Doric column',
  },
  /** Sign-in, light theme. */
  athenaMarble: {
    client: 'athena-marble',
    width: 1280,
    height: 1600,
    blend: 'multiply',
    alt: 'A helmeted bust of Athena in white marble, its right half fluted like a Doric column',
  },
  /** Hero on the light ground: the marble bust cut out of its white ground, so the security tape can pass behind her. */
  athenaMarbleCut: {
    client: 'athena-marble-cut',
    width: 1280,
    height: 1600,
    blend: 'multiply',
    alt: 'A helmeted bust of Athena in white marble, wrapped in carmine security tape',
  },
  owlMarble: { client: 'owl-marble', width: 1280, height: 1600, blend: 'multiply', alt: 'Athena’s owl in white marble' },
  owlGlass: { client: 'owl-glass', width: 1280, height: 1600, blend: 'screen', alt: 'Athena’s owl in glass, lit from inside' },
  helmetMarble: { client: 'helmet-marble', width: 1280, height: 1600, blend: 'multiply', alt: 'A Corinthian helmet in white marble' },
  helmetGlass: { client: 'helmet-glass', width: 1280, height: 1600, blend: 'screen', alt: 'A Corinthian helmet in glass, lit from inside' },
  amphoraMarble: { client: 'amphora-marble', width: 1280, height: 1600, blend: 'multiply', alt: 'A Panathenaic prize amphora in white marble' },
  amphoraGlass: { client: 'amphora-glass', width: 1280, height: 1600, blend: 'screen', alt: 'A Panathenaic prize amphora in glass, lit from inside' },
  shieldMarble: { client: 'shield-marble', width: 1280, height: 1600, blend: 'multiply', alt: 'A round shield with an owl emblem, in white marble' },
  shieldGlass: { client: 'shield-glass', width: 1280, height: 1600, blend: 'screen', alt: 'A round shield with an owl emblem, in glass, with a hexagonal lattice of light inside' },
  /** Closing section: the Parthenon in glass in the left 60%, the right 40% left for text. */
  parthenonGlass: {
    client: 'parthenon-glass',
    width: 1600,
    height: 900,
    blend: 'screen',
    alt: 'The Parthenon in glass, lit from inside in carmine and amber',
  },
  /** Closing section: a laurel wreath in glass, set behind the glass A. */
  laurelGlass: { client: 'laurel-glass', width: 1600, height: 1600, blend: 'screen', alt: 'A laurel wreath in glass, lit from inside' },
  /** Showcase: a fluted column in glass beneath the staircase of stages. */
  columnGlass: { client: 'column-glass', width: 1067, height: 1600, blend: 'screen', alt: 'A fluted Doric column in glass, lit from inside' },
} satisfies Record<string, AssetSpec>;

export type BrandAssetKey = keyof typeof BRAND_ASSETS;

/** The glass bust as a moving picture: a 4:5 muted ping-pong loop. Its still (athenaGlass) is the poster. */
export const HERO_LOOP = { webm: '/brand/athena-glass.webm', mp4: '/brand/athena-glass.mp4' } as const;

export interface HeroLoop {
  webm: string | null;
  mp4: string | null;
}

/** What the page receives for one picture, already resolved on the server. */
export interface ResolvedImage {
  key: BrandAssetKey;
  /** Fallback src for <img> (largest webp). */
  src: string;
  /** <source> entries, most efficient first. */
  sources: { type: string; srcSet: string }[];
  width: number;
  height: number;
  alt: string;
  blend: 'screen' | 'multiply';
}
