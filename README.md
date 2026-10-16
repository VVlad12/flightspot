# FlightSpot

**Live:** https://vvlad12.github.io/flightspot/ (demo: [?demo](https://vvlad12.github.io/flightspot/?demo))

A phone web app (PWA) that labels the planes in the sky on the camera image: a box around each
plane with the airline, flight number, aircraft type, distance and altitude, from live ADS-B data.
It reuses the camera, compass and projection code of [Sun Path](https://github.com/VVlad12/sunpath).

- **Box size** shows distance: big when the plane is close, smaller further away, never smaller
  than a tap target. (At true scale an A320 10 km away is only about 3 px wide.)
- **Colour**: orange under 5 km, blue under 20 km, white further.
- **Dashed box**: the last position report is over 20 s old.
- **Arrows at the edge** point to the nearest planes outside the view.
- **Tap a box** for details: registration, speed, climb rate, direction, data age.

## How it works

1. Every 5 s it asks a free ADS-B feed for the planes within the max distance (+10 km).
   Your position is rounded to 0.01° (about 1 km) before it is sent.
2. Reports are 1–15 s old. Each plane is moved forward along its track at its ground speed and
   climb rate (dead reckoning) to where it is *now*. When a fresh report arrives, the plane slides
   to the new position over about 1.5 s instead of jumping.
3. Geodetic → ECEF → local east/north/up gives the azimuth, elevation and distance. Earth
   curvature is included. Altitude is the GNSS height (`alt_geom`, same reference as the phone's
   GPS) when the plane sends it, else pressure altitude.
4. The Sun Path camera model projects that direction onto the screen.

In demo mode (simulated traffic), the boxes are drawn from fake reports that are 1–9 s late,
and the real positions are drawn as small dark planes with contrails. If the boxes sit on the
planes, the prediction works. On straight paths the error is a few metres; in turns it grows
(the circling Cessna is off by about 50–100 m).

## The feed and the proxy

The free feeds ([adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi)) don't send CORS headers,
so a web page can't call them directly. The app calls `{Feed URL}/v2/point/{lat}/{lon}/{radius_nm}`
through a small proxy:

- **Local dev server**: `node serve.mjs` proxies `/adsb/...` to adsb.lol. On localhost the feed URL
  defaults to `/adsb`, so live data works without any setup.
- **On the phone (GitHub Pages)**: deploy `proxy/worker.js` as a Cloudflare Worker (free plan):
  1. Cloudflare dashboard → Workers & Pages → Create → Worker → paste `proxy/worker.js` → Deploy.
  2. Optional: set `ALLOW_ORIGIN` to your Pages origin, `https://vvlad12.github.io`.
  3. In the app: Settings → Feed URL → `https://<name>.<account>.workers.dev`.

  The worker forwards only the `/v2/point/...` endpoint, so it can't be used as an open proxy.
- **Without deploying anything**: plug the phone into the PC with USB, run `node serve.mjs`, and use
  Chrome's `chrome://inspect` → Port forwarding `8001 → localhost:8001`. On the phone,
  `http://localhost:8001` counts as secure, so the camera and sensors work and `/adsb` is proxied.

adsb.lol answers `429 Too Many Requests` if it is polled too often. The app then waits 15 s
before trying again. adsb.lol data is under the ODbL licence.

## Using it on the phone

1. Open the app in Chrome, tap **Start camera**, allow camera, location and motion sensors.
2. **Align the compass** once per session. The phone's compass can be off by 10–20°, which
   puts the boxes beside the planes. Pick a plane you can clearly see, tap its box, tap
   **Align compass on it**, put the real plane in the centre circle and tap **Set**.
   **Align** in the bottom bar does the same with the box nearest the centre. On a sunny day,
   Settings → **Calibrate with sun** works too.
3. If you calibrated the field of view in Sun Path, copy that value to Settings → Field of view.
4. **40 km** cycles the max distance (10 / 20 / 40 / 80 / 150 km). **Freeze** holds the image.

## Desktop demo

Open `?demo` (or tap **Demo**): Zürich city, looking north to the airport, with simulated
arrivals, departures, overflights and a circling Cessna. Drag or use the arrow keys to look
around. Settings → Source → **Live ADS-B feed** shows the real traffic around Zürich in the
same view (on the local dev server).

## Development

No build step: plain HTML, CSS and ES modules.

```
npm test                 # geometry, feed parsing, prediction, simulator (Node 18+)
node serve.mjs           # http://localhost:8001, with the /adsb feed proxy
```

When you change any file, bump `VERSION` in `sw.js` (and `js/app.js`) so installed copies update.

## Files

| File | Purpose |
|---|---|
| `js/projection.js` | Camera model (copied from Sun Path, keep in sync) |
| `js/sensors.js` | Camera, orientation, GPS (copied from Sun Path, plus `watchLocation` with altitude) |
| `js/solar.js` | Sun position, for sun calibration (copied from Sun Path) |
| `js/geo.js` | WGS84 → ECEF → ENU, look angles, dead reckoning |
| `js/feed.js` | Feed parsing (readsb JSON), polling, prediction and smoothing |
| `js/airlines.js` | Callsign → airline (ICAO code table), aircraft types and wingspans |
| `js/sim.js` | Simulated traffic around Zürich for demo mode |
| `js/render.js` | Boxes, labels, edge arrows, demo sky scene |
| `js/app.js` | UI, settings, calibration |
| `proxy/worker.js` | Cloudflare Worker that adds CORS to the feed |
| `serve.mjs` | Local static server with the `/adsb` proxy |

## Known limits

- The compass is the biggest source of error. Without alignment, boxes can be 10–20° off.
- Planes without ADS-B (some military flights, older GA aircraft) don't appear.
  Low planes far away may be missing where receiver coverage is thin.
- The airline table covers about 120 airlines, mostly European. Unknown codes show as `ABC 123`.
- Hills and buildings aren't modelled: a box can appear for a plane hidden behind a ridge.
