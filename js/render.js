// Drawing: aircraft boxes and labels over the camera image, and a synthetic sky for demo mode.

import { enu } from './solar.js';
import { title, typeName, wingspan } from './airlines.js';

const COMPASS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const NEAR = '#ffb020', MID = '#6fd0ff', FAR = 'rgba(255,255,255,0.9)';

export function rangeColor(km) { return km < 5 ? NEAR : km < 20 ? MID : FAR; }

/**
 * Box size on screen. The true angular size of a plane is tiny (an A320 10 km away covers about
 * 3 px), so the box is a distance cue instead: big when close, shrinking with distance, never
 * smaller than a tap target. It is never drawn smaller than the plane's real size.
 */
export function boxSize(f, span, range) {
  const truePx = (f * span) / range;
  const cue = 150 * Math.pow(2000 / Math.max(range, 200), 0.6);
  return Math.max(truePx * 1.3, Math.min(170, Math.max(26, cue)));
}

export class OverlayRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.hits = [];
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w; this.h = h;
  }

  /** items: [{ ac, look: {az, el, range, unit}, alt, age }], nearest first. */
  draw(cam, items, opts) {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHorizon(cam);

    this.hits = [];
    const labels = [];
    const offscreen = [];
    const W = cam.width, H = cam.height;
    // Far planes first so near ones end up on top.
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const p = cam.project(it.look.unit);
      const s = boxSize(cam.f, wingspan(it.ac.type, it.ac.category), it.look.range);
      if (!p || p[0] < -s || p[0] > W + s || p[1] < -s || p[1] > H + s) { offscreen.unshift(it); continue; }
      const w = s, h = s * 0.62;
      labels.push({ it, box: { x: p[0] - w / 2, y: p[1] - h / 2, w, h }, selected: opts.selected === it.ac.hex });
    }
    // Arrows underneath, so they never hide a plane that is in view. Nearest six only.
    if (opts.edgeArrows) this.drawEdgeArrows(cam, offscreen.slice(0, 6));
    for (const { it, box, selected } of labels) {
      this.drawBox(box, rangeColor(it.look.range / 1000), selected, it.age > 20);
      this.hits.push({ hex: it.ac.hex, ...box });
    }
    // Labels nearest first, so they win the space.
    labels.reverse();
    const placed = [];
    for (const l of labels) this.drawLabel(l, placed, opts);
  }

  drawHorizon(cam) {
    const { ctx } = this;
    const pts = [];
    for (let az = 0; az <= 360; az += 3) pts.push(cam.project(enu(az, 0)));
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const [az, name] of Object.entries(COMPASS)) {
      const p = cam.project(enu(+az, 0));
      if (!p) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(name, p[0] + 1, p[1] + 17);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(name, p[0], p[1] + 16);
    }
  }

  drawBox({ x, y, w, h }, color, selected, stale) {
    const { ctx } = this;
    const c = Math.min(w, h) * 0.3; // corner bracket length
    ctx.save();
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, w, h);
    }
    ctx.setLineDash(stale ? [4, 4] : []);
    // A dark outline first so the brackets read against bright sky.
    for (const [style, width] of [['rgba(0,0,0,0.5)', selected ? 5 : 3.6], [color, selected ? 2.6 : 1.7]]) {
      ctx.strokeStyle = style; ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
      ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
      ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
      ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
      ctx.stroke();
    }
    // Centre dot: where the plane should be.
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawLabel({ it, box, selected }, placed, opts) {
    const { ctx } = this;
    const km = it.look.range / 1000;
    // Destination only when the route data fits where the plane actually is.
    const dest = it.route && it.routeFits ? (opts.detail === 'short' ? it.route.to.iata || it.route.to.city : it.route.to.city) : null;
    const l1 = dest ? `${title(it.ac)} → ${dest}` : title(it.ac);
    const bits = [];
    if (opts.detail !== 'short') {
      const t = typeName(it.ac.type);
      if (t) bits.push(t);
    }
    bits.push(km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);
    if (it.alt != null && opts.detail !== 'short') bits.push(`${fmtAlt(it.alt, opts.units)}`);
    const l2 = bits.join(' · ');

    ctx.font = '650 13px system-ui, sans-serif';
    const w1 = ctx.measureText(l1).width;
    ctx.font = '12px system-ui, sans-serif';
    const w2 = ctx.measureText(l2).width;
    const w = Math.max(w1, w2) + 12, h = 34;
    const cx = box.x + box.w / 2;
    const tries = [
      { x: cx - w / 2, y: box.y - h - 4 },
      { x: cx - w / 2, y: box.y + box.h + 4 },
      { x: box.x + box.w + 4, y: box.y + box.h / 2 - h / 2 },
    ];
    const W = this.w, H = this.h;
    let spot = null;
    for (const t of tries) {
      const r = { x: Math.max(4, Math.min(W - w - 4, t.x)), y: Math.max(4, Math.min(H - h - 4, t.y)), w, h };
      if (!placed.some((q) => overlap(q, r))) { spot = r; break; }
    }
    if (!spot) {
      if (!selected) return;
      spot = { ...tries[0], w, h };
    }
    placed.push(spot);
    ctx.fillStyle = selected ? 'rgba(20,20,26,0.92)' : 'rgba(20,20,26,0.66)';
    roundRect(ctx, spot.x, spot.y, w, h, 7);
    ctx.fill();
    ctx.fillStyle = rangeColor(km);
    ctx.fillRect(spot.x, spot.y + 6, 2.5, h - 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '650 13px system-ui, sans-serif';
    ctx.fillText(l1, spot.x + 7, spot.y + 15);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(l2, spot.x + 7, spot.y + 29);
  }

  /** Small arrows at the screen edge pointing to planes outside the view, nearest first. */
  drawEdgeArrows(cam, items) {
    const { ctx } = this;
    const texts = [];
    const [r, u, b] = cam.cols;
    const W = cam.width, H = cam.height, cx = W / 2, cy = H / 2, m = 26;
    for (const it of items) {
      const v = it.look.unit;
      const x = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
      const y = -(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
      const ang = Math.atan2(y, x);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const k = Math.min((cx - m) / Math.abs(dx || 1e-9), (cy - m - 60) / Math.abs(dy || 1e-9));
      const px = cx + dx * k, py = cy + dy * k;
      const km = it.look.range / 1000;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = rangeColor(km);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = dx > 0.3 ? 'right' : dx < -0.3 ? 'left' : 'center';
      const tx = px - dx * 14, ty = py - dy * 14 + 4;
      // Crowded edge: keep the arrow, drop the text.
      if (texts.some(([x, y]) => Math.abs(x - tx) < 90 && Math.abs(y - ty) < 16)) continue;
      texts.push([tx, ty]);
      const text = `${it.ac.callsign || it.ac.reg || ''} ${Math.round(km)} km`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, tx + 1, ty + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, tx, ty);
    }
  }

  hitTest(x, y) {
    let best = null, bestD = Infinity;
    for (const h of this.hits) {
      const pad = 10;
      if (x < h.x - pad || x > h.x + h.w + pad || y < h.y - pad || y > h.y + h.h + pad) continue;
      const d = Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2));
      if (d < bestD) { bestD = d; best = h.hex; }
    }
    return best;
  }
}

