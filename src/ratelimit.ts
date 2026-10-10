// Per-IP limits over a rolling hour (spec §5). Old rows are pruned as they are read.
import { and, count, eq, gt, lt } from 'drizzle-orm';
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
  if (n >= max) throw new ApiError(429, `too many ${limit.replace(/([A-Z])/g, ' $1').toLowerCase()} from this address; try again later`, { limit });
}

export const recordEvent = (db: Db, ip: string, action: string) => db.insert(rateEvents).values({ ip, action, at: Date.now() });
