import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config';
import { rateEvents, users } from '../src/db/schema';
import { ipKey } from '../src/ratelimit';
import { Authenticator } from './authenticator';
import { Browser, db } from './helpers';

const run = crypto.randomUUID().slice(0, 6);
let seq = 0;
const newName = () => `r-${run}-${++seq}`;

const events = async (ip: string, action: string) =>
  (await db.select().from(rateEvents).where(and(eq(rateEvents.ip, ipKey(ip)), eq(rateEvents.action, action)))).length;

// D1 binds at most 100 values per statement, so a full window is seeded by one recursive insert.
const fillWindow = (ip: string, action: string, n: number) =>
  env.DB.prepare(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ?1) INSERT INTO rate_events (ip, action, at) SELECT ?2, ?3, ?4 FROM s`)
    .bind(n, ipKey(ip), action, Date.now())
    .run();

// Browsers that share one address, so they share its limits.
function sharing(n: number) {
  const first = new Browser();
  return Array.from({ length: n }, (_, i) => {
    const b = i === 0 ? first : new Browser();
    b.ip = first.ip;
    return b;
  });
}

describe('starting a ceremony counts against one hourly limit per address', () => {
  it('is 60 an hour, in LIMITS beside the others', () => {
    expect(LIMITS.ceremoniesPerHour).toBe(60);
  });

  it('counts each of register-options, login-options and add-passkey-options when issued', async () => {
    const b = new Browser();
    await b.call('POST', '/api/auth/login-options');
    expect(await events(b.ip, 'ceremony')).toBe(1);

    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    expect(await events(b.ip, 'ceremony')).toBe(2);
    await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });
    await b.call('POST', '/api/auth/add-passkey-options');
    expect(await events(b.ip, 'ceremony')).toBe(3);
  });

  it('does not count a start that is refused before anything is issued', async () => {
    const b = new Browser();
    expect((await b.call('POST', '/api/auth/register-options', { json: { username: 'no' } })).status).toBe(400);
    expect(await events(b.ip, 'ceremony')).toBe(0);
  });

  it.each(['/api/auth/login-options', '/api/auth/register-options'])('refuses %s with a 429 once the hour is used up', async (path) => {
    const b = new Browser();
    await fillWindow(b.ip, 'ceremony', LIMITS.ceremoniesPerHour);
    const r = await b.call('POST', path, { json: { username: newName() } });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ limit: 'ceremonyStarts' });
  });

  it('refuses add-passkey-options too, for a signed-in person', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });
    await fillWindow(b.ip, 'ceremony', LIMITS.ceremoniesPerHour);
    expect((await b.call('POST', '/api/auth/add-passkey-options')).status).toBe(429);
  });

  it('counts by IPv6 /64, however the address is spelled', async () => {
    const b = new Browser();
    b.ip = '2001:db8:7:1:1::1';
    await fillWindow(b.ip, 'ceremony', LIMITS.ceremoniesPerHour);
    b.ip = '2001:DB8:7:1:ffff:ffff:ffff:ffff';
    expect((await b.call('POST', '/api/auth/login-options')).status).toBe(429);
    b.ip = '2001:db8:7:2::1';
    expect((await b.call('POST', '/api/auth/login-options')).status).toBe(200);
  });

  it('holds exactly at the boundary under a parallel burst', async () => {
    const burst = sharing(LIMITS.ceremoniesPerHour + 15);
    const statuses = (await Promise.all(burst.map((b) => b.call('POST', '/api/auth/login-options')))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMITS.ceremoniesPerHour);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    expect(await events(burst[0].ip, 'ceremony')).toBe(LIMITS.ceremoniesPerHour);
  });
});

describe('completed sign-ups are atomic against their limit', () => {
  it('lets exactly the limit through a parallel burst, and creates no user for the rest', async () => {
    const burst = sharing(LIMITS.signupsPerHour + 4);
    const attempts = await Promise.all(
      burst.map(async (b) => {
        const username = newName();
        const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
        expect(options.status, options.text).toBe(200);
        return { b, username, credential: await new Authenticator().create(options.json) };
      }),
    );
    const replies = await Promise.all(attempts.map((a) => a.b.call('POST', '/api/auth/register', { json: { credential: a.credential } })));

    expect(replies.filter((r) => r.status === 201)).toHaveLength(LIMITS.signupsPerHour);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(4);
    expect(replies.find((r) => r.status === 429)!.json).toMatchObject({ limit: 'signups' });
    expect(await events(burst[0].ip, 'signup')).toBe(LIMITS.signupsPerHour);
    for (const [i, a] of attempts.entries()) {
      const made = (await db.select().from(users).where(eq(users.username, a.username))).length;
      expect(made, a.username).toBe(replies[i].status === 201 ? 1 : 0);
    }
  });
});

describe('failed logins are recorded atomically against their limit', () => {
  it('records no more than the limit under a parallel burst, and answers the surplus 429', async () => {
    const burst = sharing(LIMITS.failedLoginsPerHour + 8);
    const stranger = new Authenticator();
    await stranger.create({ challenge: 'x', user: { id: 'x' } });
    const attempts = await Promise.all(
      burst.map(async (b) => {
        const options = await b.call('POST', '/api/auth/login-options');
        expect(options.status, options.text).toBe(200);
        return { b, credential: await stranger.get(options.json) };
      }),
    );
    const replies = await Promise.all(attempts.map((a) => a.b.call('POST', '/api/auth/login', { json: { credential: a.credential } })));

    expect(replies.filter((r) => r.status === 401)).toHaveLength(LIMITS.failedLoginsPerHour);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(8);
    expect(await events(burst[0].ip, 'failed-login')).toBe(LIMITS.failedLoginsPerHour);
  });
});
