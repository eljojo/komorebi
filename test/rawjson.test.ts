import { describe, expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { duplicateKeys, rawMember } from '../src/rawjson';

describe('rawMember: the exact text of one member of a JSON object', () => {
  it('returns the substring as written, whitespace and number spelling included', () => {
    const raw = '{ "a" : 1.0 ,\n  "b":  1e0 }';
    expect(rawMember(`{"name":"x", "params" :${raw} ,"z":1}`, 'params')).toBe(raw);
  });

  it('is not the same as re-serialising, which is why it exists', () => {
    const raw = '{"a":1.0}';
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    expect(rawMember(`{"params":${raw}}`, 'params')).toBe(raw);
  });

  it('is not fooled by braces, brackets, quotes and escapes inside strings', () => {
    const raw = '{"s":"}\\"{ ]","t":["\\\\", {"u":"\\""}]}';
    expect(rawMember(`{"before":"\\"params\\":1","params":${raw},"after":{}}`, 'params')).toBe(raw);
  });

  it('matches an escaped spelling of the key', () => {
    expect(rawMember('{"\\u0070arams": {"a":1}}', 'params')).toBe('{"a":1}');
  });

  it('takes the last of duplicate keys, as JSON.parse does', () => {
    expect(rawMember('{"params":{"a":1},"params":{"a":2}}', 'params')).toBe('{"a":2}');
  });

  it('does not look inside nested objects', () => {
    expect(rawMember('{"x":{"params":{"a":1}}}', 'params')).toBeUndefined();
  });

  it('returns undefined when the key is absent, and handles an empty object', () => {
    expect(rawMember('{"a":1}', 'params')).toBeUndefined();
    expect(rawMember('{}', 'params')).toBeUndefined();
  });

  it.each(Object.entries(looks))('returns every shipped look, %s, byte for byte in any spacing', (_name, look) => {
    for (const raw of [JSON.stringify(look), JSON.stringify(look, null, 2), JSON.stringify(look, null, '\t\t')]) {
      expect(rawMember(`{ "name":"x" ,"params":${raw}\n}`, 'params')).toBe(raw);
    }
  });
});

describe('duplicateKeys: top-level keys an object text repeats', () => {
  it('names a repeated key once, however often it repeats', () => {
    expect(duplicateKeys('{"a":1,"b":2,"a":3,"a":4}')).toEqual(['a']);
  });

  it('names every repeated key, in the order they first repeat', () => {
    expect(duplicateKeys('{"a":1,"b":2,"b":3,"a":4}')).toEqual(['b', 'a']);
  });

  it('sees an escaped spelling as the same key', () => {
    expect(duplicateKeys('{"a":1,"\\u0061":2}')).toEqual(['a']);
  });

  it('is empty when no key repeats, and for an empty object', () => {
    expect(duplicateKeys('{"a":1,"b":{"c":1},"c":[1]}')).toEqual([]);
    expect(duplicateKeys('{}')).toEqual([]);
  });

  it('does not look inside nested values, or at a key-shaped string value', () => {
    expect(duplicateKeys('{"a":{"b":1,"b":2},"c":"\\"a\\":1"}')).toEqual([]);
  });
});
