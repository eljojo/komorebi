import { expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { LOOK_NAMES } from '../src/generated/engine';

it('LOOK_NAMES lists exactly the shipped looks, so a look: parent can be checked', () => {
  expect([...LOOK_NAMES].sort()).toEqual(Object.keys(looks).sort());
});
