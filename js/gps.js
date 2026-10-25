// Combines GPS fixes into a steadier position. A single fix right after the GPS starts is often
// off by 20–50 m, and the altitude by more. While you stand still, a weighted average of the
// last minute of fixes settles within a few metres. Walking off restarts the average.

const KEEP_MS = 60000;     // average over the last minute
const STABLE_ACC = 15;     // m, horizontal and vertical, to call the position stable
const STABLE_FIXES = 5;
const STABLE_SPAN = 8000;  // ms of fixes before calling it stable

export class GpsFilter {
  constructor() { this.fixes = []; }

  reset() { this.fixes = []; }

  /** Add a fix { lat, lon, acc, alt, altAcc } and return the new estimate. */
  add(fix, now = Date.now()) {
    const est = this.estimate(now);
    // Moved further than the uncertainty allows: start a new average at the new place.
    if (est && metres(est, fix) > Math.max(25, 2 * (fix.acc + est.acc))) this.fixes = [];
    this.fixes.push({ ...fix, t: now });
    this.fixes = this.fixes.filter((f) => now - f.t < KEEP_MS);
    return this.estimate(now);
  }

  /** { lat, lon, acc, alt, altAcc, n, status: 'settling' | 'stable' } or null. */
  estimate(now = Date.now()) {
    const all = this.fixes.filter((f) => now - f.t < KEEP_MS);
    if (!all.length) return null;
    const best = Math.min(...all.map((f) => f.acc));
    // Ignore fixes much worse than the best one (e.g. network-based ones while GPS warms up).
    const use = all.filter((f) => f.acc <= Math.max(best * 3, 30));
    const pos = weighted(use, (f) => f.acc, (f) => [f.lat, f.lon]);
    // Fix errors are correlated over a minute, so don't claim much better than the best fix.
    const acc = Math.max(best * 0.7, pos.sigma);
    const withAlt = use.filter((f) => f.alt != null);
    let alt = null, altAcc = null;
    if (withAlt.length) {
      const sa = (f) => f.altAcc ?? f.acc * 1.5;
      const a = weighted(withAlt, sa, (f) => [f.alt]);
      alt = a.mean[0];
      altAcc = Math.max(Math.min(...withAlt.map(sa)) * 0.7, a.sigma);
    }
    const span = now - Math.min(...use.map((f) => f.t));
    const stable = acc <= STABLE_ACC && (altAcc == null || altAcc <= STABLE_ACC) &&
      use.length >= STABLE_FIXES && span >= STABLE_SPAN;
    return { lat: pos.mean[0], lon: pos.mean[1], acc, alt, altAcc, n: use.length, status: stable ? 'stable' : 'settling' };
  }
}

/** Inverse-variance weighted mean of vector values, and its standard error. */
function weighted(items, sigma, value) {
  let sw = 0;
  const sum = value(items[0]).map(() => 0);
  for (const it of items) {
    const w = 1 / Math.max(1, sigma(it)) ** 2;
    sw += w;
    value(it).forEach((v, i) => { sum[i] += w * v; });
  }
  return { mean: sum.map((s) => s / sw), sigma: 1 / Math.sqrt(sw) };
}

function metres(a, b) {
  const k = Math.PI / 180, R = 6371008.8;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * R;
}
