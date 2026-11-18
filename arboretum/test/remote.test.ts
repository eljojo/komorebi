import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { makeToken, makeUser, sessionFor } from './helpers';

const ORIGIN = 'https://arboretum.test';

// A socket into the room as a browser opens one: the session cookie, the site's own Origin, the upgrade.
async function connect(cookie: string | null, query: string, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { Upgrade: 'websocket', Origin: ORIGIN, ...headers };
  if (cookie) h.Cookie = `__Host-session=${cookie}`;
  return exports.default.fetch(new Request(`${ORIGIN}/api/remote?${query}`, { headers: h }));
}

// The socket's side of the conversation: every message it has heard, and a way to wait for the next that matches.
async function open(cookie: string, query: string) {
  const res = await connect(cookie, query);
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const heard: any[] = [];
  const waiting: { test: (m: any) => boolean; done: (m: any) => void }[] = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data as string);
    heard.push(m);
    for (const w of [...waiting]) if (w.test(m)) { waiting.splice(waiting.indexOf(w), 1); w.done(m); }
  });
  ws.accept();
  const next = (test: (m: any) => boolean) =>
    new Promise<any>((done, fail) => {
      const seen = heard.find(test);
      if (seen) { heard.splice(heard.indexOf(seen), 1); return done(seen); }
      waiting.push({ test, done: (m) => { heard.splice(heard.indexOf(m), 1); done(m); } });
      setTimeout(() => fail(new Error('nothing heard')), 2000);
    });
  return { ws, heard, next, send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)) };
}

const screenQuery = (id: string, label = 'the wall') => `role=screen&screen=${id}&label=${encodeURIComponent(label)}`;

describe('GET /api/remote', () => {
  it('is for a person in a browser: no cookie is a 401, a token is a 403', async () => {
    expect((await connect(null, 'role=remote')).status).toBe(401);
    const token = await makeToken(await makeUser());
    expect((await connect(null, 'role=remote', { Authorization: `Bearer ${token}` })).status).toBe(403);
  });

  it('refuses a socket opened from another site', async () => {
    const cookie = await sessionFor(await makeUser());
    const res = await connect(cookie, 'role=remote', { Origin: 'https://elsewhere.example' });
    expect(res.status).toBe(403);
  });

  it('refuses a request that is not an upgrade, a role it does not know, and a screen without a good id', async () => {
    const cookie = await sessionFor(await makeUser());
    const plain = await exports.default.fetch(new Request(`${ORIGIN}/api/remote?role=remote`, { headers: { Origin: ORIGIN, Cookie: `__Host-session=${cookie}` } }));
    expect(plain.status).toBe(400);
    expect((await connect(cookie, 'role=boss')).status).toBe(400);
    expect((await connect(cookie, 'role=screen&screen=short')).status).toBe(400);
  });
});

describe('the room', () => {
  it('tells a remote the screens, relays both ways once one is picked, and asks the screen for its board', async () => {
    const user = await makeUser();
    const screen = await open(await sessionFor(user), screenQuery('wall-0001'));
    const remote = await open(await sessionFor(user), 'role=remote');
    const listed = await remote.next((m) => m.t === 'screens');
    expect(listed.screens).toEqual([{ id: 'wall-0001', label: 'the wall', since: expect.any(Number) }]);

    remote.send({ t: 'pick', screen: 'wall-0001' });
    await screen.next((m) => m.t === 'want');
    expect(await screen.next((m) => m.t === 'remotes' && m.n === 1)).toEqual({ t: 'remotes', n: 1 });

    remote.send({ t: 'step', dir: 1 });
    expect(await screen.next((m) => m.t === 'step')).toEqual({ t: 'step', dir: 1 });
    screen.send({ t: 'state', look: { name: 'memories' } });
    expect(await remote.next((m) => m.t === 'state')).toEqual({ t: 'state', look: { name: 'memories' } });
  });

  it('keeps each person in a room of their own', async () => {
    const a = await makeUser(), b = await makeUser();
    await open(await sessionFor(a), screenQuery('wall-aaaa'));
    const theirs = await open(await sessionFor(b), 'role=remote');
    expect((await theirs.next((m) => m.t === 'screens')).screens).toEqual([]);
    theirs.send({ t: 'pick', screen: 'wall-aaaa' });
    theirs.send({ t: 'step', dir: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(theirs.heard.filter((m) => m.t !== 'screens')).toEqual([]);
  });

  it('sends nothing on from a remote that has not picked a screen', async () => {
    const user = await makeUser();
    const screen = await open(await sessionFor(user), screenQuery('wall-0002'));
    const remote = await open(await sessionFor(user), 'role=remote');
    await remote.next((m) => m.t === 'screens');
    remote.send({ t: 'step', dir: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.heard.filter((m) => m.t === 'step')).toEqual([]);
  });

  it('takes a reloaded screen back under its id, and the remote that had it asks again for its board', async () => {
    const user = await makeUser();
    const first = await open(await sessionFor(user), screenQuery('wall-0003'));
    const remote = await open(await sessionFor(user), 'role=remote');
    await remote.next((m) => m.t === 'screens');
    remote.send({ t: 'pick', screen: 'wall-0003' });
    await first.next((m) => m.t === 'want');
    const closed = new Promise<number>((done) => first.ws.addEventListener('close', (e) => done(e.code)));

    const second = await open(await sessionFor(user), screenQuery('wall-0003'));
    expect(await closed).toBe(4000);
    await second.next((m) => m.t === 'want');
    remote.send({ t: 'reseed' });
    expect(await second.next((m) => m.t === 'reseed')).toEqual({ t: 'reseed' });
  });

  it('tells the remotes when a screen leaves, and the screen when its remote does', async () => {
    const user = await makeUser();
    const screen = await open(await sessionFor(user), screenQuery('wall-0004'));
    const remote = await open(await sessionFor(user), 'role=remote');
    await remote.next((m) => m.t === 'screens');
    remote.send({ t: 'pick', screen: 'wall-0004' });
    await screen.next((m) => m.t === 'remotes' && m.n === 1);
    remote.ws.close(1000);
    expect(await screen.next((m) => m.t === 'remotes')).toEqual({ t: 'remotes', n: 0 });

    const again = await open(await sessionFor(user), 'role=remote');
    await again.next((m) => m.t === 'screens' && m.screens.length === 1);
    screen.ws.close(1000);
    expect((await again.next((m) => m.t === 'screens')).screens).toEqual([]);
  });
});

describe('/arboretum/remote', () => {
  it('asks a visitor who is not signed in to sign in first', async () => {
    const r = await exports.default.fetch(new Request(`${ORIGIN}/arboretum/remote`));
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain('/arboretum/login');
    expect(text).not.toContain('/arboretum/js/remote.js');
  });

  it('gives a person signed in the remote', async () => {
    const user = await makeUser();
    const r = await exports.default.fetch(new Request(`${ORIGIN}/arboretum/remote`, { headers: { Cookie: `__Host-session=${await sessionFor(user)}` } }));
    const text = await r.text();
    expect(text).toContain('/arboretum/js/remote.js');
    expect(text).toContain(user.username);
  });
});
