// Copies the browser half of simplewebauthn out of node_modules into public/vendor/, version in the filename
// (no CDN, spec §10): `node scripts/vendor.mjs`. The copy is committed, so the Worker and the tests never need
// node_modules at the edge. After a version bump, update WEBAUTHN_BROWSER in src/pages/layout.tsx; a test says if they differ.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(ROOT, 'node_modules', '@simplewebauthn', 'browser');
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));

const out = join(ROOT, 'public', 'vendor');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^simplewebauthn-browser-.*\.umd\.min\.js$/.test(f)) rmSync(join(out, f));
const file = `simplewebauthn-browser-${version}.umd.min.js`;
copyFileSync(join(pkg, 'dist', 'bundle', 'index.umd.min.js'), join(out, file));
console.log(`vendored ${file}`);
