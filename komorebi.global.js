// ============================================================================
// Deploy shim — the bundle entry for external, no-build embeds (eljojo.net).
// It re-creates the old window.Komorebi global from the ES-module engine +
// presets, so a plain `<script src="dist/komorebi.player.min.js">` still exposes
// Komorebi.create / Komorebi.PRESETS exactly as before. `nix run .#build` bundles
// this with bun (IIFE, --define:KOMOREBI_EDITOR=false strips the editor overlays).
// The editor and player.html in THIS repo import the modules directly and never
// touch this file — it exists only for classic-script consumers.
// ============================================================================
import { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG } from "./komorebi.js";
import { PRESETS } from "./presets.js";

window.Komorebi = { create, PRESETS, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG };
