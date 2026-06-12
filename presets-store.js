// ============================================================================
// Komorebi editor — saved-look persistence. PURE browser-storage I/O over the
// ★ looks the editor saves to localStorage, with the built-in PRESETS as the
// fallback source. No DOM, no engine — split out of the editor shell (the first
// of the editor.js decomposition) so it unit-tests under `bun test` the way
// profiler.js does, with a localStorage shim. (spec §9)
// ============================================================================
import { PRESETS } from "./presets.js";

export const LS_KEY = "komorebi.presets";

// the user's saved (★) looks, keyed by name; {} if none, or if the store is unreadable/corrupt.
export function getStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }   // no localStorage, or malformed JSON -> behave as empty
}

export function setStored(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); }
  catch { /* storage full / disabled — silently skip, the look just isn't persisted */ }
}

// resolve a look by name: a saved ★ look shadows a built-in of the same name; otherwise the built-in.
export function getPreset(name) {
  const s = getStored();
  return name in s ? s[name] : PRESETS[name];
}
