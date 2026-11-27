import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * Minimal Gemini client (REST + fetch, structured JSON output). The key travels only in the request header and
 * is never logged; prompts and responses are never logged either. Every failure becomes one plain 502.
 */

export class AssistUnavailableError extends AppError {
  constructor(message = 'Suggestions are unavailable right now. Try again in a moment.') {
    super(502, 'ASSIST_UNAVAILABLE', message);
  }
}

export const assistEnabled = (): boolean => !!env.GEMINI_API_KEY;

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface Usage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const envelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }).passthrough()).optional() }).passthrough().optional(),
        finishReason: z.string().optional(),
      }).passthrough(),
    )
    .min(1),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), totalTokenCount: z.number().optional() })
    .passthrough()
    .optional(),
}).passthrough();

export async function generateJson<S extends z.ZodTypeAny>(opts: {
  system: string;
  prompt: string;
  /** Gemini responseSchema (OpenAPI subset). */
  schema: Record<string, unknown>;
  validate: S;
  maxOutputTokens?: number;
}): Promise<{ data: z.infer<S>; usage: Usage; model: string }> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new AssistUnavailableError('Suggestions are not set up on this server.');
  const model = env.GEMINI_MODEL;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
    },
  });
  // One 20 s budget covers the call and a single retry on a transient provider error.
  const signal = AbortSignal.timeout(20_000);
  const started = Date.now();
  let res: Response;
  try {
    const call = () =>
      fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body,
        signal,
      });
    res = await call();
    if ([500, 502, 503, 504].includes(res.status) && Date.now() - started < 8_000) {
      logger.warn({ assist: { model, failure: 'status', status: res.status, retry: true } }, 'assist provider call failed');
      res = await call();
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logger.warn({ assist: { model, failure: timedOut ? 'timeout' : 'network' } }, 'assist provider call failed');
    throw new AssistUnavailableError(timedOut ? 'The suggestion took too long. Try again.' : undefined);
  }

  if (!res.ok) {
    logger.warn({ assist: { model, failure: 'status', status: res.status } }, 'assist provider call failed');
    throw new AssistUnavailableError();
  }

  const envelope = envelopeSchema.safeParse(await res.json().catch(() => null));
  if (!envelope.success) throw new AssistUnavailableError();
  const parts = envelope.data.candidates[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    logger.warn({ assist: { model, failure: 'json', finishReason: envelope.data.candidates[0]?.finishReason } }, 'assist provider returned unusable output');
    throw new AssistUnavailableError();
  }
  const data = opts.validate.safeParse(raw);
  if (!data.success) {
    logger.warn({ assist: { model, failure: 'shape' } }, 'assist provider returned unusable output');
    throw new AssistUnavailableError();
  }

  const u = envelope.data.usageMetadata;
  return {
    data: data.data,
    model,
    usage: { promptTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0, totalTokens: u?.totalTokenCount ?? 0 },
  };
}
