// Per-IP limits over a rolling hour (spec §5). Old rows are pruned as they are read.
import { and, count, eq, gt, lt } from 'drizzle-orm';
import type { Ctx } from './auth';
import type { Db } from './db/client';
import { rateEvents } from './db/schema';
import { ApiError } from './errors';

const WINDOW_MS = 3600 * 1000;

export const clientIp = (c: Ctx) => c.req.header('CF-Connecting-IP') ?? 'unknown';

export async function assertUnder(db: Db, ip: string, action: string, max: number, limit: string) {
  const now = Date.now();
  await db.delete(rateEvents).where(lt(rateEvents.at, now - WINDOW_MS));
  const [{ n }] = await db
    .select({ n: count() })
    .from(rateEvents)
    .where(and(eq(rateEvents.ip, ip), eq(rateEvents.action, action), gt(rateEvents.at, now - WINDOW_MS)));
  if (n >= max) throw new ApiError(429, `too many ${limit.replace(/([A-Z])/g, ' $1').toLowerCase()} from this address; try again later`, { limit });
}

export const recordEvent = (db: Db, ip: string, action: string) => db.insert(rateEvents).values({ ip, action, at: Date.now() });
