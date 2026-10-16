import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';

const req = (path, method = 'GET') => new Request(`https://w.example${path}`, { method });

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return fake(String(url)); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

test('falls back to adsb.fi when adsb.lol rate-limits', async () => {
  await withFetch((url) => url.includes('adsb.lol')
    ? new Response('<html>429</html>', { status: 429 })
    : new Response('{"now":1,"aircraft":[]}', { status: 200 }), async (calls) => {
    const res = await worker.fetch(req('/v2/point/47.45/8.56/40'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Upstream'), 'adsb.fi');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(await res.json(), { now: 1, aircraft: [] });
    assert.equal(calls[1], 'https://opendata.adsb.fi/api/v2/lat/47.45/lon/8.56/dist/40');
  });
});

test('uses adsb.lol when it answers', async () => {
  await withFetch(() => new Response('{"ac":[]}'), async (calls) => {
    const res = await worker.fetch(req('/v2/point/47.45/8.56/40'));
    assert.equal(res.headers.get('X-Upstream'), 'adsb.lol');
    assert.equal(calls.length, 1);
  });
});

test('reports every failure as JSON with CORS, so the app can show it', async () => {
  await withFetch(() => new Response('nope', { status: 429 }), async () => {
    const res = await worker.fetch(req('/v2/point/47.45/8.56/40'));
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match((await res.json()).error, /adsb\.lol 429, adsb\.fi 429/);
  });
});

test('refuses anything but the point endpoint', async () => {
  await withFetch(() => { throw new Error('must not fetch'); }, async () => {
    assert.equal((await worker.fetch(req('/v2/all'))).status, 400);
    assert.equal((await worker.fetch(req('/v2/point/47/8/40', 'POST'))).status, 400);
    assert.equal((await worker.fetch(req('/v2/point/47/8/40', 'OPTIONS'))).status, 200);
  });
});

import { openskyToReadsb, feedOrder } from '../proxy/worker.js';
import { parseResponse } from '../js/feed.js';

test('OpenSky state vectors convert to readsb that the app parses', () => {
  const T = 1792150000;
  const j = { time: T, states: [
    ['4b1903', 'SWR14V  ', 'Switzerland', T - 3, T - 1, 7.7, 47.4, 5000, false, 177.2, 275, 2.9, null, 5288, '3021', false, 0, 6],
    ['4b0001', 'HBKFU', 'Switzerland', T - 10, T - 1, 8.56, 47.45, null, true, 1, 90, null, null, null, null, false, 0, 2],
    ['4b0002', 'NOPOS', 'Switzerland', null, T - 1, null, null, 3000, false, 100, 0, 0, null, 3100, null, false, 0, 4],
  ] };
  const r = openskyToReadsb(j, '3999');
  assert.equal(r.ac.length, 2, 'state without a position is dropped');
  assert.equal(r.credits_left, 3999);
  const { now, list } = parseResponse(JSON.parse(JSON.stringify(r)));
  assert.equal(now, T * 1000);
  const a = list[0];
  assert.equal(a.callsign, 'SWR14V');
  assert.equal(a.category, 'A5');
  assert.ok(Math.abs(a.alt - 5288) < 0.2, `geometric altitude ${a.alt}`);
  assert.ok(Math.abs(a.gs - 177.2) < 0.01, `speed ${a.gs}`);
  assert.ok(Math.abs(a.vr - 2.9) < 0.01, `climb ${a.vr}`);
  assert.equal(a.t, (T - 3) * 1000, 'position time');
  assert.equal(list[1].ground, true);
});

test('with OpenSky credentials OpenSky goes first and logs in once', async () => {
  assert.deepEqual(feedOrder({}), ['adsb.lol', 'adsb.fi', 'opensky']);
  assert.deepEqual(feedOrder({ OPENSKY_CLIENT_ID: 'x' }), ['opensky', 'adsb.lol', 'adsb.fi']);
  assert.deepEqual(feedOrder({ FEEDS: 'adsb.fi, bogus, opensky' }), ['adsb.fi', 'opensky']);
  const env = { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' };
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization });
    if (String(url).includes('/token')) return new Response('{"access_token":"tok","expires_in":1800}');
    return new Response(JSON.stringify({ time: 1, states: [] }), { headers: { 'X-Rate-Limit-Remaining': '3998' } });
  };
  try {
    for (let i = 0; i < 2; i++) {
      const res = await worker.fetch(req('/v2/point/47.45/8.56/40'), env);
      assert.equal(res.headers.get('X-Upstream'), 'opensky');
      assert.equal(res.headers.get('X-Poll-Interval'), '10');
    }
  } finally { globalThis.fetch = real; }
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 1, 'token reused');
  const api = calls.filter((c) => c.url.includes('/states/all'));
  assert.equal(api[0].auth, 'Bearer tok');
  assert.match(api[0].url, /lamin=46\.785&lamax=48\.115&lomin=7\.576&lomax=9\.544/);
});
