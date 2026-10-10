import { describe, expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { ENGINE_COMMIT, LEGACY_KEYS, PARAM_TYPES } from '../src/generated/engine';
import { validateMeta, validateParams } from '../src/validate';

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
    expect(r.message).toBe(`arboretum is pinned to komorebi ${SHORT}; unknown keys: not_a_knob`);
  });

  it('lists every unknown key', () => {
    const r = refusal({ a: 1, b: 2 });
    expect(r.message).toBe(`arboretum is pinned to komorebi ${SHORT}; unknown keys: a, b`);
  });

  it('does not take inherited object properties for knobs', () => {
    expect(refusal({ constructor: 1 }).keys).toEqual(['constructor']);
    expect(refusal(JSON.parse('{"__proto__": 1}')).keys).toEqual(['__proto__']);
  });
});

describe('validateParams: key tables', () => {
  it('accepts every legacy key with a value of its current key\'s type', () => {
    for (const [old, current] of Object.entries(LEGACY_KEYS)) {
      const value = { number: 1, boolean: true, string: 'x' }[PARAM_TYPES[current]];
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
    expect(validateParams({ [str]: 'x'.repeat(64) })).toEqual({ ok: true });
    expect(refusal({ [str]: 'x'.repeat(65) }).keys).toEqual([str]);
  });

  it('lists every bad key', () => {
    expect(refusal({ [num]: 'a', [bool]: 2 }).keys).toEqual([num, bool]);
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
