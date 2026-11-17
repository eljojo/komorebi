// Per-IP limits over a rolling hour (spec §5). Old rows are pruned as they are read.
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { Ctx } from './auth';
import type { Db } from './db/client';
import { rateEvents } from './db/schema';
import { ApiError } from './errors';

const WINDOW_MS = 3600 * 1000;

// What a limit counts by. IPv6 gives a person a whole /64 to rotate addresses in, so those count by their /64
// prefix; IPv4 stays per address. An IPv4-mapped IPv6 address is the IPv4 address it wraps.
export function ipKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('%')[0].split('::');
  const groups = (part: string) => (part ? part.split(':') : []);
  const first = groups(head);
  const padded = tail === undefined ? first : [...first, ...Array(Math.max(0, 8 - first.length - groups(tail).length)).fill('0'), ...groups(tail)];
  return `${padded.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

export const clientIp = (c: Ctx) => ipKey(c.req.header('CF-Connecting-IP') ?? 'unknown');

export async function assertUnder(db: Db, ip: string, action: string, max: number, limit: string) {
  const now = Date.now();
  await db.delete(rateEvents).where(lt(rateEvents.at, now - WINDOW_MS));
  const [{ n }] = await db
    .select({ n: count() })
    .from(rateEvents)
    .where(and(eq(rateEvents.ip, ip), eq(rateEvents.action, action), gt(rateEvents.at, now - WINDOW_MS)));
  if (n >= max) throw tooMany(limit);
}

export const recordEvent = (db: Db, ip: string, action: string) => db.insert(rateEvents).values({ ip, action, at: Date.now() });

// `assertUnder` reads a count and `recordEvent` writes later, so a burst of parallel requests can all pass the
// read. This is the event as a value that refuses itself: the time while the window has room, NULL once it is
// full. `at` is NOT NULL, so the insert fails when the limit is already reached, and a batch carrying it is
// rolled back whole. The count and the insert are one statement, which D1 runs atomically.
export function eventWithin(ip: string, action: string, max: number) {
  const now = Date.now();
  return sql<number>`(select ${now} where (select count(*) from rate_events where ip = ${ip} and action = ${action} and at > ${now - WINDOW_MS}) < ${max})`;
}

export const eventFull = (err: unknown) => /NOT NULL constraint failed: rate_events\.at/i.test(`${err} ${(err as { cause?: unknown })?.cause}`);

export const tooMany = (limit: string) =>
  new ApiError(429, `too many ${limit.replace(/([A-Z])/g, ' $1').toLowerCase()} from this address; try again later`, { limit });

// Records one event only while the limit has room; over it, the 429 the limit names.
export async function reserve(db: Db, ip: string, action: string, max: number, limit: string) {
  await db.delete(rateEvents).where(lt(rateEvents.at, Date.now() - WINDOW_MS));
  try {
    await db.insert(rateEvents).values({ ip, action, at: eventWithin(ip, action, max) });
  } catch (err) {
    if (eventFull(err)) throw tooMany(limit);
    throw err;
  }
}
