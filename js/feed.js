// Live traffic: polls an ADS-B feed (readsb / ADS-B Exchange v2 JSON, as served by adsb.lol
// and adsb.fi), keeps the latest report per aircraft and predicts where each one is now.

import { extrapolate, KT, FT } from './geo.js';

const MAX_AGE_S = 45;     // drop positions older than this
const BLEND_S = 1.5;      // time constant to absorb the jump when a fresh report arrives

/** One aircraft from a readsb JSON entry, in SI units, or null if it has no usable position. */
export function parseAircraft(a, nowMs) {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const seen = a.seen_pos ?? a.seen ?? 0;
  if (seen > MAX_AGE_S) return null;
  const ground = a.alt_baro === 'ground';
  let alt = null, altSrc = null;
  // alt_geom is GNSS height above the WGS84 ellipsoid, the same reference as the phone's GPS.
  // alt_baro is pressure altitude, off by up to a few hundred metres depending on the weather.
  if (typeof a.alt_geom === 'number') { alt = a.alt_geom * FT; altSrc = 'gnss'; }
  else if (typeof a.alt_baro === 'number') { alt = a.alt_baro * FT; altSrc = 'baro'; }
  const rate = a.geom_rate ?? a.baro_rate ?? 0;
  return {
    hex: a.hex,
    callsign: (a.flight || '').trim(),
    reg: a.r || null,
    type: a.t || null,
    desc: a.desc || null,
    category: a.category || null,
    squawk: a.squawk || null,
    lat: a.lat, lon: a.lon, alt, altSrc, ground,
    gs: (a.gs || 0) * KT,
    track: a.track ?? a.true_heading ?? a.mag_heading ?? 0,
    vr: ground ? 0 : (rate * FT) / 60,
    t: nowMs - seen * 1000,  // time of the position, feed clock
  };
}

/** Parse a whole response. `now` is in ms (adsb.lol) or s (adsb.fi). */
export function parseResponse(json) {
  let now = json.now ?? Date.now();
  if (now < 1e11) now *= 1000;
  const list = (json.ac || json.aircraft || []).map((a) => parseAircraft(a, now)).filter(Boolean);
  return { now, list };
}

/** Fetcher for a readsb-style "point" endpoint: `${base}/v2/point/{lat}/{lon}/{radius_nm}`. */
export function liveFetcher(base) {
  return async (lat, lon, rangeKm) => {
    if (!base) throw new Error('No feed URL set (Settings → Traffic).');
    // About 1 km precision is plenty for a 50 km search and keeps the exact location private.
    const nm = Math.min(250, Math.ceil(rangeKm / 1.852));
    const url = `${base.replace(/\/$/, '')}/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${nm}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      // The FlightSpot proxy explains failures as {"error": "..."}.
      const why = await res.json().then((j) => j.error, () => null);
      throw new Error(why || `Feed HTTP ${res.status}${res.status === 429 ? ' (rate-limited, retrying)' : ''}`);
    }
    return parseResponse(await res.json());
  };
}

export class Traffic {
  constructor(fetcher, log = () => {}) {
    this.fetcher = fetcher;
    this.log = log;
    this.planes = new Map();  // hex → { ac, corr, corrAt }
    this.clockOffset = 0;     // feed clock − local clock, ms
    this.lastOk = 0;          // local time of the last good poll
    this.lastError = null;
    this.interval = 5000;
    this.timer = null;
    this.where = null;
    this.polls = 0;
  }

  setFetcher(f) { this.fetcher = f; this.planes.clear(); this.lastOk = 0; this.lastError = null; this.poll(); }

  start(where) {
    this.where = where;
    if (!this.timer) this.poll();
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async poll() {
    clearTimeout(this.timer);
    let wait = this.interval;
    if (this.where) {
      const { lat, lon, rangeKm } = this.where();
      try {
        const sent = Date.now();
        const { now, list } = await this.fetcher(lat, lon, rangeKm);
        const local = (sent + Date.now()) / 2;
        const off = now - local;
        this.clockOffset = this.polls ? this.clockOffset + (off - this.clockOffset) * 0.3 : off;
        this.ingest(list);
        this.lastOk = Date.now();
        this.lastError = null;
        this.polls++;
      } catch (err) {
        if (this.lastError !== err.message) this.log(`Feed: ${err.message}`);
        this.lastError = err.message;
        wait = Math.min(30000, this.interval * 3);
      }
    }
    this.timer = setTimeout(() => this.poll(), wait);
  }

  ingest(list) {
    const now = this.feedNow();
    const seen = new Set();
    for (const ac of list) {
      seen.add(ac.hex);
      const prev = this.planes.get(ac.hex);
      const entry = { ac, corr: null, corrAt: now };
      if (prev && prev.ac.alt != null && ac.alt != null) {
        // Keep the plane where it was drawn and slide it to the new prediction.
        const a = this.predict(prev, now), b = this.predict(entry, now);
        entry.corr = { lat: a.lat - b.lat, lon: a.lon - b.lon, alt: a.alt - b.alt };
        if (Math.abs(entry.corr.lat) + Math.abs(entry.corr.lon) > 0.05) entry.corr = null; // big jump: snap
      }
      this.planes.set(ac.hex, entry);
    }
    for (const hex of this.planes.keys()) if (!seen.has(hex)) this.planes.delete(hex);
  }

  feedNow() { return Date.now() + this.clockOffset; }

  predict(entry, now) {
    const { ac } = entry;
    const dt = Math.min(MAX_AGE_S, (now - ac.t) / 1000);
    const p = extrapolate(ac, dt);
    if (entry.corr) {
      const k = Math.exp(-(now - entry.corrAt) / 1000 / BLEND_S);
      p.lat += entry.corr.lat * k; p.lon += entry.corr.lon * k; p.alt += entry.corr.alt * k;
    }
    return p;
  }

  /** Predicted positions now: [{ ac, lat, lon, alt, age (s) }]. */
  current() {
    const now = this.feedNow();
    const out = [];
    for (const e of this.planes.values()) {
      const age = (now - e.ac.t) / 1000;
      if (age > MAX_AGE_S) continue;
      if (e.ac.alt == null && !e.ac.ground) continue;
      const p = this.predict(e, now);
      if (e.ac.ground) p.alt = null; // on the ground: the caller uses the ground height
      out.push({ ac: e.ac, age, ...p });
    }
    return out;
  }
}
