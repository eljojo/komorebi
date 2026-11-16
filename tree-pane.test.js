// ============================================================================
// The workspace's tree pane (tree-pane.js): the discs it draws and the frame it draws them in, pure. Its pixels are the editor
// smoke's (test-gl/editor.mjs), which reads them off the pane's own canvas.
// ============================================================================
import { test, expect } from "bun:test";
import { paneScene, paneCamera } from "./tree-pane.js";

const look = { leaf_size_m: 0.1, trunk_radius_m: 0.2, branch_children: 3, taper_delta: 2 };
// a trunk 4 m up, one limb out to +x, and three leaves (one faded out entirely)
const segs = [{ a: [0, 0, 0], b: [0, 0, 4], level: 0, f0: 0 }, { a: [0, 0, 3], b: [2, 0, 4], level: 1, f0: 0 }];
const leaves = new Float32Array([2, 0, 4, 1, 0, 1, 1.5, 0.5, 3.8, 1, 0, 0.6, -1, 0, 3, 0, 0, 1]);

test("one disc a leaf that is there, wood at the pipe model's width, a frame from the grove's own bounds", () => {
  const s = paneScene(leaves, segs, look), kinds = [0, 0, 0], radii = [];
  for (let i = 0; i < s.discs.length/5; i++) { kinds[s.discs[5*i + 4]]++; if (s.discs[5*i + 4] === 0) radii.push(s.discs[5*i + 3]); }
  expect(kinds[1]).toBe(2);                                      // the faded leaf is not drawn
  expect(Math.max(...radii)).toBeCloseTo(0.2);                   // the trunk at trunk_radius_m
  expect(Math.min(...radii)).toBeCloseTo(0.2*Math.pow(3, -1/2)); // the limb a level thinner
  expect(s.top).toBeCloseTo(4);
  expect(s.mx).toBeCloseTo(1);                                   // the plan centre of everything drawn (x 0..2, y 0..0.5), the faded leaf not counted
  expect(s.my).toBeCloseTo(0.25);
  expect(s.R).toBeCloseTo(Math.hypot(1, 0.25));
  const leafAt = [...Array(s.discs.length/5).keys()].filter((i) => s.discs[5*i + 4] === 1).map((i) => s.discs[5*i + 3]);
  leafAt.sort((a, b) => a - b);
  expect(leafAt[0]).toBeCloseTo(0.1*0.6*0.5, 6);                 // each leaf at half its own size (its radius)
  expect(leafAt[1]).toBeCloseTo(0.1*1*0.5, 6);
});

test("the side view stands the tree on the ground band and fits its height and width", () => {
  const s = paneScene(leaves, segs, look);
  for (const [w, h] of [[400, 600], [900, 300]]) {
    const c = paneCamera(s, w, h, "side");
    expect(c.baseY).toBe(h - c.ground);
    expect(c.baseY - s.top*c.px).toBeGreaterThanOrEqual(0);      // the top inside the pane
    expect(2*s.R*c.px).toBeLessThanOrEqual(w);                   // the crown's width inside it
    const t = paneCamera(s, w, h, "turn");
    expect(t.pitch).toBeGreaterThan(0);
  }
});
