// Origin and destination by callsign, from adsbdb.com (free, community-maintained). Routes are
// schedule data: an airline can reuse a flight number, so each route is checked against where
// the plane actually is.

const API = 'https://api.adsbdb.com/v0/callsign/';
const TTL = 6 * 3600e3;       // keep a found route for 6 h
const MISS_TTL = 3600e3;      // and an unknown callsign for 1 h
const ERROR_TTL = 120e3;      // retry after a network error in 2 min
const PARALLEL = 2;

const cache = new Map();      // callsign → { route | null, at, ttl }
const queue = [];
let active = 0;

/**
 * Cached route for a callsign: { from, to } with { iata, icao, city, name, lat, lon }, null when
 * unknown, or undefined while it is being looked up. Starts the lookup on first use.
 */
export function routeFor(callsign) {
  const cs = (callsign || '').trim().toUpperCase();
  if (!/^[A-Z]{3}\d[0-9A-Z]{0,3}$/.test(cs)) return null; // private flights have no route
  const hit = cache.get(cs);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.route;
  if (!hit || !hit.pending) {
    cache.set(cs, { route: hit?.route, at: 0, ttl: 0, pending: true });
    queue.push(cs);
    pump();
  }
  return hit?.route;
}

function pump() {
  while (active < PARALLEL && queue.length) {
    const cs = queue.shift();
    active++;
    lookup(cs)
      .then((route) => cache.set(cs, { route, at: Date.now(), ttl: route ? TTL : MISS_TTL }))
      .catch(() => cache.set(cs, { route: cache.get(cs)?.route ?? null, at: Date.now(), ttl: ERROR_TTL }))
      .finally(() => { active--; pump(); });
  }
}

async function lookup(cs) {
  const res = await fetch(API + encodeURIComponent(cs));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`adsbdb HTTP ${res.status}`);
  return parseRoute(await res.json());
}

export function parseRoute(j) {
  const r = j?.response?.flightroute;
  if (!r?.origin || !r?.destination) return null;
  const ap = (a) => ({
    iata: a.iata_code || null, icao: a.icao_code || null,
    city: a.municipality || a.name || a.icao_code, name: a.name || null,
    lat: a.latitude, lon: a.longitude,
  });
  return { from: ap(r.origin), to: ap(r.destination) };
}

/**
 * Does the plane's position fit the route? False when it is far off the great circle between
 * the two airports, or well beyond either end: then the route data is probably out of date.
 */
export function routeFits(route, lat, lon) {
  if (!route) return false;
  const k = Math.PI / 180, R = 6371;
  const { from, to } = route;
  if ([from.lat, from.lon, to.lat, to.lon].some((v) => typeof v !== 'number')) return true;
  const d12 = angle(from, to), d13 = angle(from, { lat, lon });
  const b12 = brg(from, to), b13 = brg(from, { lat, lon });
  const xt = Math.asin(Math.sin(d13) * Math.sin(b13 - b12));            // off the route
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt)))); // along it
  const len = d12 * R, off = Math.abs(xt) * R, along = at * R * Math.sign(Math.cos(b13 - b12));
  return off < Math.max(150, 0.25 * len) && along > -100 && along < len + 100;

  function angle(a, b) {
    const s = Math.sin(((b.lat - a.lat) * k) / 2) ** 2 +
      Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(((b.lon - a.lon) * k) / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(s));
  }
  function brg(a, b) {
    const y = Math.sin((b.lon - a.lon) * k) * Math.cos(b.lat * k);
    const x = Math.cos(a.lat * k) * Math.sin(b.lat * k) - Math.sin(a.lat * k) * Math.cos(b.lat * k) * Math.cos((b.lon - a.lon) * k);
    return Math.atan2(y, x);
  }
}

/** "Zürich (ZRH)" style. */
export function airportLabel(a) {
  return a.iata ? `${a.city} (${a.iata})` : a.city;
}
