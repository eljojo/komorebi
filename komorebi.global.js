// ============================================================================
// Deploy shim — the bundle entry for external, no-build embeds (eljojo.net).
// It re-creates the old window.Komorebi global from the ES-module engine +
// presets, so a plain `<script src="dist/komorebi.player.min.js">` still exposes
// Komorebi.create / Komorebi.PRESETS exactly as before. `nix run .#build` bundles
// this into dist/komorebi.player.min.js with every SHIPPED look (the
// experimental ones, and the cameras only they use, are cut). `nix run .#embed
// -- '<look>'...` bundles this SAME entry for one page's looks only, into
// dist/komorebi.embed.min.js, and cuts the fall tiers none of those looks opens.
// The eljojo.net homepage loads that one, built for 'morning 2' 'afternoon 5b'
// 'morning 3' by .github/workflows/pages.yml. embed-build.mjs holds both, and
// embed-check proves the kept looks still render byte-identically.
// The editor and player.html in THIS repo import the modules directly and never
// touch this file — it exists only for classic-script consumers.
// ============================================================================
import { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG } from "./komorebi.js";
import { PRESETS } from "./presets.js";

window.Komorebi = { create, PRESETS, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG };
