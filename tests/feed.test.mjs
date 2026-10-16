import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, Traffic } from '../js/feed.js';
import { airlineOf, title, wingspan } from '../js/airlines.js';
import { boxSize } from '../js/render.js';
import { Simulator } from '../js/sim.js';
import { groundDistance } from '../js/geo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const SAMPLE = {
  now: 1792153496500,
  ac: [
    { hex: '4b1903', flight: 'SWR14V  ', r: 'HB-JMH', t: 'A343', alt_baro: 16425, alt_geom: 17350,
      gs: 344.4, track: 275.16, geom_rate: 576, lat: 47.419327, lon: 7.698326, seen_pos: 2.5, category: 'A5' },
    { hex: '4b0001', flight: 'HBKFU', alt_baro: 'ground', gs: 3, lat: 47.45, lon: 8.56, seen_pos: 1 },
    { hex: '4b0002', flight: 'EZY12', alt_baro: 9000, lat: 47.5, lon: 8.6, seen_pos: 80 }, // too old
    { hex: '4b0003', flight: 'DLH4', alt_baro: 9000 },                                     // no position
  ],
};

test('parses a readsb response into SI units', () => {
  const { now, list } = parseResponse(SAMPLE);
  assert.equal(list.length, 2);
  const a = list[0];
  assert.equal(a.callsign, 'SWR14V');
  near(a.alt, 17350 * 0.3048, 1e-6, 'geometric altitude');
  assert.equal(a.altSrc, 'gnss');
  near(a.gs, 344.4 * 0.514444, 1e-6, 'ground speed');
  near(a.vr, 576 * 0.3048 / 60, 1e-9, 'vertical rate');
  assert.equal(a.t, now - 2500);
  assert.equal(list[1].ground, true);
  assert.equal(list[1].alt, null);
});

test('adsb.fi reports "now" in seconds', () => {
  const { now } = parseResponse({ now: 1792153490.0, aircraft: [] });
  assert.equal(now, 1792153490000);
});

test('callsigns become airline names', () => {
  assert.deepEqual(airlineOf('SWR14V '), { name: 'Swiss', code: 'SWR', flight: '14V' });
  assert.equal(title({ callsign: 'EDW12', hex: 'x' }), 'Edelweiss 12');
  assert.equal(title({ callsign: 'QQQ123', hex: 'x' }), 'QQQ 123');
  assert.equal(title({ callsign: 'HBKFU', hex: 'x' }), 'HBKFU');
  assert.equal(title({ callsign: '', reg: 'HB-ZAB', hex: 'x' }), 'HB-ZAB');
  assert.equal(wingspan('A388'), 79.8);
  assert.equal(wingspan('ZZZZ', 'A1'), 11);
});

test('boxes shrink with distance but stay tappable', () => {
  const f = 900, span = 35.8;
  const sizes = [1000, 3000, 10000, 30000, 100000].map((r) => boxSize(f, span, r));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] <= sizes[i - 1], `monotonic ${sizes}`);
  assert.ok(sizes.at(-1) >= 26, 'min size');
  assert.ok(sizes[0] <= 170, 'max size');
  // Very close, the real size wins.
  assert.ok(boxSize(f, span, 150) >= (f * span / 150), 'never smaller than the plane');
});

test('Traffic predicts the position at the current time from an old report', async () => {
  const now = Date.now();
  const report = { hex: 'a', callsign: 'SWR1', lat: 47, lon: 8, alt: 5000, gs: 200, track: 0, vr: 0, t: now - 10000 };
  const t = new Traffic(async () => ({ now, list: [report] }));
  t.where = () => ({ lat: 47, lon: 8, rangeKm: 50 });
  await t.poll(); t.stop();
  const [p] = t.current();
  near(groundDistance(47, 8, p.lat, p.lon), 2000, 30, 'moved ~10 s × 200 m/s');
  assert.ok(p.lat > 47, 'moved north');
});

test('a fresh report slides the plane instead of jumping', async () => {
  let now = Date.now();
  let lat = 47;
  const t = new Traffic(async () => ({ now, list: [{ hex: 'a', lat, lon: 8, alt: 5000, gs: 0, track: 0, vr: 0, t: now }] }));
  t.where = () => ({ lat: 47, lon: 8, rangeKm: 50 });
  await t.poll();
  lat = 47.001; // the new report is ~110 m further north
  await t.poll(); t.stop();
  const [p] = t.current();
  near(p.lat, 47, 0.0002, 'still drawn near the old spot right after the update');
});

test('simulator: arrivals descend to the runway, feed reports lag behind the truth', async () => {
  const sim = new Simulator(5, 5);
  const truth = sim.truth();
  assert.ok(truth.length >= 8);
  for (const p of truth) assert.ok(p.alt > 400 && p.alt < 13000, `${p.callsign} alt ${p.alt}`);
  const { list } = await sim.fetcher()(47.3769, 8.5417, 200);
  const a = list.find((x) => x.hex === 'sim006');
  const b = truth.find((x) => x.hex === 'sim006');
  near(groundDistance(a.lat, a.lon, b.lat, b.lon), b.gs * 5, 20, 'reported position is 5 s old');
});
