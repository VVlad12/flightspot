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
