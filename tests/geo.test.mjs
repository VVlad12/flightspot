import test from 'node:test';
import assert from 'node:assert/strict';
import { observer, look, extrapolate, destination, groundDistance, bearing } from '../js/geo.js';
import { Camera } from '../js/projection.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const ZRH = { lat: 47.3769, lon: 8.5417, h: 460 };

test('a plane straight overhead is at 90° elevation', () => {
  const o = observer(ZRH.lat, ZRH.lon, ZRH.h);
  const l = look(o.toEnu(ZRH.lat, ZRH.lon, ZRH.h + 10000));
  near(l.el, 90, 1e-6, 'el'); near(l.range, 10000, 1e-3, 'range');
});

test('a plane 10 km north at eye level sits just below the horizon (Earth curvature)', () => {
  const o = observer(ZRH.lat, ZRH.lon, ZRH.h);
  const p = destination(ZRH.lat, ZRH.lon, 10000, 0);
  const l = look(o.toEnu(p.lat, p.lon, ZRH.h));
  near(((l.az + 180) % 360) - 180, 0, 0.01, 'az');
  near(l.el, -0.045, 0.005, 'el'); // drop d²/2R ≈ 7.8 m over 10 km
  near(l.range, 10000, 5, 'range');
});

test('an airliner 30 km east at 11 km height is about 20° up', () => {
  const o = observer(ZRH.lat, ZRH.lon, ZRH.h);
  const p = destination(ZRH.lat, ZRH.lon, 30000, 90);
  const l = look(o.toEnu(p.lat, p.lon, 11000));
  near(l.az, 90, 0.2, 'az');
  near(l.el, 19.1, 0.3, 'el'); // atan((10540 - 70) / 30000)
});

test('dead reckoning moves the plane along its track', () => {
  const ac = { lat: ZRH.lat, lon: ZRH.lon, alt: 3000, gs: 100, track: 90, vr: 5 };
  const p = extrapolate(ac, 10);
  near(groundDistance(ac.lat, ac.lon, p.lat, p.lon), 1000, 1, 'distance');
  near(bearing(ac.lat, ac.lon, p.lat, p.lon), 90, 0.1, 'bearing');
  near(p.alt, 3050, 1e-9, 'climb');
});

test('the projected plane lands in the screen centre when the camera looks at it', () => {
  const o = observer(ZRH.lat, ZRH.lon, ZRH.h);
  const p = destination(ZRH.lat, ZRH.lon, 20000, 220);
  const l = look(o.toEnu(p.lat, p.lon, 6000));
  const cam = new Camera();
  cam.resize(400, 800);
  cam.setYawPitch(l.az, l.el);
  const [x, y] = cam.project(l.unit);
  near(x, 200, 1e-6, 'x'); near(y, 400, 1e-6, 'y');
});
