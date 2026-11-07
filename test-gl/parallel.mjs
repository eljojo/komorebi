// The exporter's --jobs N, as pure logic (no browser, no ffmpeg, no files): which segments are left, which integrator states the CPU-only pass must record so each can
// start alone, and the pool that renders them N at a time. render-video.mjs wires these to Chromium and ffmpeg; parallel.test.mjs holds them with fakes.
//
// WHY SEGMENTS CAN BE PARALLEL. A segment's frames are a function of the look, the clock and the integrator state (springs, wind, drift phase) it starts from. In a serial render that
// state arrives in-session from the segment before; here a tiny 64x36 engine (video.html cheapPreroll: the CPU half of the engine does not know the GPU exists) integrates the
// whole timeline first and writes the state at every start the todo segments need, as the same ckpt/ckpt_<pump>.json files the serial path reads.

import { isDeepStrictEqual } from 'node:util';

// What the tiny engine overrides (video.html's cheapPreroll applies the same three to the look). Every playlist event's params must carry them too: with the look's own sizes
// transitionTo would see a structural difference against the tiny engine's current params and take the cloud-dissolve route instead of the morph.
export const TINY_QUALITY = { bake_resolution: 256, tex_resolution: 256, sample_count: 8 };
export const tinyEvents = (events) => events.map((e) => ({ ...e, params: { ...e.params, ...TINY_QUALITY } }));

export const MIN_JOBS = 1, MAX_JOBS = 8;
// '--jobs' as typed: undefined (not given) is 1; anything but a whole number in 1..8 is a one-line refusal
export function parseJobs(raw) {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw)) || n < MIN_JOBS || n > MAX_JOBS) throw new Error(`--jobs ${raw}: expected a whole number from ${MIN_JOBS} to ${MAX_JOBS} (one Chromium session each; the default is 1)`);
  return n;
}

// The segments to render, ascending. A segment is done by its OWN files plus the checkpoint it starts from (isDone says both): holes are redone, nothing else is.
// (--jobs 1 keeps firstTodoSeg: a contiguous finished prefix, everything after the first hole redone.)
export const todoSegments = ({ nSegs, isDone }) => Array.from({ length: nSegs }, (_, i) => i).filter((i) => !isDone(i));

// ---- where a segment may start from ----
// A single look is at rest everywhere: a segment starts from the state at its own first pump.
// A playlist is not: a fade in flight is not restorable state. After pump n the engine is IN a fade when some fade k has start_k <= n < land_k (the event is applied before pump start,
// the landing's state is taken after pump land). At rest, a segment starts from its own pump too (nothing to replay); inside fade k it starts from pump start_k - 1, the last pump at
// rest before that fade, and replays up to the segment unrecorded (at most one crossfade). `stop` is the look the engine is on at the restore point: that of the latest landing at or before it.
export function restorePoint({ from, schedule, preroll }) {
  const fade = schedule.find((e) => e.start <= from && from < e.land);
  const at = fade ? fade.start - 1 : from;
  let stop = 0;
  for (const e of schedule) if (e.land <= at) stop = e.stop;   // schedule is in time order
  return { at: Math.max(at, preroll), stop, replay: from - Math.max(at, preroll) };
}

// What the tiny pass must hand back. snapshotAt: the pumps whose state starts a todo segment (every segment's first pump for a single look; the restore points for a playlist);
// landings: a playlist's fade landings up to the last such pump, so a later --jobs 1 resume (segmentCheckpointed wants every landing up to a done segment's end) finds them.
// upTo: how far the tiny engine has to run. `segRange(i)` is { from, to } in absolute pumps (the pre-roll included).
export function tinyPlan({ todo, segRange, schedule, preroll }) {
  const points = new Set();
  for (const i of todo) {
    const { from } = segRange(i);
    points.add(schedule.length ? restorePoint({ from, schedule, preroll }).at : from);
  }
  const upTo = points.size ? Math.max(...points) : preroll;
  const landings = schedule.filter((e) => e.land <= upTo).map((e) => e.land);
  return { snapshotAt: [...points].sort((a, b) => a - b), landings, upTo };
}

// the events a tiny pass applies: every fade that starts after the pre-roll and at or before upTo
export const eventsUpTo = (events, upTo, preroll) => events.filter((e) => e.start > preroll && e.start <= upTo);

// The self-check: a checkpoint file `ckpt` that the tiny pass wrote ("tiny": true) against the full-size engine's state at the same pump. 'checked' = equal; 'mismatch' = the segment that starts
// there was rendered from a state a serial render would not have had; 'existing' = a file a serial render wrote (nothing to check against).
export const checkAgainstTiny = (ckpt, state) => (!ckpt.tiny ? 'existing' : isDeepStrictEqual(ckpt.state, state) ? 'checked' : 'mismatch');

