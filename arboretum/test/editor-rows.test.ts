import { describe, expect, it } from 'vitest';
import { inputKeys, rowsOf } from '../scripts/editor-rows.mjs';

// The shapes komorebi's PARAMS uses: a slider, number and string selects, a toggle, a parameter with no row, and an editor input.
const PARAMS = {
  time_of_day: { input: 'the clock', row: { kind: 's', label: 'time (h)', min: 5, max: 19, step: 0.25, rebuild: 'suntime' }, travels: 'none', means: '<b>…</b>' },
  cloud_thickness: { default: 0.15, row: { kind: 's', label: 'CLOUD', min: 0, max: 1, step: 0.01, rebuild: 'source' }, travels: 'morph', means: '<b>…</b>' },
  eclipse: { default: false, row: { kind: 't', label: 'eclipse', rebuild: 'source' }, travels: 'topo', means: '<b>…</b>' },
  litter: { default: 0, row: { kind: 'sel', label: 'litter', choices: [['off', 0], ['on', 1]], rebuild: '' }, travels: 'topo', means: '<b>…</b>' },
  phyllotaxis: { default: 'spiral', row: { kind: 'sels', label: 'phyllo', choices: [['spiral', 'spiral'], ['whorled', 'whorled']], rebuild: 'canopy' }, travels: 'topo', means: '<b>…</b>' },
  seed: { default: 1234, noRow: 'the reseed button', travels: 'topo', means: '<b>…</b>' },
};

describe('rowsOf', () => {
  const rows = rowsOf(PARAMS);
  const byKey = (key: string) => rows.find((r: { key: string }) => r.key === key);

  it('reads slider rows as min, max and step', () => {
    expect(byKey('cloud_thickness')).toEqual({ kind: 's', key: 'cloud_thickness', min: 0, max: 1, step: 0.01 });
    expect(byKey('time_of_day')).toEqual({ kind: 's', key: 'time_of_day', min: 5, max: 19, step: 0.25 });
  });

  it('reads select rows as their numeric values, and sels rows as their strings', () => {
    expect(byKey('litter')).toEqual({ kind: 'sel', key: 'litter', choices: [0, 1] });
    expect(byKey('phyllotaxis')).toEqual({ kind: 'sels', key: 'phyllotaxis', choices: ['spiral', 'whorled'] });
  });

  it('skips toggles and parameters with no row, in the registry order', () => {
    expect(rows.map((r: { key: string }) => r.key)).toEqual(['time_of_day', 'cloud_thickness', 'litter', 'phyllotaxis']);
  });

  it('refuses a row kind it does not know, and a module with no PARAMS', () => {
    expect(() => rowsOf({ x: { default: 1, row: { kind: 'dial' } } })).toThrow(/dial/);
    expect(() => rowsOf(undefined)).toThrow(/PARAMS/);
  });
});

describe('inputKeys', () => {
  it('names the editor inputs, which have no default', () => {
    expect(inputKeys(PARAMS)).toEqual(['time_of_day']);
  });
});
