/** A live arrival (an indicator from the socket): it drops in 12 px from above and settles with a slight give. */
export const ARRIVE_FROM = { opacity: 0, y: -12 } as const;
export const ARRIVE = {
  type: 'spring',
  bounce: 0.32,
  visualDuration: 0.38,
  opacity: { duration: 0.16 },
} as const;
