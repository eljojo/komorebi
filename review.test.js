// The review-sheet tool's pure parts (test-gl/review.mjs). The render path needs Chromium and is proven by a
// real run; what can silently go wrong without one is the spec's meaning, the argv handed to run.js, and
// the manifest merge that must never erase José's words.
import { describe, expect, test } from 'bun:test';
import { frameLabel, lookArgs, mergeManifest, overrideArgs, resolveFrame, specProblems, validateSpec } from './test-gl/review.mjs';

const spec = () => ({
  commit: 'HEAD',
  sheets: [
    {
      file: 'a.png',
      title: 'A',
      question: 'q?',
      common: { preset: 'montebello', overrides: { leaf_wetness: 0, litter: true } },
      frames: [
        { id: 'c1', what: 'dry' },
        { id: 'c2', preset: 'afternoon 7', overrides: { leaf_wetness: 0.5, name: 'x' }, label: 'c2  wet', what: 'wet' },
      ],
    },
  ],
});

describe('spec validation', () => {
  test('a good spec has no problems', () => expect(specProblems(spec())).toEqual([]));
  test('a frame with no preset anywhere is named', () => {
    const s = spec();
    delete s.sheets[0].common.preset;
    expect(specProblems(s).join('\n')).toContain('c1');
  });
  test('duplicate frame ids across sheets are refused (an ID must name one image)', () => {
    const s = spec();
    s.sheets.push({ file: 'b.png', frames: [{ id: 'c1', preset: 'x' }] });
    expect(specProblems(s).join('\n')).toContain('duplicate');
  });
  test('ids that cannot be file names, a non-png sheet, a bad tile and a bad size are refused', () => {
    const s = spec();
    s.sheets[0].frames[0].id = 'a/b';
    s.sheets[0].file = 'a.jpg';
    s.sheets[0].tile = '4';
    s.size = [640];
    expect(specProblems(s).length).toBeGreaterThanOrEqual(4);
  });
  test('validateSpec throws with every problem and returns the spec when fine', () => {
    expect(validateSpec(spec()).sheets.length).toBe(1);
    expect(() => validateSpec({ sheets: [] })).toThrow(/sheets/);
  });
});

describe('frame resolution and run.js arguments', () => {
  test('overrides merge common then frame; preset and size inherit', () => {
    const s = spec();
    const f2 = resolveFrame(s, s.sheets[0], s.sheets[0].frames[1]);
    expect(f2.preset).toBe('afternoon 7');
    expect(f2.overrides).toEqual({ leaf_wetness: 0.5, litter: true, name: 'x' });
    expect(f2.size).toEqual([640, 360]);
    const f1 = resolveFrame(s, s.sheets[0], s.sheets[0].frames[0]);
    expect(f1.preset).toBe('montebello');
  });
  test('size: frame over sheet common over spec over the 640x360 default', () => {
    const s = spec();
    s.size = [320, 180];
    expect(resolveFrame(s, s.sheets[0], s.sheets[0].frames[0]).size).toEqual([320, 180]);
    s.sheets[0].common.size = [100, 50];
    expect(resolveFrame(s, s.sheets[0], s.sheets[0].frames[0]).size).toEqual([100, 50]);
  });
  test('overrideArgs: strings quoted, numbers and booleans bare', () => {
    expect(overrideArgs({ a: 0.5, b: true, c: 'hi there', d: -3 })).toEqual(['a=0.5', 'b=true', 'c="hi there"', 'd=-3']);
  });
  test('lookArgs groups each frame under its own --look, repeatable', () => {
    const s = spec();
    const frames = s.sheets[0].frames.map((f) => resolveFrame(s, s.sheets[0], f));
    expect(lookArgs(frames)).toEqual([
      '--look', 'montebello', '--as', 'c1', '--size', '640x360', 'leaf_wetness=0', 'litter=true',
      '--look', 'afternoon 7', '--as', 'c2', '--size', '640x360', 'leaf_wetness=0.5', 'litter=true', 'name="x"',
    ]);
  });
});

describe('labels', () => {
  test('the frame label wins; else "<id>  <what>"; else the id', () => {
    expect(frameLabel({ id: 'c2', label: 'c2  wet', what: 'w' })).toBe('c2  wet');
    expect(frameLabel({ id: 'c1', what: 'dry' })).toBe('c1  dry');
    expect(frameLabel({ id: 'c1' })).toBe('c1');
  });
});

describe('manifest merge', () => {
  const sheet = (file, frames, extra = {}) => ({ file, ids: '', question: '', common: {}, frames, lead_read: null, jose: null, ...extra });
  const fr = (id, extra = {}) => ({ id, file: `frames/${id}.png`, preset: 'p', size: [1, 1], overrides: {}, harness_hash: 'aa', what: '', sha256: 'x', ...extra });

  test('lead_read and jose survive a re-run', () => {
    const old = { sheets: [sheet('a.png', [fr('c1')], { lead_read: 'mine', jose: 'k2 is right' })] };
    const fresh = { sheets: [sheet('a.png', [fr('c1', { harness_hash: 'bb' })])] };
    const m = mergeManifest(old, fresh).sheets[0];
    expect(m.jose).toBe('k2 is right');
    expect(m.lead_read).toBe('mine');
    expect(m.frames[0].harness_hash).toBe('bb');
  });
  test('sheets and frames not in the new spec survive; a new frame id is added', () => {
    const old = { sheets: [sheet('a.png', [fr('c1'), fr('c9')]), sheet('z.png', [fr('z1')])] };
    const fresh = { sheets: [sheet('a.png', [fr('c1'), fr('c2')])] };
    const m = mergeManifest(old, fresh);
    expect(m.sheets.map((s) => s.file)).toEqual(['a.png', 'z.png']);
    expect(m.sheets[0].frames.map((f) => f.id)).toEqual(['c1', 'c2', 'c9']);
  });
  test('no existing manifest: the fresh one stands', () => {
    const fresh = { sheets: [sheet('a.png', [fr('c1')])] };
    expect(mergeManifest(null, fresh)).toEqual(fresh);
  });
  test('a fresh non-null jose/lead_read is not clobbered by the old, and null does not clobber the old', () => {
    const old = { sheets: [sheet('a.png', [], { jose: 'old' })] };
    expect(mergeManifest(old, { sheets: [sheet('a.png', [], { jose: 'new' })] }).sheets[0].jose).toBe('new');
  });
});
