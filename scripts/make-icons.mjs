// Renders the FlightSpot icons (plane inside AR corner brackets) as PNGs:
// web icons into icons/, Android launcher icons into android/app/src/main/res/.
// node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const PLANE = [[32,16],[34.4,19.5],[34.4,28],[47,35.5],[47,38.8],[34.4,35],[34.4,41.4],[38.4,44.4],[38.4,47.4],[32,45.6],[25.6,47.4],[25.6,44.4],[29.6,41.4],[29.6,35],[17,38.8],[17,35.5],[29.6,28],[29.6,19.5]];
const SEGS = [[[10,22],[10,10]],[[10,10],[22,10]],[[42,10],[54,10]],[[54,10],[54,22]],[[54,42],[54,54]],[[54,54],[42,54]],[[22,54],[10,54]],[[10,54],[10,42]]];
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function segD(x, y, [a, b]) { const dx = b[0]-a[0], dy = b[1]-a[1]; const t = Math.max(0, Math.min(1, ((x-a[0])*dx + (y-a[1])*dy) / (dx*dx+dy*dy))); return Math.hypot(x - a[0] - t*dx, y - a[1] - t*dy); }
function render(size, shape) {
  const maskable = shape === 'maskable';
  const k = { rounded: 0.86, maskable: 0.72, round: 0.7, fg: 0.56 }[shape], off = (64 - 64 * k) / 2, SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = ((x + (sx + 0.5) / SS) / size) * 64, v = ((y + (sy + 0.5) / SS) / size) * 64;
      // background: rounded square (full bleed when maskable)
      const rad = shape === 'round' ? 32 : maskable ? 0 : 13, cx = Math.min(Math.max(u, rad), 64 - rad), cy = Math.min(Math.max(v, rad), 64 - rad);
      if (Math.hypot(u - cx, v - cy) > rad + 1e-9 && !maskable) continue;
      let c = shape === 'fg' ? null : [13, 13, 15];
      const gx = (u - off) / k, gy = (v - off) / k;
      if (SEGS.some((s) => segD(gx, gy, s) < 1.9)) c = [111, 208, 255];
      if (inPoly(gx, gy, PLANE)) c = [255, 255, 255];
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS * SS, i = (y * size + x) * 4;
    px[i] = a ? r / (a / 255) : 0; px[i + 1] = a ? g / (a / 255) : 0; px[i + 2] = a ? b / (a / 255) : 0; px[i + 3] = a / n;
  }
  return png(size, px);
}
function png(n, px) {
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) { raw[y * (n * 4 + 1)] = 0; px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4); }
  const crcT = []; for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[i] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(n, 0); ih.writeUInt32BE(n, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(`${root}icons/icon-192.png`, render(192, 'rounded'));
writeFileSync(`${root}icons/icon-512.png`, render(512, 'rounded'));
writeFileSync(`${root}icons/maskable-512.png`, render(512, 'maskable'));
const res = `${root}android/app/src/main/res`;
for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  writeFileSync(`${res}/mipmap-${d}/ic_launcher.png`, render(48 * k, 'rounded'));
  writeFileSync(`${res}/mipmap-${d}/ic_launcher_round.png`, render(48 * k, 'round'));
  writeFileSync(`${res}/mipmap-${d}/ic_launcher_foreground.png`, render(108 * k, 'fg'));
}
console.log('icons written');
