// The commit step of the pin and vendor scripts. They build every output into a temporary place first; this puts
// the results where the repo keeps them only once all of them exist, so a failure partway can never leave the
// validator ahead of the bundle, or `engine.json` naming a file that is gone.
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

// `files`: [{ from, to }], put in place in the order given (list a bundle before the json that names it).
// `stale`: paths removed last, once everything else has landed; one that is also an output is kept.
export function install(files, stale = []) {
  const parked = files.map(({ to }) => `${to}.staged`);
  try {
    // Copy beside the destination first: a missing or unreadable source fails here, before anything is replaced.
    files.forEach(({ from, to }, i) => {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, parked[i]);
    });
  } catch (err) {
    for (const path of parked) rmSync(path, { force: true });
    throw err;
  }
  files.forEach(({ to }, i) => renameSync(parked[i], to));
  const outputs = new Set(files.map(({ to }) => to));
  for (const path of stale) if (!outputs.has(path)) rmSync(path, { force: true });
}
