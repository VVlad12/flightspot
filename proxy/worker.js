// Cloudflare Worker: forwards the one endpoint FlightSpot needs to a free ADS-B feed and adds
// the CORS header the feeds don't send. Deploy it (see README), then paste its URL into
// FlightSpot → Settings → Feed URL.
//
// Only /v2/point/{lat}/{lon}/{radius_nm} is forwarded, so the worker can't be used as an open proxy.
// Workers share their outgoing IP addresses, and a feed may rate-limit them (429). The next feed
// in the list is tried then. Both return the same readsb JSON; the X-Upstream header says which.

const UPSTREAMS = [
  { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
];
// Restrict to your GitHub Pages origin, e.g. 'https://vvlad12.github.io'. '*' allows any page.
const ALLOW_ORIGIN = '*';
const POINT = /^\/v2\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Upstream',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const m = POINT.exec(new URL(request.url).pathname);
    if (request.method !== 'GET' || !m) {
      return new Response('Only GET /v2/point/{lat}/{lon}/{radius_nm}', { status: 400, headers: cors });
    }
    const [, lat, lon, nm] = m;
    const tried = [];
    for (const up of UPSTREAMS) {
      try {
        const res = await fetch(up.url(lat, lon, Math.min(250, +nm)), {
          headers: { 'User-Agent': 'flightspot-proxy (https://github.com/VVlad12/flightspot)' },
          // Collapse identical requests for 2 s, but never cache an error.
          cf: { cacheTtlByStatus: { '200-299': 2, '300-599': 0 }, cacheEverything: true },
        });
        if (res.ok) {
          return new Response(res.body, {
            headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Upstream': up.name },
          });
        }
        tried.push(`${up.name} ${res.status}`);
      } catch (err) {
        tried.push(`${up.name} ${err.message}`);
      }
    }
    return new Response(JSON.stringify({ error: `All feeds failed: ${tried.join(', ')}` }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
