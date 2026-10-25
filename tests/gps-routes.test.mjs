import test from 'node:test';
import assert from 'node:assert/strict';
import { GpsFilter } from '../js/gps.js';
import { parseRoute, routeFits, airportLabel } from '../js/routes.js';
import { destination, groundDistance } from '../js/geo.js';

const HOME = { lat: 47.3769, lon: 8.5417 };

// Deterministic noise so the test is repeatable.
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

test('GPS: averaging noisy fixes settles near the true position and turns stable', () => {
  const g = new GpsFilter();
  const t0 = 1e12;
  let e;
  for (let i = 0; i < 12; i++) {
    const p = destination(HOME.lat, HOME.lon, 12 * Math.abs(rnd()), 360 * Math.abs(rnd()));
    e = g.add({ ...p, acc: 12, alt: 460 + 10 * rnd(), altAcc: 12 }, t0 + i * 1000);
    if (i === 0) assert.equal(e.status, 'settling', 'one fix is not stable');
  }
  assert.equal(e.status, 'stable');
  assert.ok(groundDistance(HOME.lat, HOME.lon, e.lat, e.lon) < 8, 'average within 8 m');
  assert.ok(Math.abs(e.alt - 460) < 6, `altitude ${e.alt}`);
});

test('GPS: a poor first fix is ignored once good fixes arrive', () => {
  const g = new GpsFilter();
  const far = destination(HOME.lat, HOME.lon, 40, 90);
  g.add({ ...far, acc: 60, alt: null }, 0);
  const e = g.add({ ...HOME, acc: 5, alt: null }, 1000);
  assert.ok(groundDistance(HOME.lat, HOME.lon, e.lat, e.lon) < 1, 'the 60 m fix no longer counts');
});

test('GPS: walking away restarts the average', () => {
  const g = new GpsFilter();
  for (let i = 0; i < 6; i++) g.add({ ...HOME, acc: 5, alt: 460, altAcc: 8 }, i * 1000);
  const moved = destination(HOME.lat, HOME.lon, 200, 0);
  const e = g.add({ ...moved, acc: 5, alt: 460, altAcc: 8 }, 7000);
  assert.ok(groundDistance(moved.lat, moved.lon, e.lat, e.lon) < 1, 'jumped to the new place');
  assert.equal(e.status, 'settling');
});

const JSON_SWR = { response: { flightroute: {
  origin: { iata_code: 'ZRH', icao_code: 'LSZH', municipality: 'Zurich', name: 'Zürich Airport', latitude: 47.45806, longitude: 8.54806 },
  destination: { iata_code: 'JFK', icao_code: 'KJFK', municipality: 'New York', name: 'JFK', latitude: 40.6398, longitude: -73.7789 },
} } };

test('routes: parse adsbdb and check the plane is on the route', () => {
  const r = parseRoute(JSON_SWR);
  assert.equal(airportLabel(r.from), 'Zurich (ZRH)');
  assert.equal(r.to.city, 'New York');
  assert.equal(parseRoute({ response: 'unknown callsign' }), null);
  assert.ok(routeFits(r, 47.6, 8.0), 'just after departure from Zürich');
  assert.ok(routeFits(r, 53, -30), 'over the Atlantic');
  assert.ok(!routeFits(r, 41.9, 12.5), 'over Rome: not this flight');
  assert.ok(!routeFits(r, 47.4, 20), 'east of Zürich, behind the origin');
});
