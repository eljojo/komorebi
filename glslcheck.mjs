// glslcheck.mjs — compile every GLSL shader in the engine modules, offline, with no GPU and no browser.
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
// TRANSPORT is the exception, and it is why this file also IMPORTS the engine. Transport is no longer a single
// literal: it is a set of snippets that buildTransport() assembles into one straight-line program per camera
// (spec/model/transport.md, receivers.md), so the text alone holds no compilable transport shader at all. Asking the module for each
// variant's assembled source is the only honest check — and it is the check that matters, because a snippet
// that lands in a variant missing the uniform it reads fails HERE rather than as a black canvas.
//
// glslangValidator is taken from PATH, else run through `nix shell nixpkgs#glslang`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble, writeTree } from "./embed-build.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
// The engine's source modules, scanned as text for shader literals and the numeric-constant substitution
// table. Structural, not a hand-kept list: every komorebi*.js at the root and every module under engine/ is scanned (the
// barrel and the global shim carry no literals today, but a literal added to ANY of them is found rather than skipped).
const SOURCES = [
  ...readdirSync(ROOT).filter((f) => /^komorebi.*\.js$/.test(f)),
  ...readdirSync(join(ROOT, "engine"), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `engine/${f}`),
].sort();

// ---- pull one backtick-delimited literal out of the source, given the index just past its opening backtick.
// The shaders contain no nested template expressions and no escaped backticks; the escape check is there so a
// future GLSL comment mentioning one can't silently truncate a shader (the same hazard that terminates the
// template literal in the engine source itself).
function literalAt(text, start) {
  let j = start;
  for (;;) {
    const k = text.indexOf("`", j);
    if (k < 0) return null;
    if (text[k - 1] === "\\") { j = k + 1; continue; }
    return text.slice(start, k);
  }
}

