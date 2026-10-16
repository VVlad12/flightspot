// Copies the web app into www/, the folder Capacitor packs into the Android app.
// The repo root stays the web version (served as-is by GitHub Pages).
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}www`;
await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const f of ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons']) {
  await cp(`${root}${f}`, `${out}/${f}`, { recursive: true });
}
console.log('www/ ready');
