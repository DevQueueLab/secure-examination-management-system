import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const hmac = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('hex');

// Crockford base32 without ambiguous characters (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
/** Human-friendly verification code, e.g. ATH-7F3K-9QX2-M4TD (60 bits of entropy). */
export const verificationCode = () => `ATH-${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
