// The exporter's --jobs N, as pure logic (no browser, no ffmpeg, no files): which segments are left, which integrator states the CPU-only pass must record so each can
// start alone, and the pool that renders them N at a time. render-video.mjs wires these to Chromium and ffmpeg; parallel.test.mjs holds them with fakes.
//
// WHY SEGMENTS CAN BE PARALLEL. A segment's frames are a function of the look, the clock and the integrator state (springs, wind, drift phase) it starts from. In a serial render that
// state arrives in-session from the segment before; here a tiny 64x36 engine (video.html cheapPreroll: the CPU half of the engine does not know the GPU exists) integrates the
// whole timeline first and writes the state at every start the todo segments need, as the same ckpt/ckpt_<pump>.json files the serial path reads.

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

// ---- the pool ----
// Up to `jobs` workers, each claiming the next unrendered segment from one ascending cursor (so the claim order is the segment order, whatever each takes: the segments left after a
// crash are then mostly a prefix with a few holes). runSegment({ worker, segment, attempt }) renders and commits ONE segment and throws if it cannot; a throw with .fatal stops the
// run (no more claims; segments in flight finish and commit, since they are good). Any other throw is retried by the SAME worker, up to maxAttempts, after onFailure({ worker, segment,
// attempt, error }) has torn down what that attempt owned; a segment that fails maxAttempts times stops the run likewise and its message is the run's. A failure belongs to its
// segment and its session: the other workers carry on.
export async function runPool({ segments, jobs, maxAttempts, runSegment, onFailure = async () => {} }) {
  const queue = [...segments];
  let cursor = 0, stopped = false;
  const completed = [], attempts = new Map(), failures = [];
  const worker = async (w) => {
    while (!stopped && cursor < queue.length) {
      const segment = queue[cursor++];
      for (let attempt = 1; ; attempt++) {
        attempts.set(segment, attempt);
        try { await runSegment({ worker: w, segment, attempt }); completed.push(segment); break; }
        catch (error) {
          await onFailure({ worker: w, segment, attempt, error });
          if (error?.fatal || attempt >= maxAttempts) { stopped = true; failures.push({ segment, error }); return; }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, queue.length || 1)) }, (_, w) => worker(w + 1)));
  if (failures.length) {
    // fatal first (it is not about one segment), then the lowest segment: the same error whatever the timing
    failures.sort((a, b) => (Boolean(b.error?.fatal) - Boolean(a.error?.fatal)) || a.segment - b.segment);
    throw failures[0].error;
  }
  return { completed, attempts };
}
