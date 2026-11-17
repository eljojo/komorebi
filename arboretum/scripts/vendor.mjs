// Copies the browser half of simplewebauthn out of node_modules into public/vendor/, version in the filename
// (no CDN, spec §10): `node scripts/vendor.mjs`. The copy is committed, so the Worker and the tests never need
// node_modules at the edge. After a version bump, update WEBAUTHN_BROWSER in src/pages/layout.tsx; a test says if they differ.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from './stage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(ROOT, 'node_modules', '@simplewebauthn', 'browser');
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));

const out = join(ROOT, 'public', 'vendor');
const file = `simplewebauthn-browser-${version}.umd.min.js`;
// The new copy lands first; the older versions go only after it has.
const older = (() => { try { return readdirSync(out); } catch { return []; } })().filter((f) => /^simplewebauthn-browser-.*\.umd\.min\.js$/.test(f)).map((f) => join(out, f));
install([{ from: join(pkg, 'dist', 'bundle', 'index.umd.min.js'), to: join(out, file) }], older);
console.log(`vendored ${file}`);
