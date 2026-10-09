// The review-sheet tool's pure parts (test-gl/review.mjs). The render path needs Chromium and is proven by a
// real run; what can silently go wrong without one is the spec's meaning, the argv handed to run.js, and
// the manifest merge that must never erase José's words.
import { describe, expect, test } from 'bun:test';
import { folderCommits, folderProblems, frameLabel, lookArgs, mergeManifest, mergeSpec, overrideArgs, resolveFrame, specProblems, validateSpec } from './test-gl/review.mjs';

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

describe('the folder: one commit, and an id names one image', () => {
  const A = 'a'.repeat(40), B = 'b'.repeat(40);
  const sheet = (file, ids, extra = {}) => ({ file, frames: ids.map((id) => ({ id })), ...extra });
  const legacy = { how_rendered: { source_tree: `git archive ${A} exported to a temp dir` }, sheets: [sheet('a.png', ['c1', 'c2'])] };

  test('a new folder has no problems', () => expect(folderProblems(null, spec(), A)).toEqual([]));
  test("a manifest from before sheets carried a commit is read by its source tree; a sheet's own commit wins", () => {
    expect(folderCommits(legacy)).toEqual([A]);
    expect(folderCommits({ ...legacy, sheets: [sheet('a.png', ['c1'], { commit: B })] })).toEqual([B]);
  });
  test('re-rendering the same commit into its folder is fine, the same sheet keeping its ids', () => {
    expect(folderProblems(legacy, spec(), A)).toEqual([]);
  });
  test('another commit into the folder is refused, so no sheet is attributed to a commit it was not rendered from', () => {
    expect(folderProblems(legacy, spec(), B).join('\n')).toContain('holds renders of');
  });
  test('an id the folder holds on another sheet is refused, whether or not that sheet is re-rendered (frames/<id>.png would change under it)', () => {
    const s = spec();
    s.sheets[0].file = 'b.png';   // c1 and c2 on a new sheet, while a.png holds them
    const p = folderProblems(legacy, s, A).join('\n');
    expect(p).toContain('c1');
    expect(p).toContain('c2');
    s.sheets.push(sheet('a.png', ['c9']));   // a.png re-rendered without them: still one id, two sheets
    expect(folderProblems(legacy, s, A).length).toBe(2);
  });
  test('mergeSpec keeps the sheets the new spec does not mention, so the folder re-renders from itself', () => {
    const old = { sheets: [sheet('z.png', ['z1']), sheet('a.png', ['c1'])] };
    expect(mergeSpec(old, spec()).sheets.map((s) => s.file)).toEqual(['a.png', 'z.png']);
    expect(mergeSpec(null, spec()).sheets.map((s) => s.file)).toEqual(['a.png']);
  });
  test("a kept sheet keeps the size it was rendered at: the old spec's top-level size moves into its common.size", () => {
    const old = { size: [320, 180], sheets: [sheet('z.png', ['z1'], { common: { preset: 'p' } }), sheet('y.png', ['y1'], { common: { size: [100, 50] } })] };
    const m = mergeSpec(old, { ...spec(), size: [640, 360] });
    const z = m.sheets.find((s) => s.file === 'z.png'), y = m.sheets.find((s) => s.file === 'y.png');
    expect(resolveFrame(m, z, z.frames[0]).size).toEqual([320, 180]);
    expect(z.common.preset).toBe('p');
    expect(resolveFrame(m, y, y.frames[0]).size, "a sheet's own size stands").toEqual([100, 50]);
    expect(resolveFrame(m, m.sheets[0], m.sheets[0].frames[0]).size, 'the new sheets take the new size').toEqual([640, 360]);
  });
});