// ---- scan per file (an unterminated literal is then reported against ITS file instead of silently
// swallowing the next file's source): the substitution table — derived from the source rather than
// hard-coded, so a new MAX_* cap or a new shared GLSL_* snippet is picked up without touching this file —
// then every shader-ish literal, in source order. A name defined twice across modules fails loudly: the
// table is flat, so a silent clobber would resolve some shader against the wrong value.
const subs = new Map();
const setSub = (name, value, file) => {
  if (subs.has(name) && subs.get(name) !== value) { console.error(`substitution '${name}' redefined with a different value in ${file}`); process.exit(2); }
  subs.set(name, value);
};
const shaders = [];
for (const file of SOURCES) {
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const m of text.matchAll(/^const ([A-Z][A-Z0-9_]*) = (-?\d+(?:\.\d+)?);/gm)) setSub(m[1], m[2], file);
  for (const m of text.matchAll(/^const ((?:VS|FS|GLSL)_[A-Z0-9_]*) = `/gm)) {
    const body = literalAt(text, m.index + m[0].length);
    if (body === null) { console.error(`unterminated template literal: ${m[1]} in ${file}`); process.exit(2); }
    const name = m[1];
    if (body.includes("${afterVersion(")) continue;   // a variant written as its base with a name defined (komorebi-shaders.js afterVersion): derived below
    if (name.startsWith("GLSL_")) setSub(name, body, file);
    else shaders.push({ name, body, stage: name.startsWith("VS_") ? "vert" : "frag" });
  }
}
if (shaders.length === 0) { console.error(`no shaders found in ${SOURCES.join(", ")}`); process.exit(2); }
const literalCount = shaders.length;

// ---- the transport variants, from the module itself (see the header). One entry per camera; the assembled
// source arrives with its interpolations already resolved, so it drops straight into the same loop below.
const { TRANSPORT_CAMERAS, buildTransport } = await import(pathToFileURL(join(ROOT, "komorebi.js")).href);
for (const cam of TRANSPORT_CAMERAS) shaders.push({ name: `FS_TRANSPORT_${cam}`, body: buildTransport(cam), stage: "frag" });
shaders.push({ name: "FS_TRANSPORT_floor_sky", body: buildTransport("floor", true), stage: "frag" });   // view_sky's variant of the floor
// trunk_base's wood program: the wood's literal with its feet defined in (komorebi-shaders.js VS_TREE_WOOD_FOOT, which derives it the same way)
const woodLit = shaders.find((x) => x.name === "VS_TREE_WOOD");
shaders.push({ ...woodLit, name: "VS_TREE_WOOD_FOOT", body: woodLit.body.replace("#version 300 es\n", "#version 300 es\n#define WOOD_FOOT\n") });
// the leaf's and the wood's programs as the tree view makes them (komorebi-tree-view.js treeNames): FS_TREE and FS_TREE_WOOD with every set of the names a look
// may ask for defined, crown_light's grid read and view_sky's sky (komorebi-shaders.js defineIn, the same derivation)
for (const n of ["FS_TREE", "FS_TREE_WOOD"]) for (const names of [["CROWN_FIELD"], ["VIEW_SKY"], ["CROWN_FIELD", "VIEW_SKY"]]) {
  const lit = shaders.find((x) => x.name === n);
  shaders.push({ ...lit, name: `${n}+${names.join("+")}`, body: lit.body.replace("#version 300 es\n", `#version 300 es\n${names.map((d) => `#define ${d}\n`).join("")}`) });
}
// twig_joints' leaf in the tree view: VS_TREE with RUN_PIVOT defined (komorebi-tree-view.js program, the same derivation)
{ const lit = shaders.find((x) => x.name === "VS_TREE"); shaders.push({ ...lit, name: "VS_TREE+RUN_PIVOT", body: lit.body.replace("#version 300 es\n", "#version 300 es\n#define RUN_PIVOT\n") }); }
// thin_twigs' cast of the wood under its own penumbra: the skeleton's two literals with SEG_FINE defined (komorebi-shaders.js VS/FS_FAITH_SEG_FINE)
for (const n of ["VS_FAITH_SEG", "FS_FAITH_SEG"]) { const lit = shaders.find((x) => x.name === n); shaders.push({ ...lit, name: `${n}_FINE`, body: lit.body.replace("#version 300 es\n", "#version 300 es\n#define SEG_FINE\n") }); }

// Compile the sources after bundling strips comments and prunes camera and feature code.
const outDir = mkdtempSync(join(tmpdir(), "komorebi-glsl-"));
const bundledAt = shaders.length;
for (const [name, looks] of [["player", undefined], ["homepage", ["morning 2", "afternoon 5b", "morning 3"]], ["tree", ["dows lake"]]]) {
  const { files, cameras } = assemble({ looks }), dir = join(outDir, name);
  writeTree(files, dir);
  const transport = await import(pathToFileURL(join(dir, "engine/transport/komorebi-transport.js")).href);
  const tree = await import(pathToFileURL(join(dir, "engine/transport/komorebi-shaders.js")).href);
  const add = (variant, body) => shaders.push({ name: `bundle_${name}_${variant}`, body, stage: "frag" });
  for (const cam of cameras) add(cam, transport.buildTransport(cam));
  if (cameras.includes("floor")) add("floor_sky", transport.buildTransport("floor", true));
  for (const n of ["FS_TREE", "FS_TREE_WOOD"]) if (tree[n]) {
    for (const defines of [[], ["CROWN_FIELD"], ["VIEW_SKY"], ["CROWN_FIELD", "VIEW_SKY"]]) {
      add([n, ...defines].join("+"), tree.defineIn(tree[n], defines));
    }
  }
}

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

const pad = Math.max(...shaders.map((s) => s.name.length));
let failed = 0;
for (const s of shaders) {
  const src = resolve(s.body);
  const left = src.match(/\$\{[^}]*\}/g);
  const file = join(outDir, `${s.name}.${s.stage}`);
  writeFileSync(file, src);
  if (left) {
    console.log(`FAIL  ${s.name.padEnd(pad)} ${s.stage}  unresolved interpolation(s): ${[...new Set(left)].join(" ")}`);
    failed++;
    continue;
  }
  const r = runner(["-S", s.stage, file]);
  if (r.status === 0) {
    console.log(`ok    ${s.name.padEnd(pad)} ${s.stage}  ${src.split("\n").length} lines`);
  } else {
    console.log(`FAIL  ${s.name.padEnd(pad)} ${s.stage}`);
    console.log(`${(r.stdout || "").trim()}\n${(r.stderr || "").trim()}`.trim());
    failed++;
  }
}
console.log(`\n${shaders.length - failed}/${shaders.length} shaders compiled   (${literalCount} literals + ${bundledAt - literalCount} raw variants + ${shaders.length - bundledAt} bundled variants; assembled sources: ${outDir})`);
process.exit(failed ? 1 : 0);
