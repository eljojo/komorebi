import { sql } from 'drizzle-orm';
import type { Ctx } from '../auth';
import { ApiError } from '../errors';
import { randomBase64Url } from '../random';

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const isVisibility = (v: unknown): v is Visibility => VISIBILITIES.includes(v as Visibility);

// The request body as the sender wrote it, and parsed. Callers that must keep a member verbatim cut it from `text`.
export async function readJsonBody(c: Ctx): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = await c.req.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'the body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError(400, 'the body must be a JSON object');
  return { text, body: body as Record<string, unknown> };
}

// An id or version number in a path. Anything else is simply not found.
export function parseId(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
}

// The columns that change when someone sets a visibility. Every transition *into* unlisted draws a new share
// token, so a link from an earlier unlisted period stays dead. The CASE reads the row as it was, so the draw
// happens in the same statement as the change and setting unlisted on an unlisted look keeps its link.
export const visibilityChange = (visibility: Visibility) => ({
  visibility,
  ...(visibility === 'unlisted' && {
    shareToken: sql<string>`case when visibility = 'unlisted' then share_token else ${randomBase64Url(16)} end`,
  }),
});
