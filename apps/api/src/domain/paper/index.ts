/**
 * Paper engine (IC-5.2): draws, balances and prepares each candidate's paper from a seed, and simulates the
 * papers an exam can produce for the fairness report. Pure functions only; no database access.
 */
export { assemblePaper } from './assemble';
export { estimateP, expectedMarks, PRIOR_WEIGHT } from './difficulty';
export { isPool, MAX_BALANCE_SWAPS, selectPaper } from './select';
export { simulatePapers, type PaperSimulation } from './simulate';
export type * from './types';
