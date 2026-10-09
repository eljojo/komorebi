// The pixel harness's pure parts (test-gl/harness-lib.mjs). The renders need Chromium and are proven by a real run;
// what can silently go wrong without one is the memo's key (two inputs that are the same engine must collide, two
// that are not must not), the fresh bypass the "two independent engines" rows stand on, and the manifest's key.
import { describe, expect, test } from 'bun:test';
import { canonicalJSON, createRenderMemo, diffInputs, hashVerdict, manifestBodyProblems, manifestKey, renderKey, sampleRows, seededRandom } from './harness-lib.mjs';

describe('renderKey', () => {
  test('key order and an absent opts do not matter', () => {
    expect(renderKey('memories', { a: 1, b: 2 }, [8], undefined)).toBe(renderKey('memories', { b: 2, a: 1 }, [8], {}));
    expect(renderKey('memories', undefined, [8], null)).toBe(renderKey('memories', {}, [8], undefined));
  });
  test('every input that makes another engine makes another key', () => {
    const k = renderKey('park 1', { x: 1 }, [8], { rebake: true });
    expect(renderKey('park 2', { x: 1 }, [8], { rebake: true })).not.toBe(k);
    expect(renderKey('park 1', { x: 2 }, [8], { rebake: true })).not.toBe(k);
    expect(renderKey('park 1', { x: 1 }, [8, 9], { rebake: true })).not.toBe(k);
    expect(renderKey('park 1', { x: 1 }, [8], {})).not.toBe(k);
    expect(renderKey('park 1', { x: 1 }, [8], { rebake: true, from: { preset: 'memories' } })).not.toBe(k);
  });
  test('a number and its string are different inputs', () => {
    expect(canonicalJSON({ a: 1 })).not.toBe(canonicalJSON({ a: '1' }));
  });
});

describe('createRenderMemo', () => {
  const runner = () => {
    const calls = [];
    return { calls, run: async (...args) => { calls.push(args); return { n: calls.length }; } };
  };
  test('the second ask for the same inputs is a hit and returns the same object', async () => {
    const r = runner(), memo = createRenderMemo(r.run);
    const a = await memo.once('memories', {}, [8]);
    const b = await memo.once('memories', {}, [8], {});
    expect(b).toBe(a);
    expect(r.calls.length).toBe(1);
    expect(memo.stats()).toEqual({ hits: 1, misses: 1 });
  });
  test('other inputs miss', async () => {
    const r = runner(), memo = createRenderMemo(r.run);
    await memo.once('memories', {}, [8]);
    await memo.once('memories', { a: 1 }, [8]);
    await memo.once('memories', {}, [24]);
    expect(r.calls.length).toBe(3);
  });
  test('fresh neither reads nor writes: two independent engines stay two', async () => {
    const r = runner(), memo = createRenderMemo(r.run);
    const cached = await memo.once('park 1', {}, [8]);
    const a = await memo.once('park 1', {}, [8], undefined, { fresh: true });
    const b = await memo.once('park 1', {}, [8], undefined, { fresh: true });
    expect(a).not.toBe(cached);
    expect(b).not.toBe(a);
    expect(r.calls.length).toBe(3);
    expect(await memo.once('park 1', {}, [8])).toBe(cached);
    expect(memo.stats()).toEqual({ hits: 1, misses: 1 });
  });
  test('a failed render is not remembered', async () => {
    let n = 0;
    const memo = createRenderMemo(async () => { if (n++ === 0) throw new Error('boom'); return { ok: true }; });
    await expect(memo.once('a', {}, [8])).rejects.toThrow('boom');
    expect(await memo.once('a', {}, [8])).toEqual({ ok: true });
  });
});

describe('seededRandom / sampleRows', () => {
  test('the same seed gives the same sample, another seed another', () => {
    const rows = Array.from({ length: 140 }, (_, i) => ({ name: `r${i}` }));
    const a = sampleRows(rows, 15, 7), b = sampleRows(rows, 15, 7), c = sampleRows(rows, 15, 8);
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name));
    expect(a.map((r) => r.name)).not.toEqual(c.map((r) => r.name));
  });
  test('distinct rows, never more than there are', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `r${i}` }));
    expect(new Set(sampleRows(rows, 15, 1).map((r) => r.name)).size).toBe(5);
    expect(new Set(sampleRows(Array.from({ length: 140 }, (_, i) => i), 15, 3)).size).toBe(15);
  });
  test('seededRandom is in [0, 1) and repeatable', () => {
    const r = seededRandom(42), s = seededRandom(42);
    for (let i = 0; i < 50; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); expect(s()).toBe(v); }
  });
});

