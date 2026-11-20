// ============================================================================
// The wood under its own penumbra (spec/model/canopy.md, the faithful cast; komorebi-bake.js finePartition, VS_FAITH_SEG_FINE / FS_FAITH_SEG_FINE): a capsule
// narrower than the sun's disk at its height is cast once, at the samples' mean shift, as a box with the samples' spread across its spine, passing the
// share of the light its own width leaves. The lines that carry the law are held to the shader's and the bake's text; the law is held here: the box has the
// samples' variance, and on average it takes from the floor exactly the light the twig takes, sample by sample.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { VS_FAITH_SEG, FS_FAITH_SEG, VS_FAITH_SEG_FINE, FS_FAITH_SEG_FINE } from "../engine/transport/komorebi-shaders.js";

const BAKE = readFileSync("engine/transport/komorebi-bake.js", "utf8");

test("the fine pair is the skeleton's own with SEG_FINE defined, and only that", () => {
  expect(VS_FAITH_SEG_FINE).toBe(VS_FAITH_SEG.replace("#version 300 es\n", "#version 300 es\n#define SEG_FINE\n"));
  expect(FS_FAITH_SEG_FINE).toBe(FS_FAITH_SEG.replace("#version 300 es\n", "#version 300 es\n#define SEG_FINE\n"));
  expect(VS_FAITH_SEG).not.toContain("#define SEG_FINE");
});

test("fine is narrower than the sun's disk at the capsule's lowest end, gated by thin_twigs off a receiver", () => {
  expect(BAKE).toContain("const SUN_DIAM = 0.0093;");
  expect(Math.abs(0.0093 - 2 * 0.2665 * Math.PI / 180)).toBeLessThan(1e-4);   // the sun's mean angular diameter, 0.533°
  expect(BAKE).toContain("2*Math.max(s.ra, s.rb) < Math.min(s.ha, s.hb)*SUN_DIAM");
  expect(BAKE).toContain("    if(!params.thin_twigs || params.receiver) return null;");
});

test("the box has the samples' variance, is never under three quarters of a texel, and passes the share of the light the twig's width leaves", () => {
  expect(VS_FAITH_SEG).toContain("  float halfW = max(max(r, 1.7320508*h*sqrt(max(s2, 0.0))), 0.75*uTexel);");
  expect(VS_FAITH_SEG).toContain("  vFrac = r/halfW; r = halfW;");
  expect(FS_FAITH_SEG).toContain("  frag = vec4(vec3(1.0 - vFrac*(1.0 - exp(-uWoodTau*cov*vWoodFade))), 1.0);");
  // a uniform box of half-width a has variance a²/3: at a = √3·σ, σ²
  const sigma = 0.37, a = 1.7320508 * sigma;
  expect((a * a) / 3).toBeCloseTo(sigma * sigma, 6);
  // the light taken, integrated across the spine: the box (width 2a, darkening frac·(1 − e^−τ)) against the twig itself (width 2r, 1 − e^−τ), each sample
  for (const [r, tau] of [[0.001, 2], [0.004, 0.5], [0.01, 6]]) {
    const taken = 2 * a * (r / a) * (1 - Math.exp(-tau)), twig = 2 * r * (1 - Math.exp(-tau));
    expect(taken).toBeCloseTo(twig, 12);
  }
});

test("the fine capsules are drawn once, after the samples, multiplied onto the cast, and the attributes are put back for the next draw", () => {
  expect(BAKE).toContain("if(woodOn && nCoarse > 0)");
  expect(BAKE).toMatch(/ptrs\(nCoarse\*36\);[\s\S]{0,200}faith\.segCount - nCoarse[\s\S]{0,120}ptrs\(0\)/);
  expect(BAKE).toMatch(/blendFunc\(gl\.ZERO, *gl\.SRC_COLOR\)/);
});
