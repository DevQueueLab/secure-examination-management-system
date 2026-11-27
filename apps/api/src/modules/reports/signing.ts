import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { systemState } from '../../db/schema';
import { logger } from '../../lib/logger';

const STATE_KEY = 'report.signing_key';

/**
 * Canonical JSON: object keys sorted recursively, no whitespace. Postgres jsonb does not preserve key order,
 * so signatures are always computed over this form; offline verifiers must canonicalize the same way.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
  /** First 16 hex chars of SHA-256 over the SPKI DER: lets a verifier confirm which key signed. */
  keyId: string;
  source: 'env' | 'database';
}

function fromPrivatePem(pem: string, source: KeyPair['source']): KeyPair {
  const privateKey = createPrivateKey({ key: pem, format: 'pem' });
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('REPORT_SIGNING_KEY must be an Ed25519 key');
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: createHash('sha256').update(der).digest('hex').slice(0, 16),
    source,
  };
}

/**
 * Ed25519 signer for verifiable result reports. The private key comes from REPORT_SIGNING_KEY (base64 of a
 * PKCS8 PEM) or, when unset, is generated once and kept in system_state so every API instance shares it.
 */
export class ReportSigner {
  private keys: Promise<KeyPair> | null = null;

  constructor(
    private readonly db: Executor,
    private readonly envKey: string | undefined,
  ) {}

  private load(): Promise<KeyPair> {
    this.keys ??= this.resolve().catch((err) => {
      this.keys = null;
      throw err;
    });
    return this.keys;
  }

  private async resolve(): Promise<KeyPair> {
    if (this.envKey) {
      const pem = Buffer.from(this.envKey, 'base64').toString('utf8');
      return fromPrivatePem(pem.includes('BEGIN') ? pem : this.envKey, 'env');
    }
    const read = async () => {
      const [row] = await this.db.select().from(systemState).where(eq(systemState.key, STATE_KEY)).limit(1);
      const pem = row?.value?.privateKeyPem;
      return typeof pem === 'string' ? pem : null;
    };
    let pem = await read();
    if (!pem) {
      const { privateKey } = generateKeyPairSync('ed25519');
      const generated = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const pub = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
      // Two instances racing: the first insert wins and both then read the same key.
      await this.db
        .insert(systemState)
        .values({ key: STATE_KEY, value: { privateKeyPem: generated, publicKeyPem: pub, algorithm: 'Ed25519', createdAt: new Date().toISOString() } })
        .onConflictDoNothing();
      pem = await read();
      logger.info('generated a report signing key (set REPORT_SIGNING_KEY to manage it yourself)');
    }
    return fromPrivatePem(pem!, 'database');
  }

  async sign(payload: Record<string, unknown>): Promise<{ signature: string; keyId: string }> {
    const k = await this.load();
    const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), k.privateKey).toString('base64');
    return { signature, keyId: k.keyId };
  }

  async verify(payload: Record<string, unknown>, signature: string): Promise<boolean> {
    try {
      const k = await this.load();
      return verify(null, Buffer.from(canonicalJson(payload), 'utf8'), k.publicKey, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  async publicKey(): Promise<{ algorithm: 'Ed25519'; keyId: string; publicKeyPem: string }> {
    const k = await this.load();
    return { algorithm: 'Ed25519', keyId: k.keyId, publicKeyPem: k.publicKeyPem };
  }
}
