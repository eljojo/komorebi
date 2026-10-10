import { describe, expect, it } from 'vitest';
import { extractRows } from '../scripts/editor-rows.mjs';

// The shapes the pinned editor.js uses, including the things that trip a naive scanner: a quote and brackets
// inside a comment, a button row holding an arrow function, and a constant used as a bound.
const SNIPPET = `
const before = [1, 2, 3];
const PANEL = [
  ['h','Source'],
  ['s','cloud_thickness','CLOUD',0,1,0.01,'source'],
  ['adv','advanced'],
  ['s','branch_levels','levels',1,4,1,'canopy'],   // it's a "comment" with a ] bracket
  ['sel','litter','litter',[['off',0],['on',1]],''],
  ['sel','tex_resolution','res',[['1024',1024],['2048',2048]],'textures'],
  ['sels','phyllotaxis','phyllo',[['spiral','spiral'],['whorled','whorled']],'canopy'],
  ['btn','reseed', ()=>{ const x = [']', "'"]; return x; }],
  ['t','eclipse','eclipse','source'],
  ['s','layer_count','layers',1,MAX_LAYERS,1,'textures'],
  ['s','show_layer_index','layer #',0,MAX_LAYERS-1,1,''],
  ['s','sun_azimuth_deg','azim °',0,360,1,''],
];
const after = [['s','not_a_knob','no',0,1,1,'']];
`;

describe('extractRows', () => {
  const rows = extractRows(SNIPPET, { MAX_LAYERS: 4 });
  const byKey = (key: string) => rows.find((r: { key: string }) => r.key === key);

  it('reads slider rows as min, max and step', () => {
    expect(byKey('cloud_thickness')).toEqual({ kind: 's', key: 'cloud_thickness', min: 0, max: 1, step: 0.01 });
    expect(byKey('branch_levels')).toEqual({ kind: 's', key: 'branch_levels', min: 1, max: 4, step: 1 });
  });

  it('reads select rows as their numeric values, and sels rows as their strings', () => {
    expect(byKey('litter')).toEqual({ kind: 'sel', key: 'litter', choices: [0, 1] });
    expect(byKey('tex_resolution')).toEqual({ kind: 'sel', key: 'tex_resolution', choices: [1024, 2048] });
    expect(byKey('phyllotaxis')).toEqual({ kind: 'sels', key: 'phyllotaxis', choices: ['spiral', 'whorled'] });
  });

  it('resolves a constant, and a constant minus one, from the constants it is given', () => {
    expect(byKey('layer_count')).toMatchObject({ min: 1, max: 4 });
    expect(byKey('show_layer_index')).toMatchObject({ min: 0, max: 3 });
  });

  it('skips headings, toggles, buttons and anything outside PANEL', () => {
    expect(rows.map((r: { key: string }) => r.key)).toEqual([
      'cloud_thickness', 'branch_levels', 'litter', 'tex_resolution', 'phyllotaxis', 'layer_count', 'show_layer_index', 'sun_azimuth_deg',
    ]);
  });

  it('refuses a name it was not given a value for, rather than reaching for a global', () => {
    expect(() => extractRows("const PANEL = [['s','a','A',0,MAX_THINGS,1,'']];", { MAX_LAYERS: 4 })).toThrow(/MAX_THINGS/);
    expect(() => extractRows("const PANEL = [['s','a','A',0,process,1,'']];", {})).toThrow(/process/);
  });

  it('refuses a source with no PANEL', () => {
    expect(() => extractRows('const x = 1;', {})).toThrow(/PANEL/);
  });
});