describe('manifestKey / diffInputs', () => {
  const inputs = () => ({ runJs: 'aa', harnessHtml: 'bb', macrosJs: 'cc', browser: 'Chrome/1', renderer: 'SwiftShader', args: ['--x'], platform: 'darwin', arch: 'arm64' });
  const served = () => [{ path: '/komorebi.js', sha256: '11' }, { path: '/presets.js', sha256: '22' }];
  test('the key is stable and moves with any served byte, any input', () => {
    const k = manifestKey(inputs(), served());
    expect(manifestKey(inputs(), served())).toBe(k);
    expect(manifestKey(inputs(), served().reverse())).toBe(k);   // the set, not the order the browser asked in
    const s = served(); s[1].sha256 = '23';
    expect(manifestKey(inputs(), s)).not.toBe(k);
    expect(manifestKey(inputs(), served().slice(0, 1))).not.toBe(k);
    expect(manifestKey({ ...inputs(), browser: 'Chrome/2' }, served())).not.toBe(k);
    expect(manifestKey({ ...inputs(), arch: 'x64' }, served())).not.toBe(k);
  });
  test('diffInputs names what moved', () => {
    const was = { inputs: inputs(), served: served() };
    expect(diffInputs(was, { inputs: inputs(), served: served() })).toEqual([]);
    const now = { inputs: { ...inputs(), runJs: 'zz' }, served: [{ path: '/komorebi.js', sha256: '12' }, { path: '/new.js', sha256: '33' }] };
    const d = diffInputs(was, now);
    expect(d).toContain('runJs');
    expect(d).toContain('served /komorebi.js changed');
    expect(d).toContain('served /presets.js no longer served');
    expect(d).toContain('served /new.js newly served');
  });
});

describe('hashVerdict / manifestBodyProblems — what --verify holds the rows to, since the key does not cover them', () => {
  test('each kind of row, from its hashes alone', () => {
    expect(hashVerdict({ pin: 'aa' }, { a: 'aa' })).toBe(true);
    expect(hashVerdict({ pin: 'aa' }, { a: 'bb' })).toBe(false);
    expect(hashVerdict({}, { a: 'aa', b: 'aa' })).toBe(true);
    expect(hashVerdict({}, { a: 'aa', b: 'bb' }), 'a byte-identical row whose frames differ fails, whatever the manifest says').toBe(false);
    expect(hashVerdict({ known: 'why' }, { a: 'aa', b: 'bb' })).toBe(true);
    expect(hashVerdict({ differ: true }, { a: 'aa', b: 'aa' }), 'a live row whose frames match fails').toBe(false);
    expect(hashVerdict({ lit: [0.5, 2] }, { a: 'aa', b: 'bb' })).toBe(true);
    expect(hashVerdict({ near: 3 }, { a: 'aa', b: 'bb' }), 'pixels decide a continuity row, not hashes').toBe(null);
  });
  const green = () => ({ failures: 0, cases: 3, rows: [{ suite: 'gate', name: 'g1', pass: true }, { suite: 'gate', name: 'g2', pass: true }, { suite: 'fill', name: 'f', pass: true }] });
  test('a full, green run has no problems', () => expect(manifestBodyProblems(green(), ['g1', 'g2'])).toEqual([]));
  test('a failing row with failures hand-set to 0 is refused', () => {
    const m = green(); m.rows[0].pass = false;
    expect(manifestBodyProblems(m, ['g1', 'g2']).join('\n')).toContain('g1');
  });
  test('dropped rows are refused: by the count, and by the gate rows this run.js defines', () => {
    const m = green(); m.rows.splice(1, 1);
    const p = manifestBodyProblems(m, ['g1', 'g2']).join('\n');
    expect(p).toContain('cases says 3');
    expect(p).toContain('missing');
    m.cases = 2;
    expect(manifestBodyProblems(m, ['g1', 'g2']).join('\n')).toContain('g2');
  });
});
