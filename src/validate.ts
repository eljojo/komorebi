// The upload guard (spec §5): what a preset may contain. Pure functions, no I/O.
import { ENGINE_COMMIT, LEGACY_KEYS, PARAM_TYPES } from './generated/engine';

export const MAX_PARAMS_BYTES = 16384;
const MAX_STRING = 64;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
export const TAGS = ['projector', 'experimental'];

// The editor's export carries these two input helpers (found in `park 2` and `acid dreams`), but DEFAULTS does not.
const EDITOR_KEYS: Record<string, 'number'> = { time_of_day: 'number', latitude: 'number' };

type ParamsRefusal = {
  ok: false;
  reason: 'not_object' | 'too_large' | 'unknown_keys' | 'bad_values';
  message: string;
  // The offending keys, for the two key-level reasons; empty otherwise.
  keys: string[];
};

// Own-property lookups only: `constructor` and `__proto__` must not read as knobs.
function typeOf(key: string): string | undefined {
  if (Object.hasOwn(PARAM_TYPES, key)) return PARAM_TYPES[key];
  if (Object.hasOwn(LEGACY_KEYS, key)) return PARAM_TYPES[LEGACY_KEYS[key]];
  if (Object.hasOwn(EDITOR_KEYS, key)) return EDITOR_KEYS[key];
  return undefined;
}

function hasType(value: unknown, type: string): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && value.length <= MAX_STRING;
}

export function validateParams(params: unknown): { ok: true } | ParamsRefusal {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { ok: false, reason: 'not_object', message: 'params must be an object', keys: [] };
  }
  const proto = Object.getPrototypeOf(params);
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, reason: 'not_object', message: 'params must be a plain object', keys: [] };
  }
  if (new TextEncoder().encode(JSON.stringify(params)).length > MAX_PARAMS_BYTES) {
    return { ok: false, reason: 'too_large', message: 'params is over 16 KB', keys: [] };
  }

  const entries = Object.entries(params);
  const unknown = entries.filter(([k]) => typeOf(k) === undefined).map(([k]) => k);
  if (unknown.length) {
    return {
      ok: false,
      reason: 'unknown_keys',
      message: `arboretum is pinned to komorebi ${ENGINE_COMMIT.slice(0, 7)}; unknown keys: ${unknown.join(', ')}`,
      keys: unknown,
    };
  }

  const bad = entries.filter(([k, v]) => !hasType(v, typeOf(k)!)).map(([k]) => k);
  if (bad.length) {
    return {
      ok: false,
      reason: 'bad_values',
      message: `values of the wrong type (numbers must be finite, strings at most ${MAX_STRING} characters): ${bad.join(', ')}`,
      keys: bad,
    };
  }
  return { ok: true };
}

export type Meta = { name: string; description?: string; tags: string[] };

export function validateMeta(meta: unknown): { ok: true; meta: Meta } | { ok: false; errors: string[] } {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return { ok: false, errors: ['metadata must be an object'] };
  }
  const { name, description, tags } = meta as Record<string, unknown>;
  const errors: string[] = [];

  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length < 1 || trimmed.length > MAX_NAME) errors.push(`name is required, 1 to ${MAX_NAME} characters`);

  if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION)) {
    errors.push(`description must be text of at most ${MAX_DESCRIPTION} characters`);
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags) || new Set(tags).size !== tags.length) {
      errors.push('tags must be a list without duplicates');
    } else {
      const unknown = tags.filter((t) => !TAGS.includes(t));
      if (unknown.length) errors.push(`tags must be from ${TAGS.join(', ')}; unknown: ${unknown.join(', ')}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    meta: { name: trimmed, ...(description !== undefined && { description: description as string }), tags: (tags as string[] | undefined) ?? [] },
  };
}
