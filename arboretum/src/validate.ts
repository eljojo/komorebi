// The upload guard (spec §5): what a preset may contain. Pure functions, no I/O.
import { BUILTIN_LOOKS, DEFAULT_VALUES } from './generated/builtins';
import { ANGLE_KEYS, ENGINE_COMMIT, INTEGER_KEYS, LEGACY_KEYS, PARAM_CHOICES, PARAM_RANGES, PARAM_TYPES, FIDELITY_KEYS, PLAYBACK_KEYS } from './generated/engine';

export const MAX_PARAMS_BYTES = 16384;
const MAX_STRING = 64;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
export const TAGS = ['projector', 'experimental'];

// The editor's export carries these two input helpers (found in `park 2` and `acid dreams`), but DEFAULTS does not.
const EDITOR_KEYS: Record<string, 'number'> = { time_of_day: 'number', latitude: 'number' };

// A look must be one the editor can make (REVIEW S1: absurd topology freezes the tab of whoever opens it), but a few
// shipped looks sit past its sliders, so a slider's range stretches by this share of its span at each end.
export const RANGE_LEEWAY = 0.25;

// `clusters_per_layer` has no editor slider, but it sets how much the grove costs. José set its bound at the
// shipped maximum, 82, with no leeway.
export const CLUSTERS_PER_LAYER = { min: 1, max: 82 };

type ParamsRefusal = {
  ok: false;
  reason: 'not_object' | 'too_large' | 'unknown_keys' | 'bad_values' | 'out_of_range';
  message: string;
  // The offending keys, for the key-level reasons; empty otherwise.
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

// Which knob's rules a key follows: a legacy spelling follows its current key; the editor's own helpers have rows of their own.
const currentKey = (key: string) => (Object.hasOwn(LEGACY_KEYS, key) ? LEGACY_KEYS[key] : key);

// 12 significant digits drop the float noise from the stretch (0.3 + 0.075), so a bound reads as the number it is.
const tidy = (n: number) => Number(n.toPrecision(12));

// The range a key is held to, leeway included; undefined when it has none.
function boundsOf(key: string): { min: number; max: number } | undefined {
  const k = currentKey(key);
  if (k === 'clusters_per_layer') return CLUSTERS_PER_LAYER;
  if (!Object.hasOwn(PARAM_RANGES, k)) return undefined;
  const { min, max } = PARAM_RANGES[k];
  const stretch = (max - min) * RANGE_LEEWAY;
  let lo = tidy(min - stretch);
  let hi = tidy(max + stretch);
  if (min >= 0) lo = Math.max(0, lo);
  if (INTEGER_KEYS.includes(k)) {
    lo = Math.ceil(lo);
    hi = Math.floor(hi);
  }
  return { min: lo, max: hi };
}

// What is wrong with a value of the right type, or undefined. A string value is only held to a choice list.
function rangeProblem(key: string, value: unknown): string | undefined {
  const k = currentKey(key);
  if (Object.hasOwn(PARAM_CHOICES, k)) {
    const choices = PARAM_CHOICES[k];
    return choices.includes(value as number | string) ? undefined : `${key} must be one of ${choices.join(', ')}`;
  }
  if (typeof value !== 'number' || ANGLE_KEYS.includes(k)) return undefined; // an angle wraps: 208.5 is -151.5
  const bounds = boundsOf(key);
  return bounds && (value < bounds.min || value > bounds.max) ? `${key} must be ${bounds.min}–${bounds.max}` : undefined;
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
      message: `arboretum runs komorebi ${ENGINE_COMMIT.slice(0, 7)}; unknown keys: ${unknown.join(', ')}`,
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

  const problems = entries.flatMap(([k, v]) => {
    const problem = rangeProblem(k, v);
    return problem ? [{ key: k, problem }] : [];
  });
  if (problems.length) {
    return {
      ok: false,
      reason: 'out_of_range',
      message: `out of range for the komorebi editor: ${problems.map((p) => p.problem).join('; ')}`,
      keys: problems.map((p) => p.key),
    };
  }
  return { ok: true };
}

// Like komorebi's migrateLegacy: an old spelling becomes its current key unless the current key is already there.
function migrated(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params };
  for (const [old, current] of Object.entries(LEGACY_KEYS)) {
    if (!Object.hasOwn(params, old)) continue;
    if (!Object.hasOwn(out, current)) out[current] = params[old];
    delete out[old];
  }
  return out;
}

// The debug overlays change what is drawn over the art, not the art; time_of_day and latitude are editor inputs
// to the sun knobs, which are compared themselves. Neither makes a built-in look "modified".
const NOT_THE_ART = ['show_source', 'show_layer', 'show_layer_index', 'drift_phase', 'edge_area', ...PLAYBACK_KEYS];
const COMPARED = Object.keys(DEFAULT_VALUES).filter((k) => !NOT_THE_ART.includes(k));

const builtins = Object.entries(BUILTIN_LOOKS).map(([name, look]) => ({ name, look: migrated(look) }));

// The name of the built-in look these params are an unchanged copy of, or null (design §3.8). Both sides are
// compared as the engine would load them: legacy keys migrated, absent keys at their defaults, values with ===.
export function builtinTwin(params: Record<string, unknown>): string | null {
  const mine = migrated(params);
  return builtins.find(({ look }) => COMPARED.every((k) => FIDELITY_KEYS.includes(k) ? mine[k] === look[k] : (mine[k] ?? DEFAULT_VALUES[k]) === (look[k] ?? DEFAULT_VALUES[k])))?.name ?? null;
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
