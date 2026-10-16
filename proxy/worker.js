// Cloudflare Worker: forwards the one endpoint FlightSpot needs to a free ADS-B feed and adds
// the CORS header the feeds don't send. Deploy it (see README), then paste its URL into
// FlightSpot → Settings → Feed URL.
//
// Only /v2/point/{lat}/{lon}/{radius_nm} is forwarded, so the worker can't be used as an open proxy.

const UPSTREAM = 'https://api.adsb.lol';
// Restrict to your GitHub Pages origin, e.g. 'https://yourname.github.io'. '*' allows any page.
const ALLOW_ORIGIN = '*';
const POINT = /^\/v2\/point\/-?\d{1,2}(\.\d+)?\/-?\d{1,3}(\.\d+)?\/\d{1,3}$/;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET' || !POINT.test(pathname)) {
      return new Response('Only GET /v2/point/{lat}/{lon}/{radius_nm}', { status: 400, headers: cors });
    }
    const up = await fetch(UPSTREAM + pathname, {
      headers: { 'User-Agent': 'flightspot-proxy' },
      cf: { cacheTtl: 2, cacheEverything: true }, // collapse identical requests for 2 s
    });
    return new Response(up.body, {
      status: up.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
