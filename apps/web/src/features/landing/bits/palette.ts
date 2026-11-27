/**
 * Athena's warm palette, used as the colour defaults of every React Bits adaptation in this folder.
 * No React import, so server components can read it too.
 */
export const ATHENA = {
  /** Near-black page ground. */
  ink: '#0A0A0B',
  carmine: '#9C1220',
  /** Red-orange glow. */
  glow: '#E8432E',
  gold: '#F2DFA7',
  wine: '#6E1A22',
  /** Warm light, for text on dark grounds. */
  light: '#FFF4E6',
  marble: '#EEF0F2',
} as const;

export type AthenaColour = (typeof ATHENA)[keyof typeof ATHENA];