export function fmtAlt(m, units) {
  if (units === 'ft') return `${Math.round(m / 0.3048 / 100) * 100} ft`;
  return `${Math.round(m / 50) * 50} m`;
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- demo scene

function ridge(az) {
  const a = az * Math.PI / 180;
  return 1.2 + 0.9 * Math.sin(a * 2 + 0.6) + 0.45 * Math.sin(a * 5.3 + 1.1) + 0.2 * Math.sin(a * 13.7);
}

/**
 * A synthetic sky with hills, and the simulated planes at their TRUE positions (tiny dark
 * shapes, with contrails at cruise height). The overlay is drawn from the delayed feed, so the
 * boxes landing on these shapes shows the prediction works.
 * planes: [{ look: {unit, range}, track, alt, type, category }]
 */
export function drawDemoScene(canvas, cam, dpr, planes, toEnu) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cam.width, H = cam.height;
  const top = cam.unproject(W / 2, 0), bot = cam.unproject(W / 2, H);
  // Sky gradient follows elevation: deeper blue higher up.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const skyAt = (z) => {
    const e = Math.max(0, Math.min(1, z * 1.6));
    return `rgb(${Math.round(176 - 120 * e)}, ${Math.round(206 - 90 * e)}, ${Math.round(238 - 40 * e)})`;
  };
  g.addColorStop(0, skyAt(top[2])); g.addColorStop(1, skyAt(Math.max(0, bot[2])));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Hills: sample the ridge across the azimuths in front of the camera.
  const f = cam.forward();
  const span = cam.fovLong + 30;
  ctx.fillStyle = '#4d5f52';
  ctx.beginPath();
  let first = true;
  for (let d = -span; d <= span; d += 1) {
    const p = cam.project(enu(f.az + d, ridge(f.az + d)));
    if (!p) continue;
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  for (let d = span; d >= -span; d -= 5) {
    const p = cam.project(enu(f.az + d, Math.min(-60, f.el - 60)));
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fill();
  // Nearer, darker band of trees and roofs.
  ctx.fillStyle = '#2f3a33';
  ctx.beginPath();
  first = true;
  for (let d = -span; d <= span; d += 1) {
    const e = 0.25 + 0.35 * Math.abs(Math.sin((f.az + d) * 0.31)) + 0.25 * Math.abs(Math.sin((f.az + d) * 1.7));
    const p = cam.project(enu(f.az + d, e));
    if (!p) continue;
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  for (let d = span; d >= -span; d -= 5) {
    const p = cam.project(enu(f.az + d, Math.min(-60, f.el - 60)));
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fill();

  // Planes at their true positions.
  for (const pl of planes) {
    if (pl.look.el < ridge(pl.look.az)) continue; // behind the hills
    const p = cam.project(pl.look.unit);
    if (!p) continue;
    if (pl.alt > 8000 && toEnu) {
      // Contrail: a line 4 km long behind the plane.
      const back = (pl.track + 180) * Math.PI / 180;
      const tail = toEnu(pl.lat + (Math.cos(back) * 4000) / 111320,
        pl.lon + (Math.sin(back) * 4000) / (111320 * Math.cos(pl.lat * Math.PI / 180)), pl.alt);
      const n = Math.hypot(...tail);
      const q = cam.project(tail.map((c) => c / n));
      if (q) {
        const grad = ctx.createLinearGradient(p[0], p[1], q[0], q[1]);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
    }
    const s = Math.max(2.5, (cam.f * wingspan(pl.type, pl.category)) / pl.look.range);
    ctx.fillStyle = '#20242a';
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], s / 2, Math.max(1.2, s / 6), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(p[0] - s / 10, p[1] - s / 2.5, s / 5, s / 1.25);
  }
}
