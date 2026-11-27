import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTIONS);
export const verifyPassword = (hashed: string, plain: string) => verify(hashed, plain).catch(() => false);

/** A precomputed hash so unknown emails take as long as wrong passwords (no user enumeration by timing). */
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (plain: string) => {
  dummyHash ??= hashPassword('athena-timing-equalizer');
  await verifyPassword(await dummyHash, plain);
};

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');
