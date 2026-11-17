import { expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { LOOK_NAMES, PARAM_TYPES } from '../src/generated/engine';
import { BUILTIN_LOOKS, DEFAULT_VALUES } from '../src/generated/builtins';

it('LOOK_NAMES lists exactly the shipped looks, so a look: parent can be checked', () => {
  expect([...LOOK_NAMES].sort()).toEqual(Object.keys(looks).sort());
});

it('DEFAULT_VALUES holds a value of the right type for every key the validator knows', () => {
  expect(Object.keys(DEFAULT_VALUES).sort()).toEqual(Object.keys(PARAM_TYPES).sort());
  for (const [k, v] of Object.entries(DEFAULT_VALUES)) expect(typeof v, k).toBe(PARAM_TYPES[k]);
});

it('BUILTIN_LOOKS holds the shipped looks exactly as the fixtures do', () => {
  expect(BUILTIN_LOOKS).toEqual(looks);
});
