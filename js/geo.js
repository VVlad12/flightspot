// Geometry: where an aircraft appears in the sky from the observer, and where it is now
// given a position report that is several seconds old.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const A = 6378137;               // WGS84 semi-major axis, m
const E2 = 6.69437999014e-3;     // WGS84 first eccentricity squared
const R_MEAN = 6371008.8;        // mean Earth radius, m (for short dead-reckoning steps)

export const KT = 0.514444;      // knots → m/s
export const FT = 0.3048;        // feet → m

/** Geodetic (deg, deg, m above the ellipsoid) → ECEF [x, y, z] in m. */
export function ecef(lat, lon, h) {
  const p = lat * RAD, l = lon * RAD;
  const sp = Math.sin(p), cp = Math.cos(p);
  const n = A / Math.sqrt(1 - E2 * sp * sp);
  return [(n + h) * cp * Math.cos(l), (n + h) * cp * Math.sin(l), (n * (1 - E2) + h) * sp];
}

/**
 * Observer frame. toEnu() turns a geodetic point into local east/north/up metres, which is the
 * same world frame the Camera projects (x = east, y = north, z = up).
 */
export function observer(lat, lon, h) {
  const o = ecef(lat, lon, h);
  const p = lat * RAD, l = lon * RAD;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const E = [-sl, cl, 0], N = [-sp * cl, -sp * sl, cp], U = [cp * cl, cp * sl, sp];
  return {
    lat, lon, h,
    toEnu(la, lo, hh) {
      const q = ecef(la, lo, hh);
      const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      return [dot(E, d), dot(N, d), dot(U, d)];
    },
  };
}

/** ENU metres → { az, el (deg), range (m), unit vector }. */
export function look(v) {
  const range = Math.hypot(v[0], v[1], v[2]);
  const unit = v.map((c) => c / range);
  return {
    az: ((Math.atan2(v[0], v[1]) * DEG) + 360) % 360,
    el: Math.asin(unit[2]) * DEG,
    range,
    unit,
  };
}

/**
 * Dead reckoning: move a report forward by dt seconds along its track, at its ground speed
 * and vertical rate. Good to a few hundred metres over 15 s for an airliner that isn't turning.
 */
export function extrapolate(ac, dt) {
  const d = (ac.gs || 0) * dt;
  const t = (ac.track || 0) * RAD;
  const lat = ac.lat + (d * Math.cos(t) / R_MEAN) * DEG;
  const lon = ac.lon + (d * Math.sin(t) / (R_MEAN * Math.cos(ac.lat * RAD))) * DEG;
  const alt = ac.alt + (ac.vr || 0) * dt;
  return { lat, lon, alt };
}

/** Straight-line distance over the ground between two points, m (haversine). */
export function groundDistance(lat1, lon1, lat2, lon2) {
  const dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dl / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.sqrt(a));
}

/** Point at a distance (m) and bearing (deg) from a start point. */
export function destination(lat, lon, dist, bearing) {
  const p1 = lat * RAD, l1 = lon * RAD, b = bearing * RAD, d = dist / R_MEAN;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 };
}

/** Initial bearing from point 1 to point 2, deg. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
