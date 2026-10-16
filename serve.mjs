// Minimal static server for local testing: node serve.mjs [port]
// For desktop testing only, /adsb/v2/point/{lat}/{lon}/{nm} is passed through to adsb.lol,
// because a browser may not call it directly (no CORS). The Android app calls adsb.lol itself.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = +process.argv[2] || 8001;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const POINT = /^\/adsb(\/v2\/point\/-?\d{1,2}(\.\d+)?\/-?\d{1,3}(\.\d+)?\/\d{1,3})$/;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const m = POINT.exec(path);
  if (m) {
    try {
      const up = await fetch(`https://api.adsb.lol${m[1]}`, { headers: { 'User-Agent': 'flightspot-dev' } });
      res.writeHead(up.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`adsb.lol failed: ${err.message}`);
    }
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`FlightSpot at http://localhost:${port}/ (/adsb → adsb.lol for desktop testing)`));
