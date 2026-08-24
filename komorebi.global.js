// ============================================================================
// Deploy shim — the bundle entry for external, no-build embeds (eljojo.net).
// It re-creates the old window.Komorebi global from the ES-module engine +
// presets, so a plain `<script src="dist/komorebi.player.min.js">` still exposes
// Komorebi.create / Komorebi.PRESETS exactly as before. `nix run .#build` bundles
// this with bun into dist/komorebi.player.min.js — the whole engine, every look.
// `nix run .#embed -- '<look>'...` bundles this SAME entry for one page's looks
// only (dist/komorebi.embed.min.js): unreachable cameras, unnamed presets, the
// GLSL prose and the editor tier are cut, and embed-check proves the kept looks
// still render byte-identically. See embed-build.mjs for what each cut rests on.
// The editor and player.html in THIS repo import the modules directly and never
// touch this file — it exists only for classic-script consumers.
// ============================================================================
import { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG } from "./komorebi.js";
import { PRESETS } from "./presets.js";

window.Komorebi = { create, PRESETS, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG };
