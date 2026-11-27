/**
 * SHA-256 hash chain over the sealed offline journal, so reordering, editing or dropping an entry is detectable.
 *
 *   h0 = sha256(attemptId + "|" + sealedAt)
 *   hN = sha256(h(N-1) + "|" + canonicalJson(entryN))      (hex)
 *
 * canonicalJson sorts object keys recursively and drops undefined values, matching the API's canonicalJson.
 */

export function canonicalJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .filter((k) => obj[k] !== undefined)
          .map((k) => [k, sortKeys(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns undefined where WebCrypto is unavailable (insecure origin); the journal is still accepted without it. */
export async function journalChain(attemptId: string, sealedAt: string, entries: unknown[]): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    let hash = await sha256Hex(`${attemptId}|${sealedAt}`);
    for (const entry of entries) hash = await sha256Hex(`${hash}|${canonicalJson(entry)}`);
    return hash;
  } catch {
    return undefined;
  }
}
