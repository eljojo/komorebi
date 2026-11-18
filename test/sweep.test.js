// The orphan sweep (embed-build.mjs, sweepOrphans): a shader string nothing references is deleted, and what only it referenced with it.
// Run: `bun test sweep.test.js`.
import { test, expect } from "bun:test";
import { sweepOrphans } from "../embed-build.mjs";

const interp = (x) => `$\{${x}}`;   // a template literal's `${}`, written so the source holds no literal one inside a string
const sweep = (files) => {
  const tree = new Map(Object.entries(files));
  const swept = sweepOrphans(tree);
  return { swept: swept.sort(), out: Object.fromEntries(tree) };
};

test("a string used by code stays; one only its own declaration and the lists name goes, with its list entries", () => {
  const { swept, out } = sweep({
    "a.js": "const GLSL_USED = `u`;\nconst GLSL_DEAD = `d`;\nexport { GLSL_USED, GLSL_DEAD };\nconsole.log(GLSL_USED);\n",
  });
  expect(swept).toEqual(["GLSL_DEAD"]);
  expect(out["a.js"]).toBe("const GLSL_USED = `u`;\nexport { GLSL_USED };\nconsole.log(GLSL_USED);\n");
});

test("a longer identifier that contains the name is not a use of it", () => {
  const { swept } = sweep({
    "a.js": "const GLSL_A = `a`;\nconst GLSL_AB = `b`;\nconst x$GLSL_A = 1, GLSL_A2 = 2, FOO_GLSL_A = 3;\nconsole.log(GLSL_AB, x$GLSL_A, GLSL_A2, FOO_GLSL_A);\n",
  });
  expect(swept).toEqual(["GLSL_A"]);
});

test("a mention in a comment does not keep a string alive; one in a string or template does", () => {
  const { swept } = sweep({
    "a.js": [
      "const GLSL_C = `c`;",
      "const GLSL_D = `d`;",
      "const GLSL_E = `e`;",
      "// GLSL_C",
      "/* GLSL_C */",
      `const s = 'GLSL_D', t = \`x ${interp(1)} GLSL_E\`;`,
      "console.log(s, t);",
      "",
    ].join("\n"),
  });
  expect(swept).toEqual(["GLSL_C"]);
});

test("a use in another file keeps it; a string only another orphan uses falls in a later round", () => {
  const { swept, out } = sweep({
    "a.js": `const VS_TOP = \`${interp("FS_INNER")}\`;\nconst FS_INNER = \`i\`;\nconst GLSL_KEPT = \`k\`;\nexport { VS_TOP, FS_INNER, GLSL_KEPT };\n`,
    "b.js": "import { GLSL_KEPT } from './a.js';\nconsole.log(GLSL_KEPT);\n",
  });
  expect(swept).toEqual(["FS_INNER", "VS_TOP"]);
  expect(out["a.js"]).toBe("const GLSL_KEPT = `k`;\nexport { GLSL_KEPT };\n");
});
