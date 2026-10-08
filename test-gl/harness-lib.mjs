// The pixel harness's pure parts, split out of run.js so `bun test` can hold them (harness-lib.test.js): the render memo,
// the seeded sample --verify draws, and the manifest's key. No browser, no filesystem — run.js hands them what it served.
import { createHash } from 'node:crypto';

// JSON with sorted keys, so two spellings of one input are one key. undefined (an absent opts) and null are the same absence.
export function canonicalJSON(v) {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  if (typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// `{}` and no opts at all are the same engine; so are overrides in another key order. Nothing else is folded together.
export const renderKey = (preset, overrides, frames, opts) => canonicalJSON([preset, overrides || {}, frames, opts || {}]);

// Within one run, the same (preset, overrides, frames, opts) is the same frame: that is exactly what the determinism rows prove,
// so the memo rests on a measured property, not a hope. `fresh` is the bypass for the rows whose MEANING is two independent engines
// of the same inputs ("reproduces"): a memo there would compare a frame with itself. It neither reads nor writes, so a fresh render
// can never stand in for a memoised one either. A failed render is dropped, not remembered.
export function createRenderMemo(run) {
  const seen = new Map();
  let hits = 0, misses = 0;
  return {
    async once(preset, overrides, frames, opts, { fresh = false } = {}) {
      if (fresh) return run(preset, overrides, frames, opts);
      const key = renderKey(preset, overrides, frames, opts);
      if (seen.has(key)) { hits++; return seen.get(key); }
      misses++;
      const r = await run(preset, overrides, frames, opts);
      seen.set(key, r);
      return r;
    },
    stats: () => ({ hits, misses }),
  };
}

// mulberry32: small, seedable, and the same on every machine — a --verify sample must be repeatable from the seed it printed.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n distinct items, a partial Fisher-Yates over a copy; the original order is not kept.
export function sampleRows(rows, n, seed) {
  const rnd = seededRandom(seed), pool = rows.slice(), out = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// The key is over what the run stood on: every byte the harness served (the set, sorted, not the order the browser asked in), and the
// things that are not served but decide a hash — run.js, harness.html, macros.js, the browser, the rasteriser, the launch flags, the machine.
export const manifestKey = (inputs, served) => createHash('sha256').update(canonicalJSON({ inputs, served: served.slice().sort(byPath) })).digest('hex');

// What moved between a manifest and the tree in front of us, in words — so a refusal says which file, not just "the key differs".
export function diffInputs(was, now) {
  const out = [];
  for (const k of new Set([...Object.keys(was.inputs), ...Object.keys(now.inputs)])) if (canonicalJSON(was.inputs[k]) !== canonicalJSON(now.inputs[k])) out.push(k);
  const w = new Map(was.served.map((s) => [s.path, s.sha256])), n = new Map(now.served.map((s) => [s.path, s.sha256]));
  for (const [p, h] of w) {
    if (!n.has(p)) out.push(`served ${p} no longer served`);
    else if (n.get(p) !== h) out.push(`served ${p} changed`);
  }
  for (const p of n.keys()) if (!w.has(p)) out.push(`served ${p} newly served`);
  return out;
}
