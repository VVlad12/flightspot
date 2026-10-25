// Simulated traffic around Zürich airport for demo mode. Each aircraft follows a simple
// scripted path that loops. The fake feed reports positions 1–9 s late, like a real feed,
// so the overlay has to predict where the planes are now, just as it does with live data.

import { destination, groundDistance, KT, FT } from './geo.js';

const DEG = 180 / Math.PI;
const RWY14 = { lat: 47.4825, lon: 8.5357, h: 480 };   // runway 14 threshold, ellipsoid height
const RWY28 = { lat: 47.4580, lon: 8.5620, h: 480 };

function arrival(phase) {
  const gs = 145 * KT, d0 = 32000, len = d0 / gs;
  return (T) => {
    const s = ((T + phase) % len + len) % len;
    const dist = d0 - gs * s;
    const p = destination(RWY14.lat, RWY14.lon, dist, 317);
    const slope = Math.tan(3 / DEG);
    return { ...p, alt: RWY14.h + 15 + dist * slope, gs, track: 137, vr: -gs * slope };
  };
}

function departure(phase) {
  const gs0 = 150 * KT, acc = 0.35, vr = 2600 * FT / 60, len = 300;
  return (T) => {
    const s = ((T + phase) % len + len) % len;
    const gs = gs0 + acc * s;
    const p = destination(RWY28.lat, RWY28.lon, gs0 * s + acc * s * s / 2, 274);
    return { ...p, alt: RWY28.h + 10 + vr * s, gs, track: 274, vr };
  };
}

function overflight(start, track, alt, knots, phase) {
  const gs = knots * KT, len = 160000 / gs;
  return (T) => {
    const s = ((T + phase) % len + len) % len;
    return { ...destination(start.lat, start.lon, gs * s, track), alt, gs, track, vr: 0 };
  };
}

function circling(center, radius, alt, knots) {
  const gs = knots * KT, w = gs / radius;
  return (T) => {
    const a = w * T;
    const p = destination(center.lat, center.lon, radius, a * DEG);
    return { ...p, alt, gs, track: (a * DEG + 90) % 360, vr: 0 };
  };
}

const FLEET = [
  { hex: 'sim001', callsign: 'SWR287', reg: 'HB-JCA', type: 'BCS3', category: 'A3', fn: arrival(0) },
  { hex: 'sim002', callsign: 'DLH5KE', reg: 'D-AINA', type: 'A20N', category: 'A3', fn: arrival(110) },
  { hex: 'sim003', callsign: 'EDW12', reg: 'HB-JHQ', type: 'A333', category: 'A5', fn: arrival(250) },
  { hex: 'sim004', callsign: 'EZS15LT', reg: 'HB-JXA', type: 'A320', category: 'A3', fn: departure(0) },
  { hex: 'sim005', callsign: 'UAE88', reg: 'A6-EUA', type: 'A388', category: 'A5', fn: departure(160) },
  { hex: 'sim006', callsign: 'BAW713', reg: 'G-EUUA', type: 'A320', category: 'A3',
    fn: overflight(destination(47.38, 8.54, 70000, 240), 60, 11300, 455, 0) },
  { hex: 'sim007', callsign: 'THY1KM', reg: 'TC-JJE', type: 'B77W', category: 'A5',
    fn: overflight(destination(47.38, 8.54, 75000, 330), 150, 11900, 480, 200) },
  { hex: 'sim008', callsign: 'RYR4TW', reg: '9H-QBE', type: 'B738', category: 'A3',
    fn: overflight(destination(47.38, 8.54, 72000, 200), 15, 10700, 440, 90) },
  { hex: 'sim009', callsign: 'HBKFU', reg: 'HB-KFU', type: 'C172', category: 'A1',
    fn: circling({ lat: 47.392, lon: 8.588 }, 1400, 1150, 95) },
];

export class Simulator {
  constructor(minLag = 1, maxLag = 9) { this.minLag = minLag; this.maxLag = maxLag; }

  /** True positions now, for drawing the planes in the demo scene. */
  truth(now = Date.now()) {
    const T = now / 1000;
    return FLEET.map((f) => ({ ...f, ...f.fn(T) }));
  }

  /** Same interface as liveFetcher: reports with a random delay, inside the search radius. */
  fetcher() {
    return async (lat, lon, rangeKm) => {
      const now = Date.now();
      const list = [];
      for (const f of FLEET) {
        const lag = this.minLag + Math.random() * (this.maxLag - this.minLag);
        const p = f.fn(now / 1000 - lag);
        if (groundDistance(lat, lon, p.lat, p.lon) > rangeKm * 1000) continue;
        list.push({
          hex: f.hex, callsign: f.callsign, reg: f.reg, type: f.type, desc: null,
          category: f.category, squawk: null, ground: false, altSrc: 'gnss', src: 'adsb_icao', gsKnown: true,
          ...p, t: now - lag * 1000,
        });
      }
      return { now, list };
    };
  }
}
