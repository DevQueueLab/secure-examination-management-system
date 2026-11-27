import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(4901),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url().default('http://localhost:3900'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  LEDGER_SECRET: z.string().min(16),
  /** Optional Ed25519 private key (PKCS8 PEM, base64-encoded) for signing result reports. */
  REPORT_SIGNING_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  GEMINI_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  GEMINI_MODEL: z.string().optional().transform((v) => v?.trim() || 'gemini-3.8-flash'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
