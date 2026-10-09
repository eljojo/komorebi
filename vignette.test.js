// The edge fade (§4.7, "the projector's soft iris"): a mask on the LIGHT, `vignette` the gate and the feather,
// `vignette_shape` the superellipse exponent. vignetteMask is the shader's formula as a pure function; the string
// tests hold the shader and the registry to the same sentence. Run: `bun test vignette.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, TRANSPORT_GROUPS, buildTransport } from "./komorebi.js";
import { vignetteMask } from "./komorebi-math.js";

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

test("feather 0 is off: the mask is 1 everywhere, corners included, whatever the shape", () => {
  for (const shape of [2, 5, 8])
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.97, 0.5], [0.2, 0.9], [1, 0]])
      expect(vignetteMask(u, v, 0, shape)).toBe(1);
});

test("the centre is fully lit at any feather, and the four corners are black at any feather > 0 and shape 2..8", () => {
  for (const f of [0.01, 0.3, 1]) for (const shape of [2, 3.5, 8]) {
    expect(vignetteMask(0.5, 0.5, f, shape)).toBe(1);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(vignetteMask(u, v, f, shape), `${f}/${shape}`).toBe(0);
  }
});

test("black at the middle of every edge too: the mask touches all four edges, aspect-free", () => {
  for (const [u, v] of [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]]) expect(vignetteMask(u, v, 0.2, 2)).toBe(0);
});

test("monotone non-increasing along a ray from the centre", () => {
  for (const shape of [2, 5, 8]) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [0.6, 1]]) {
    let prev = 1;
    for (let i = 0; i <= 100; i++) {
      const u = 0.5 + 0.5 * dx * i / 100, v = 0.5 + 0.5 * dy * i / 100;
      const m = vignetteMask(u, v, 0.4, shape);
      expect(m).toBeLessThanOrEqual(prev + 1e-12);
      prev = m;
    }
  }
});

test("shape 2: 1 inside radius (1 - feather) of the ellipse touching the edges, then the smoothstep", () => {
  const f = 0.25;
  // q = (0.5, 0.5) -> d = sqrt(0.5) = 0.7071 < 0.75: fully lit.
  expect(vignetteMask(0.75, 0.75, f, 2)).toBe(1);
  // q = (0.6, 0.6)... d = 0.8485; expected from the formula.
  expect(vignetteMask(0.8, 0.8, f, 2)).toBeCloseTo(1 - ss(0.75, 1, Math.hypot(0.6, 0.6)), 12);
  // On an axis d = |q| for every shape: (0.95, 0.5) is q = (0.9, 0), d = 0.9, mask 1 - smoothstep(0.75, 1, 0.9) = 0.352.
  expect(vignetteMask(0.95, 0.5, f, 2)).toBeCloseTo(0.352, 12);
});

test("the shape lives off-axis: on the axis every exponent agrees, at the diagonal 8 is a rounded rectangle and keeps the corner-ward light", () => {
  const f = 0.3;
  // On-axis d = q.x for any exponent, so (0.95, 0.5) is the SAME at shape 2 and 8: 1 - smoothstep(0.7, 1, 0.9) = 0.2593.
  expect(vignetteMask(0.95, 0.5, f, 8)).toBeCloseTo(vignetteMask(0.95, 0.5, f, 2), 12);
  expect(vignetteMask(0.95, 0.5, f, 8)).toBeCloseTo(1 - 20 / 27, 12);
  // (0.9, 0.9): q = (0.8, 0.8). Shape 2: d = 0.8*sqrt2 = 1.131 -> black. Shape 8: d = 0.8*2^(1/8) = 0.8723 -> 0.390.
  expect(vignetteMask(0.9, 0.9, f, 2)).toBe(0);
  expect(vignetteMask(0.9, 0.9, f, 8)).toBeCloseTo(1 - ss(0.7, 1, 0.8 * Math.pow(2, 1 / 8)), 12);
  expect(vignetteMask(0.9, 0.9, f, 8)).toBeGreaterThan(0.38);
  expect(vignetteMask(0.9, 0.9, f, 8)).toBeLessThan(0.40);
});

test("classified: both keys are defaults (off), both tween, and no FEATURES entry is needed", () => {
  expect(DEFAULTS.vignette).toBe(0);
  expect(DEFAULTS.vignette_shape).toBe(2);
  expect(MORPH_KEYS).toContain("vignette");
  expect(MORPH_KEYS).toContain("vignette_shape");
});

test("the post group declares and locates both uniforms, and every camera's program carries the mask exactly once", () => {
  expect(TRANSPORT_GROUPS.post.decls).toContain("uniform float uVignette;");
  expect(TRANSPORT_GROUPS.post.decls).toContain("uniform float uVignetteShape;");
  expect(TRANSPORT_GROUPS.post.locs.vignette).toBe("uVignette");
  expect(TRANSPORT_GROUPS.post.locs.vignetteShape).toBe("uVignetteShape");
  for (const cam of ["floor", "cloth", "enclosure", "sky"]) {
    const src = buildTransport(cam);
    expect(src.split("THE EDGE (§4.7)").length - 1, cam).toBe(1);
    // The mask's own lines, each once, pinned by text: they are vignetteMask (komorebi-math.js) line for line — the gate, q, the
    // superellipse radius, the fade — so the shader cannot drift from the reference the numbers above hold, and a missing line fails here.
    const lines = [
      "if(uVignette > 0.0){",                                                                           // if (!(feather > 0)) return 1
      "vec2 q = abs(vUv*2.0 - 1.0);",                                                                    // qx, qy = |u·2 − 1|, |v·2 − 1|
      "float d = pow(pow(q.x, uVignetteShape) + pow(q.y, uVignetteShape), 1.0/uVignetteShape);",        // d = (qx^n + qy^n)^(1/n)
      "col *= 1.0 - smoothstep(1.0 - uVignette, 1.0, d);",                                               // 1 − smoothstep(1 − feather, 1, d)
    ];
    for (const l of lines) expect(src.split(l).length - 1, `${cam}: ${l}`).toBe(1);
    const at = lines.map((l) => src.indexOf(l)), tail = src.indexOf("if(uLinearOut == 0) col = toneTail(col);");
    expect(tail, cam).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < at.length; i++) expect(at[i], `${cam}: in order`).toBeGreaterThan(at[i - 1]);
    // Before the tail, not after: the glow tier spreads masked light.
    expect(at[at.length - 1], cam).toBeLessThan(tail);
  }
});
