// Minimal static server for local testing: node serve.mjs [port]
// Also serves /adsb/v2/point/{lat}/{lon}/{nm} by running the Cloudflare Worker in proxy/worker.js,
// so local testing goes through exactly the same feed fallback as the phone.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './proxy/worker.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = +process.argv[2] || 8001;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/adsb/')) {
    const up = await worker.fetch(new Request(`http://worker${path.slice(5)}`));
    res.writeHead(up.status, Object.fromEntries(up.headers));
    res.end(Buffer.from(await up.arrayBuffer()));
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
}).listen(port, () => console.log(`FlightSpot at http://localhost:${port}/ (feed proxy: proxy/worker.js)`));
