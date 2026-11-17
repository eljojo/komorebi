import { describe, expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { ANGLE_KEYS, ENGINE_COMMIT, LEGACY_KEYS, PARAM_CHOICES, PARAM_RANGES, PARAM_TYPES } from '../src/generated/engine';
import { DEFAULT_VALUES } from '../src/generated/builtins';
import { builtinTwin, validateMeta, validateParams } from '../src/validate';

const lookNames = Object.keys(looks) as (keyof typeof looks)[];
const SHORT = ENGINE_COMMIT.slice(0, 7);
const firstOfType = (type: string) => Object.keys(PARAM_TYPES).find((k) => PARAM_TYPES[k] === type)!;

function refusal(params: unknown) {
  const r = validateParams(params);
  if (r.ok) throw new Error('expected a refusal');
  return r;
}

describe('validateParams: the shipped looks are the golden fixtures', () => {
  it('has fixtures', () => {
    expect(lookNames.length).toBeGreaterThan(20);
  });

  it.each(lookNames)('accepts %s', (name) => {
    expect(validateParams(looks[name])).toEqual({ ok: true });
  });

  it('refuses a look with one key renamed to not_a_knob, naming the key and the commit', () => {
    const [first, ...rest] = Object.entries(looks[lookNames[0]]);
    const mutated = Object.fromEntries([['not_a_knob', first[1]], ...rest]);
    const r = refusal(mutated);
    expect(r.reason).toBe('unknown_keys');
    expect(r.keys).toEqual(['not_a_knob']);
    expect(r.message).toBe(`arboretum runs komorebi ${SHORT}; unknown keys: not_a_knob`);
  });

  it('lists every unknown key', () => {
    const r = refusal({ a: 1, b: 2 });
    expect(r.message).toBe(`arboretum runs komorebi ${SHORT}; unknown keys: a, b`);
  });

  it('does not take inherited object properties for knobs', () => {
    expect(refusal({ constructor: 1 }).keys).toEqual(['constructor']);
    expect(refusal(JSON.parse('{"__proto__": 1}')).keys).toEqual(['__proto__']);
  });
});

describe('validateParams: key tables', () => {
  it('accepts every legacy key with a value of its current key\'s type', () => {
    for (const [old, current] of Object.entries(LEGACY_KEYS)) {
      // a number inside the editor's range for that key, and a string from its choices
      const value = { number: PARAM_RANGES[current]?.min ?? 1, boolean: true, string: PARAM_CHOICES[current]?.[0] ?? 'x' }[PARAM_TYPES[current]];
      expect(validateParams({ [old]: value }), old).toEqual({ ok: true });
    }
  });

  it('refuses a legacy key whose value has the wrong type, naming it', () => {
    const [old, current] = Object.entries(LEGACY_KEYS)[0];
    expect(PARAM_TYPES[current]).toBe('number');
    const r = refusal({ [old]: 'loud' });
    expect(r.reason).toBe('bad_values');
    expect(r.keys).toEqual([old]);
  });

  it('accepts the editor keys time_of_day and latitude as numbers', () => {
    expect(validateParams({ time_of_day: 14.5, latitude: 45.4 })).toEqual({ ok: true });
    expect(refusal({ time_of_day: '14:30' }).keys).toEqual(['time_of_day']);
  });
});

describe('validateParams: value types', () => {
  const num = firstOfType('number');
  const bool = firstOfType('boolean');
  const str = firstOfType('string');

  it.each([
    ['a string for a number', { [num]: '1' }, num],
    ['1 for a boolean', { [bool]: 1 }, bool],
    ['Infinity', { [num]: Infinity }, num],
    ['NaN', { [num]: NaN }, num],
    ['a number for a string', { [str]: 1 }, str],
    ['a nested object', { [num]: { a: 1 } }, num],
    ['an array', { [num]: [1] }, num],
    ['null', { [num]: null }, num],
  ])('refuses %s, naming the key', (_label, params, key) => {
    const r = refusal(params);
    expect(r.reason).toBe('bad_values');
    expect(r.keys).toEqual([key]);
    expect(r.message).toContain(key);
  });

  it('accepts a string of 64 characters and refuses 65', () => {
    // tree_species is a string with no list of choices
    expect(validateParams({ tree_species: 'x'.repeat(64) })).toEqual({ ok: true });
    expect(refusal({ tree_species: 'x'.repeat(65) }).keys).toEqual(['tree_species']);
  });

  it('lists every bad key', () => {
    expect(refusal({ [num]: 'a', [bool]: 2 }).keys).toEqual([num, bool]);
  });
});

describe('validateParams: the editor\'s ranges, with leeway', () => {
  const outOfRange = (params: unknown) => {
    const r = refusal(params);
    expect(r.reason).toBe('out_of_range');
    return r;
  };

  it('refuses the review\'s S1 look, naming the one key that is past the editor', () => {
    const r = outOfRange({ tree_count: 1, limb_count: 1, branch_levels: 20, branch_children: 6 });
    expect(r.keys).toEqual(['branch_levels']);
    expect(r.message).toContain('branch_levels must be 1–4');
  });

  it('holds a fractional slider to its range stretched by a quarter of its span at each end', () => {
    // vignette_shape is 2…8 in the editor: 0.5…9.5 with leeway
    expect(PARAM_RANGES.vignette_shape).toEqual({ min: 2, max: 8 });
    for (const v of [0.5, 2, 9.5]) expect(validateParams({ vignette_shape: v }), String(v)).toEqual({ ok: true });
    for (const v of [0.4999, 9.5001]) expect(outOfRange({ vignette_shape: v }).message).toContain('vignette_shape must be 0.5–9.5');
  });

  it('rounds an integer slider\'s stretched max down and its min up', () => {
    // branch_levels is 1…4 step 1: 0.25…4.75 stretches to 1…4
    expect(PARAM_RANGES.branch_levels).toEqual({ min: 1, max: 4 });
    for (const v of [1, 4]) expect(validateParams({ branch_levels: v })).toEqual({ ok: true });
    for (const v of [0, 0.5, 4.5, 5]) expect(outOfRange({ branch_levels: v }).keys).toEqual(['branch_levels']);
    // sample_count is 16…48 step 1: 8…56 exactly
    for (const v of [8, 56]) expect(validateParams({ sample_count: v })).toEqual({ ok: true });
    for (const v of [7, 57]) expect(outOfRange({ sample_count: v }).keys).toEqual(['sample_count']);
  });

  it('never lets a slider whose min is 0 or more accept a negative value', () => {
    // cloud_thickness is 0…1: the stretch would reach −0.25
    expect(validateParams({ cloud_thickness: 0 })).toEqual({ ok: true });
    expect(outOfRange({ cloud_thickness: -0.0001 }).message).toContain('cloud_thickness must be 0–1.25');
    // a count whose own min is 1 can't go negative either
    expect(outOfRange({ tree_count: -1 }).keys).toEqual(['tree_count']);
  });

  it('lets a slider with a negative min go below it', () => {
    // droop is -1…1: -1.5…1.5
    expect(validateParams({ droop: -1.5 })).toEqual({ ok: true });
    expect(outOfRange({ droop: -1.6 }).message).toContain('droop must be -1.5–1.5');
  });

  it('accepts any finite angle for an angle key, since it wraps', () => {
    expect(ANGLE_KEYS).toEqual(expect.arrayContaining(['view_yaw_deg', 'sun_azimuth_deg', 'wind_direction_deg']));
    for (const key of ANGLE_KEYS) {
      for (const v of [540, -540, 208.5, 1e6]) expect(validateParams({ [key]: v }), `${key} ${v}`).toEqual({ ok: true });
    }
    expect(refusal({ view_yaw_deg: Infinity }).reason).toBe('bad_values');
  });

  it('knows an angle key only by its range and its _deg name', () => {
    for (const key of ANGLE_KEYS) {
      const { min, max } = PARAM_RANGES[key];
      expect(key.endsWith('_deg')).toBe(true);
      expect(`${min},${max}`).toMatch(/^(-180,180|0,360)$/);
    }
    // a 0…90 or 4…90 elevation is not an angle that wraps
    expect(ANGLE_KEYS).not.toContain('view_pitch_deg');
    expect(ANGLE_KEYS).not.toContain('sun_elevation_deg');
    expect(outOfRange({ view_pitch_deg: 400 }).keys).toEqual(['view_pitch_deg']);
  });

  it('takes a select\'s choices exactly, with no leeway', () => {
    expect(PARAM_CHOICES.phyllotaxis).toEqual(['spiral', 'whorled', 'opposite']);
    expect(validateParams({ phyllotaxis: 'whorled' })).toEqual({ ok: true });
    expect(outOfRange({ phyllotaxis: 'fibonacci' }).message).toContain('phyllotaxis must be one of spiral, whorled, opposite');
    expect(PARAM_CHOICES.tone_map).toEqual([0, 1, 2]);
    expect(validateParams({ tone_map: 2 })).toEqual({ ok: true });
    for (const v of [3, 0.5, -1]) expect(outOfRange({ tone_map: v }).keys).toEqual(['tone_map']);
  });

  it('bounds clusters_per_layer, which has no slider, at 1 to 82 with no leeway', () => {
    expect(PARAM_RANGES).not.toHaveProperty('clusters_per_layer');
    for (const v of [1, 82]) expect(validateParams({ clusters_per_layer: v })).toEqual({ ok: true });
    for (const v of [0, 83]) expect(outOfRange({ clusters_per_layer: v }).message).toContain('clusters_per_layer must be 1–82');
  });

  it('leaves seed and tree_species to their types', () => {
    expect(validateParams({ seed: 4e9, tree_species: 'anything short' })).toEqual({ ok: true });
  });

  it('holds a legacy key to its current key\'s range, and takes time_of_day and latitude from their own rows', () => {
    const [old, current] = Object.entries(LEGACY_KEYS).find(([, cur]) => PARAM_RANGES[cur])!;
    const { max } = PARAM_RANGES[current];
    const r = outOfRange({ [old]: max * 100 + 1000 });
    expect(r.keys).toEqual([old]);
    expect(r.message).toContain(old);
    expect(PARAM_RANGES.time_of_day).toEqual({ min: 5, max: 19 });
    expect(validateParams({ time_of_day: 22.5, latitude: 82 })).toEqual({ ok: true });
    expect(outOfRange({ time_of_day: 23, latitude: 83 }).keys).toEqual(['time_of_day', 'latitude']);
  });

  it('names every key that is out of range, each with the range it was held to', () => {
    const r = outOfRange({ branch_levels: 9, branch_children: 40 });
    expect(r.keys).toEqual(['branch_levels', 'branch_children']);
    expect(r.message).toContain('branch_levels must be 1–4');
    expect(r.message).toContain('branch_children must be 0–7');
  });

  it('reports a wrong type before a range', () => {
    expect(refusal({ branch_levels: 'many' }).reason).toBe('bad_values');
  });

  it('accepts the four shipped looks that go past the editor\'s sliders, unchanged', () => {
    expect(looks.montebello.view_yaw_deg).toBe(208.5);
    expect(looks['canopy 2'].foliage_density).toBe(3.4);
    expect(looks['curtain 2'].fold_warp).toBe(0.34);
    expect(looks['acid dreams'].branch_length_ratio).toBe(1);
    for (const name of ['montebello', 'canopy 2', 'curtain 2', 'acid dreams'] as const) {
      expect(validateParams(looks[name]), name).toEqual({ ok: true });
    }
  });
});

describe('validateParams: shape and size', () => {
  it.each([['an array', []], ['null', null], ['a string', 'x'], ['a number', 1], ['undefined', undefined]])(
    'refuses %s as params',
    (_label, params) => {
      expect(refusal(params).reason).toBe('not_object');
    },
  );

  it('refuses a non-plain object', () => {
    expect(refusal(new Date()).reason).toBe('not_object');
  });

  it('refuses a body over 16 KB and accepts one of exactly 16 KB', () => {
    const str = firstOfType('string');
    // {"<str>":"<pad>"} is 7 bytes of syntax around the key and the padding; build to the byte.
    const overhead = JSON.stringify({ [str]: '' }).length;
    const build = (bytes: number) => ({ [str]: 'x'.repeat(bytes - overhead) });
    expect(new TextEncoder().encode(JSON.stringify(build(16384))).length).toBe(16384);
    expect(refusal(build(16385)).reason).toBe('too_large');
    // the size guard runs before the key and value checks, so this one is the size refusal and not the 64-char one
    expect(refusal(build(16385)).message).toMatch(/16 KB/);
    expect(refusal(build(16384)).reason).toBe('bad_values');
  });

  it('accepts a real look well under the limit', () => {
    expect(JSON.stringify(looks.montebello).length).toBeLessThan(16384);
    expect(validateParams(looks.montebello)).toEqual({ ok: true });
  });
});

describe('validateMeta', () => {
  const ok = (meta: unknown) => {
    const r = validateMeta(meta);
    if (!r.ok) throw new Error(`expected ok: ${r.errors.join('; ')}`);
    return r.meta;
  };
  const errors = (meta: unknown) => {
    const r = validateMeta(meta);
    if (r.ok) throw new Error('expected a refusal');
    return r.errors;
  };

  it('accepts a name alone, with no tags', () => {
    expect(ok({ name: 'montebello, rain' })).toEqual({ name: 'montebello, rain', tags: [] });
  });

  it('trims the name', () => {
    expect(ok({ name: '  rain  ' }).name).toBe('rain');
  });

  it('requires a name of 1 to 80 characters', () => {
    expect(errors({})).toEqual([expect.stringContaining('name')]);
    expect(errors({ name: '   ' })).toEqual([expect.stringContaining('name')]);
    expect(errors({ name: 5 })).toEqual([expect.stringContaining('name')]);
    expect(ok({ name: 'x'.repeat(80) }).name).toHaveLength(80);
    expect(errors({ name: 'x'.repeat(81) })).toEqual([expect.stringContaining('name')]);
  });

  it('limits the description to 500 characters', () => {
    expect(ok({ name: 'a', description: 'd'.repeat(500) }).description).toHaveLength(500);
    expect(errors({ name: 'a', description: 'd'.repeat(501) })).toEqual([expect.stringContaining('description')]);
    expect(errors({ name: 'a', description: 7 })).toEqual([expect.stringContaining('description')]);
  });

  it('accepts the two tags', () => {
    expect(ok({ name: 'a', tags: ['projector', 'experimental'] }).tags).toEqual(['projector', 'experimental']);
  });

  it('refuses an unknown tag, naming it', () => {
    const e = errors({ name: 'a', tags: ['projector', 'moody'] });
    expect(e).toEqual([expect.stringContaining('moody')]);
  });

  it('refuses duplicate tags and tags that are not an array', () => {
    expect(errors({ name: 'a', tags: ['projector', 'projector'] })).toEqual([expect.stringContaining('tags')]);
    expect(errors({ name: 'a', tags: 'projector' })).toEqual([expect.stringContaining('tags')]);
  });

  it('refuses meta that is not an object', () => {
    expect(errors(null)).toHaveLength(1);
    expect(errors([])).toHaveLength(1);
  });

  it('reports every problem at once', () => {
    expect(errors({ name: '', description: 'd'.repeat(501), tags: ['x'] })).toHaveLength(3);
  });
});

describe('builtinTwin: an unchanged copy of a shipped look', () => {
  const some = 'afternoon 7' as keyof typeof looks;
  const look = looks[some] as Record<string, number | boolean | string>;
  const DEBUG = ['show_source', 'show_layer', 'show_layer_index'];

  it.each(lookNames)('names %s when it is sent as shipped', (name) => {
    // Two shipped looks that differ only in a debug overlay would both match; the name must be one whose params are the same.
    const twin = builtinTwin(looks[name]);
    expect(twin).not.toBeNull();
    expect(Object.keys(DEFAULT_VALUES).filter((k) => !DEBUG.includes(k) && (looks as any)[twin!][k] !== (looks as any)[name][k])).toEqual([]);
  });

  it('names the look itself when no other look shares its params', () => {
    expect(builtinTwin(look)).toBe(some);
  });

  it('is null for a look with one knob moved a little', () => {
    const moved = { ...look, cloud_thickness: (look.cloud_thickness as number) + 0.01 };
    expect(validateParams(moved)).toEqual({ ok: true });
    expect(builtinTwin(moved)).toBeNull();
  });

  it('is null for a look that is nothing like a built-in', () => {
    expect(builtinTwin({ tree_count: 3 })).toBeNull();
  });

  it('still names the look when only a debug overlay is flipped', () => {
    expect(builtinTwin({ ...look, show_source: !look.show_source, show_layer: true, show_layer_index: 3 })).toBe(some);
  });

  it('still names the look with time_of_day and latitude added', () => {
    expect(builtinTwin({ ...look, time_of_day: 7.5, latitude: 45 })).toBe(some);
  });

  it('still names the look when keys equal to their defaults are left out', () => {
    const partial = Object.fromEntries(Object.entries(look).filter(([k, v]) => DEFAULT_VALUES[k] !== v));
    expect(Object.keys(partial).length).toBeLessThan(Object.keys(look).length);
    expect(builtinTwin(partial)).toBe(some);
  });

  it('still names the look when a knob is under its legacy spelling', () => {
    const [old, current] = Object.entries(LEGACY_KEYS)[0];
    const { [current]: value, ...rest } = look;
    expect(builtinTwin({ ...rest, [old]: value })).toBe(some);
  });

  it('lets a current key already present win over its legacy spelling, as migrateLegacy does', () => {
    const [old, current] = Object.entries(LEGACY_KEYS)[0];
    const stale = (look[current] as number) + 0.01;
    expect(builtinTwin({ ...look, [old]: stale })).toBe(some);
    const { [current]: _dropped, ...rest } = look;
    expect(builtinTwin({ ...rest, [old]: stale })).toBeNull();
  });

  it('compares strictly: a number and its text are different', () => {
    expect(builtinTwin({ ...look, tree_count: String(look.tree_count) })).toBeNull();
  });
});
