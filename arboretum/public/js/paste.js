// What the editor's "copy JSON" gives us, turned into request bodies. Params travel as the text the person
// pasted, never re-serialised (spec §2.3), so the bodies are put together as strings.
import { rawMember } from './rawjson.js';

/**
 * Accepts both shapes the editor produces: the params object, or `{ params }`.
 * @param {string} text
 * @returns {{ ok: true, paramsText: string } | { ok: false, message: string }}
 */
export function readLook(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: 'paste the JSON from komorebi’s “copy JSON”, or choose a file' };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'that is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'expected a params object, or { "params": … }' };
  }
  const wrapped = typeof parsed.params === 'object' && parsed.params !== null;
  return { ok: true, paramsText: wrapped ? /** @type {string} */ (rawMember(trimmed, 'params')) : trimmed };
}

/**
 * @param {string} paramsText
 * @param {{ name: string, description: string, tags: string[], visibility: string }} meta
 */
export function createBody(paramsText, meta) {
  const { name, description, tags, visibility } = meta;
  const rest = JSON.stringify({ name, ...(description && { description }), tags, visibility });
  return `${rest.slice(0, -1)},"params":${paramsText}}`;
}

/** @param {string} paramsText */
export function versionBody(paramsText) {
  return `{"params":${paramsText}}`;
}