// ---- blocks ----
// A session renders CONSECUTIVE segments in one engine, the way the serial path does: only the first segment of a block starts from a restored (tiny-pass) state, every later one from
// the engine's own end state. Nothing is carried between NON-consecutive segments (hidden engine state would make the output depend on a session's history).
// GUIDED SIZE: a claim takes K = clamp(ceil(remaining / (2 * jobs)), 1, maxBlock) segments, `remaining` counting every segment not yet claimed. Early claims are as large as maxBlock
// allows (one browser launch and engine build amortised over K segments); as the pool drains K falls to 1, so the last sessions are not left holding long tails while others idle.
// The factor 2 aims at about two claims per session in the shrinking phase. maxBlock 1 is one segment per claim: the per-segment behaviour.
export const MIN_BLOCK = 1, MAX_BLOCK = 64, DEFAULT_BLOCK = 4;
export function parseBlockSegments(raw) {
  if (raw === undefined) return DEFAULT_BLOCK;
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw)) || n < MIN_BLOCK || n > MAX_BLOCK) throw new Error(`--block-segments ${raw}: expected a whole number from ${MIN_BLOCK} to ${MAX_BLOCK} (segments one browser session renders in a row; the default is ${DEFAULT_BLOCK}, 1 is a session per segment)`);
  return n;
}
export const blockSize = ({ remaining, jobs, maxBlock }) => Math.min(maxBlock, Math.max(1, Math.ceil(remaining / (2 * jobs))));
// Takes the next block off the front of `unclaimed` (ascending): up to K segments, each the next by index; a hole in the indices ends the block.
export function takeBlock(unclaimed, { jobs, maxBlock }) {
  const k = blockSize({ remaining: unclaimed.length, jobs, maxBlock });
  let n = 1;
  while (n < k && n < unclaimed.length && unclaimed[n] === unclaimed[n - 1] + 1) n++;
  return unclaimed.splice(0, n);
}

// ---- the pool ----
// Up to `jobs` workers, each claiming a BLOCK (takeBlock) from one ascending list, so the claim order is the segment order whatever each takes (the segments left after a crash are then
// mostly a prefix with a few holes). onBlock({ worker, block }) is called at the claim, onBlockEnd({ worker, block }) when the worker is done with it, however it ended (close the session there).
// runSegment({ worker, segment, attempt, index, block, fresh }) renders and commits ONE segment and throws if it cannot. `fresh` is true when the session must be (re)opened on the segment's
// own start state: the block's first segment, and every retry; false when the worker's engine is still at the segment's start from the one before. A throw with .fatal stops the run (no more
// claims; segments in flight finish and commit, since they are good). Any other throw is retried by the SAME worker, fresh, up to maxAttempts, after onFailure({ worker, segment, attempt,
// error }) has torn down what that attempt owned. A segment that fails maxAttempts times is a failed segment: the segments the worker had already committed stay committed, the rest of its
// block goes back to the pool for a fresh session to claim, the other workers carry on, and the run rejects at the end with the failed segment's message.
export async function runPool({ segments, jobs, maxAttempts, maxBlock = 1, runSegment, onBlock = async () => {}, onBlockEnd = async () => {}, onFailure = async () => {} }) {
  const unclaimed = [...segments].sort((a, b) => a - b);
  let stopped = false;
  const completed = [], attempts = new Map(), failures = [], blocks = [];
  const release = (rest) => { unclaimed.push(...rest); unclaimed.sort((a, b) => a - b); };
  const worker = async (w) => {
    while (!stopped && unclaimed.length) {
      const block = takeBlock(unclaimed, { jobs, maxBlock });
      blocks.push({ worker: w, block: [...block] });
      await onBlock({ worker: w, block });
      try {
        for (let index = 0; index < block.length; index++) {
          if (stopped) break;   // a fatal error elsewhere: the segments already committed stay, no more are started
          const segment = block[index];
          let ok = false, retry = false;
          for (let attempt = 1; ; attempt++) {
            attempts.set(segment, attempt);
            try { await runSegment({ worker: w, segment, attempt, index, block, fresh: index === 0 || retry }); completed.push(segment); ok = true; break; }
            catch (error) {
              retry = true;
              await onFailure({ worker: w, segment, attempt, error });
              if (error?.fatal || attempt >= maxAttempts) { if (error?.fatal) stopped = true; failures.push({ segment, error }); break; }
            }
          }
          if (!ok) { if (!stopped) release(block.slice(index + 1)); break; }   // the worker itself carries on: a fresh block, a fresh session
        }
      } finally { await onBlockEnd({ worker: w, block }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, unclaimed.length || 1)) }, (_, w) => worker(w + 1)));
  if (failures.length) {
    // fatal first (it is not about one segment), then the lowest segment: the same error whatever the timing
    failures.sort((a, b) => (Boolean(b.error?.fatal) - Boolean(a.error?.fatal)) || a.segment - b.segment);
    throw failures[0].error;
  }
  return { completed, attempts, blocks };
}
