// Minimal static server for local testing: node serve.mjs [port]
// Also proxies /adsb/v2/point/{lat}/{lon}/{nm} to adsb.lol, which doesn't send CORS headers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = +process.argv[2] || 8001;
const UPSTREAM = process.env.ADSB_UPSTREAM || 'https://api.adsb.lol';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const POINT = /^\/adsb\/v2\/point\/-?\d{1,2}(\.\d+)?\/-?\d{1,3}(\.\d+)?\/\d{1,3}$/;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/adsb/')) {
    if (!POINT.test(path)) { res.writeHead(400).end('Only /adsb/v2/point/{lat}/{lon}/{nm}'); return; }
    try {
      const up = await fetch(UPSTREAM + path.slice(5), { headers: { 'User-Agent': 'flightspot-dev' } });
      res.writeHead(up.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`Upstream failed: ${err.message}`);
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
}).listen(port, () => console.log(`FlightSpot at http://localhost:${port}/ (feed proxy → ${UPSTREAM})`));
