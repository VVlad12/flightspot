// Cloudflare Worker: forwards the one endpoint FlightSpot needs to a free ADS-B feed and adds
// the CORS header the feeds don't send. Deploy it (see README), then paste its URL into
// FlightSpot → Settings → Feed URL.
//
// Only /v2/point/{lat}/{lon}/{radius_nm} is answered, so the worker can't be used as an open proxy.
// Feeds are tried in order until one answers; the X-Upstream header says which one did.
// adsb.lol and adsb.fi often refuse Cloudflare's shared addresses (429 / 403). OpenSky Network
// is converted to the same readsb JSON, so the app sees no difference.
//
// Optional settings (Worker → Settings → Variables and Secrets):
//   OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET  OpenSky API client (secrets). Without them OpenSky
//                                             is used anonymously, which has a much smaller quota.
//   FEEDS                                     Order to try, e.g. "opensky,adsb.lol,adsb.fi".

// Restrict to your GitHub Pages origin, e.g. 'https://vvlad12.github.io'. '*' allows any page.
const ALLOW_ORIGIN = '*';
const POINT = /^\/v2\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/;
const UA = 'flightspot-proxy (https://github.com/VVlad12/flightspot)';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const FEEDS = {
  'adsb.lol': (lat, lon, nm) => readsb(`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`),
  'adsb.fi': (lat, lon, nm) => readsb(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`),
  opensky: (lat, lon, nm, env) => opensky(+lat, +lon, +nm, env),
};

export default {
  async fetch(request, env = {}) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Upstream, X-Poll-Interval',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const m = POINT.exec(new URL(request.url).pathname);
    if (request.method !== 'GET' || !m) {
      return new Response('Only GET /v2/point/{lat}/{lon}/{radius_nm}', { status: 400, headers: cors });
    }
    const [, lat, lon, nm] = m;
    const tried = [];
    for (const name of feedOrder(env)) {
      try {
        const r = await FEEDS[name](lat, lon, Math.min(250, +nm), env);
        if (r.ok) {
          return new Response(r.body, {
            headers: {
              ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
              'X-Upstream': name, 'X-Poll-Interval': String(r.interval || 5),
            },
          });
        }
        tried.push(`${name} ${r.why}`);
      } catch (err) {
        tried.push(`${name} ${err.message}`);
      }
    }
    return new Response(JSON.stringify({ error: `All feeds failed: ${tried.join(', ')}` }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};

/** With OpenSky credentials, OpenSky goes first: the others usually refuse Cloudflare anyway. */
export function feedOrder(env) {
  if (env.FEEDS) return env.FEEDS.split(',').map((s) => s.trim()).filter((s) => FEEDS[s]);
  return env.OPENSKY_CLIENT_ID ? ['opensky', 'adsb.lol', 'adsb.fi'] : ['adsb.lol', 'adsb.fi', 'opensky'];
}

async function readsb(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    // Collapse identical requests for 2 s, but never cache an error.
    cf: { cacheTtlByStatus: { '200-299': 2, '300-599': 0 }, cacheEverything: true },
  });
  if (!res.ok) return { ok: false, why: res.status };
  return { ok: true, body: res.body, interval: 5 };
}

// ---------------------------------------------------------------- OpenSky Network

let token = null; // { value, exp } — kept while this Worker instance lives

async function openskyToken(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  if (token && token.exp > Date.now() + 60000) return token.value;
  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`login ${res.status} (check OPENSKY_CLIENT_ID / _SECRET)`);
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 1800) * 1000 };
  return token.value;
}

async function opensky(lat, lon, nm, env) {
  // Bounding box around the circle. Under 25 square degrees costs 1 credit per request.
  const dLat = (nm * 1.852) / 111.32;
  const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const q = new URLSearchParams({
    lamin: (lat - dLat).toFixed(3), lamax: (lat + dLat).toFixed(3),
    lomin: (lon - dLon).toFixed(3), lomax: (lon + dLon).toFixed(3), extended: '1',
  });
  const url = `https://opensky-network.org/api/states/all?${q}`;
  let auth = await openskyToken(env);
  let res = await fetch(url, { headers: { 'User-Agent': UA, ...(auth && { Authorization: `Bearer ${auth}` }) } });
  if (res.status === 401 && auth) {
    token = null; // expired early: log in again once
    auth = await openskyToken(env);
    res = await fetch(url, { headers: { 'User-Agent': UA, Authorization: `Bearer ${auth}` } });
  }
  if (!res.ok) {
    const retry = res.headers.get('X-Rate-Limit-Retry-After-Seconds');
    return { ok: false, why: `${res.status}${retry ? ` (quota used up, retry in ${Math.round(retry / 60)} min)` : ''}${auth ? '' : ' anonymous'}` };
  }
  const left = res.headers.get('X-Rate-Limit-Remaining');
  return {
    ok: true,
    body: JSON.stringify(openskyToReadsb(await res.json(), left)),
    // OpenSky updates every 5 s with an account, every 10 s anonymously. Polling slower saves quota.
    interval: auth ? 10 : 15,
  };
}

const CATEGORY = [null, null, 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'B1', 'B2', 'B3', 'B4', null, 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'C5'];
const FT = 3.28084;

/** OpenSky state vectors → readsb JSON, the format the app reads. */
export function openskyToReadsb(j, creditsLeft = null) {
  const now = j.time || Math.floor(Date.now() / 1000);
  const ac = [];
  for (const s of j.states || []) {
    const [hex, callsign, , tPos, , lon, lat, baro, ground, vel, track, vr, , geo, squawk, , , cat] = s;
    if (lat == null || lon == null || tPos == null) continue;
    ac.push({
      hex,
      flight: (callsign || '').trim(),
      alt_baro: ground ? 'ground' : baro == null ? undefined : Math.round(baro * FT),
      alt_geom: geo == null ? undefined : Math.round(geo * FT),
      gs: vel == null ? undefined : vel * 1.943844,
      track: track ?? undefined,
      geom_rate: vr == null ? undefined : Math.round(vr * FT * 60),
      squawk: squawk || undefined,
      category: CATEGORY[cat] || undefined,
      lat, lon,
      seen_pos: Math.max(0, now - tPos),
    });
  }
  return { now: now * 1000, ac, source: 'opensky', credits_left: creditsLeft == null ? undefined : +creditsLeft };
}
