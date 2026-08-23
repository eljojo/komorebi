// glslcheck.mjs — compile every GLSL shader in komorebi.js, offline, with no GPU and no browser.
//
//   node glslcheck.mjs        (from the repo root; exits non-zero if any shader fails to compile)
//
// WHY THIS EXISTS: the shaders live inside JS template literals, so nothing type-checks them until a real
// WebGL2 context compiles them at runtime — which needs a GPU, a browser and a served page. A typo therefore
// survives `bun test`, survives lint, and only surfaces as a black canvas. This pulls each `const XS_NAME = \`…\``
// out of the source, resolves its `${…}` interpolations against the engine's own constants, asserts none
// survived, and hands the result to glslangValidator.
//
// Stage comes from the name: VS_* compile as vertex, FS_* as fragment. GLSL_* literals are shared SNIPPETS
// (spliced into other shaders through an interpolation), not standalone units, so they are resolved but not
// compiled on their own. Both conventions are the engine's existing ones — nothing here needs registering.
//
// glslangValidator is taken from PATH, else run through `nix shell nixpkgs#glslang`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(ROOT, "komorebi.js");

// ---- pull one backtick-delimited literal out of the source, given the index just past its opening backtick.
// The shaders contain no nested template expressions and no escaped backticks; the escape check is there so a
// future GLSL comment mentioning one can't silently truncate a shader (the same hazard that terminates the
// template literal in komorebi.js itself).
function literalAt(text, start) {
  let j = start;
  for (;;) {
    const k = text.indexOf("`", j);
    if (k < 0) return null;
    if (text[k - 1] === "\\") { j = k + 1; continue; }
    return text.slice(start, k);
  }
}

const text = readFileSync(SOURCE, "utf8");

// ---- the substitution table, derived from the source rather than hard-coded, so a new MAX_* cap or a new
// shared GLSL_* snippet is picked up without touching this file.
const subs = new Map();
for (const m of text.matchAll(/^const ([A-Z][A-Z0-9_]*) = (-?\d+(?:\.\d+)?);/gm)) subs.set(m[1], m[2]);

// ---- every shader-ish literal, in source order.
const shaders = [];
for (const m of text.matchAll(/^const ((?:VS|FS|GLSL)_[A-Z0-9_]*) = `/gm)) {
  const body = literalAt(text, m.index + m[0].length);
  if (body === null) { console.error(`unterminated template literal: ${m[1]}`); process.exit(2); }
  const name = m[1];
  if (name.startsWith("GLSL_")) subs.set(name, body);
  else shaders.push({ name, body, stage: name.startsWith("VS_") ? "vert" : "frag" });
}
if (shaders.length === 0) { console.error(`no shaders found in ${SOURCE}`); process.exit(2); }

// ---- resolve interpolations. Repeated passes because a snippet may itself interpolate; bounded so a cycle
// reports instead of hanging.
function resolve(src) {
  let out = src;
  for (let pass = 0; pass < 8 && out.includes("${"); pass++) {
    out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, key) => (subs.has(key) ? subs.get(key) : whole));
  }
  return out;
}

// ---- how to run the validator: PATH first, else through nix.
const onPath = spawnSync("glslangValidator", ["--version"], { encoding: "utf8" }).status === 0;
const runner = onPath
  ? (args) => spawnSync("glslangValidator", args, { encoding: "utf8" })
  : (args) => spawnSync("nix", ["shell", "nixpkgs#glslang", "-c", "glslangValidator", ...args], { encoding: "utf8" });
if (!onPath) {
  const probe = runner(["--version"]);
  if (probe.status !== 0) {
    console.error("glslangValidator not found on PATH and `nix shell nixpkgs#glslang` failed:");
    console.error((probe.stderr || probe.error?.message || "").trim());
    process.exit(2);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "komorebi-glsl-"));
let failed = 0;
for (const s of shaders) {
  const src = resolve(s.body);
  const left = src.match(/\$\{[^}]*\}/g);
  const file = join(outDir, `${s.name}.${s.stage}`);
  writeFileSync(file, src);
  if (left) {
    console.log(`FAIL  ${s.name.padEnd(14)} ${s.stage}  unresolved interpolation(s): ${[...new Set(left)].join(" ")}`);
    failed++;
    continue;
  }
  const r = runner(["-S", s.stage, file]);
  if (r.status === 0) {
    console.log(`ok    ${s.name.padEnd(14)} ${s.stage}  ${src.split("\n").length} lines`);
  } else {
    console.log(`FAIL  ${s.name.padEnd(14)} ${s.stage}`);
    console.log(`${(r.stdout || "").trim()}\n${(r.stderr || "").trim()}`.trim());
    failed++;
  }
}
console.log(`\n${shaders.length - failed}/${shaders.length} shaders compiled   (assembled sources: ${outDir})`);
process.exit(failed ? 1 : 0);
