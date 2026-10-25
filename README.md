# FlightSpot

An Android app that labels the planes in the sky on the camera image: a box around each plane with
the airline, flight number, aircraft type, distance and altitude, from live ADS-B data.
It reuses the camera, compass and projection code of [Sun Path](https://github.com/VVlad12/sunpath).

**Web demo** (simulated traffic): https://vvlad12.github.io/flightspot/?demo

- **Box size** shows distance: big when the plane is close, smaller further away, never smaller
  than a tap target. (At true scale an A320 10 km away is only about 3 px wide.)
- **Colour**: orange under 5 km, blue under 20 km, white further.
- **Dashed box**: the last position report is over 20 s old.
- **Arrows at the edge** point to the nearest planes outside the view.
- **Tap a box** for details: origin → destination, registration, speed, climb rate, height above
  you, where the position comes from, data age.
- **Destination** on the label ("Swiss 14V → New York"), from [adsbdb.com](https://www.adsbdb.com)
  route data. Routes are schedule data, so each one is checked against where the plane actually
  is; a route that doesn't fit is left off the label and marked as possibly outdated in the card.
- **GPS dot** in the status pill: red = no fix (saved or default position), blinking orange =
  settling, green = stable. Fixes are averaged over the last minute while you stand still, which
  brings a 20–50 m first fix down to a few metres; walking off restarts the average. Wait for
  green before aligning the compass.

## How it works

1. Every 5 s it asks a free ADS-B feed for the planes within the max distance (+10 km).
   Your position is rounded to 0.01° (about 1 km) before it is sent.
2. Reports are 1–15 s old. Each plane is moved forward along its track at its ground speed and
   climb rate (dead reckoning) to where it is *now*. When a fresh report arrives, the plane slides
   to the new position over about 1.5 s instead of jumping.
3. Geodetic → ECEF → local east/north/up gives the azimuth, elevation and distance. Earth
   curvature is included. Altitude is the GNSS height (`alt_geom`, same reference as the phone's
   GPS) when the plane sends it, else pressure altitude.
4. The Sun Path camera model projects that direction onto the screen. In the Android app the
   phone's orientation comes from Android's rotation vector sensor (gyroscope + accelerometer +
   magnetometer, fused by the system), which stays steady when pointing up at the sky. The
   WebView's own orientation angles jump around there.

In demo mode (simulated traffic), the boxes are drawn from fake reports that are 1–9 s late,
and the real positions are drawn as small dark planes with contrails. If the boxes sit on the
planes, the prediction works. On straight paths the error is a few metres; in turns it grows
(the circling Cessna is off by about 50–100 m).

## Live data: why an Android app

Positions come from [adsb.lol](https://adsb.lol), a free community ADS-B network (data under the
ODbL licence, credited in the app). adsb.lol doesn't send CORS headers, so a web page may not
read its answers, and proxies on Cloudflare are refused by every free feed (adsb.lol 429,
adsb.fi 403, OpenSky timeouts). In the Android app, `fetch()` goes through Android's own HTTP
client (Capacitor's `CapacitorHttp`), which has no CORS rule: the phone calls adsb.lol directly,
from its own connection.

- **Android app**: live traffic from adsb.lol.
- **Web version** (GitHub Pages): simulated traffic only, with a note saying so.
- **Local dev server**: `node serve.mjs` passes `/adsb/...` through to adsb.lol, so live data can
  be tested in a desktop browser.

The same `index.html`, `css/` and `js/` run in all three. Per hour of use the app makes about
720 requests (one every 5 s) and downloads roughly 5–20 MB, only while it is open. Callsigns of
planes in view are sent to adsbdb.com to look up routes (cached for 6 h). If adsb.lol
answers 429 (rate-limited), the app waits 15 s and tries again.

## Installing on the phone

1. Copy `android/app/build/outputs/apk/debug/app-debug.apk` to the phone (USB, Drive, email…)
   and open it. Android asks to allow installing apps from that source the first time.
2. Open **FlightSpot**, tap **Start camera**, allow the camera and location.
3. **Align the compass** once per session. The phone's compass can be off by 10–20°, which
   puts the boxes beside the planes. Pick a plane you can clearly see, tap its box, tap
   **Align compass on it**, put the real plane in the centre circle and tap **Set**.
   **Align** in the bottom bar does the same with the box nearest the centre. On a sunny day,
   Settings → **Calibrate with sun** works too.
4. If you calibrated the field of view in Sun Path, copy that value to Settings → Field of view.
5. **40 km** cycles the max distance (10 / 20 / 40 / 80 / 150 km). **Freeze** holds the image.

## Desktop demo

Open `?demo` (or tap **Demo**): Zürich city, looking north to the airport, with simulated
arrivals, departures, overflights and a circling Cessna. Drag or use the arrow keys to look
around. On the local dev server, Settings → Source → **Live ADS-B feed** shows the real traffic
around Zürich in the same view.

## Development

The web app is plain HTML, CSS and ES modules, no build step. The Android app is a Capacitor 6
wrapper around the same files (Capacitor 6 because it builds with JDK 17).

```
npm install              # Capacitor, once
npm test                 # geometry, feed parsing, prediction, simulator (Node 18+)
node serve.mjs           # http://localhost:8001, with the /adsb passthrough
npm run android:apk      # copy the web app to www/, sync, build the debug APK
```

`npm run android:sync` then opening `android/` in Android Studio also works (Run ▶ installs on a
connected phone). Needs JDK 17 and the Android SDK (platform 35); `android/local.properties`
points to the SDK and isn't committed. `node scripts/make-icons.mjs` redraws the web and launcher
icons.

When you change any file, bump `VERSION` in `sw.js` and `js/app.js` so installed web copies update.

## Files

| File | Purpose |
|---|---|
| `js/projection.js` | Camera model (copied from Sun Path, keep in sync) |
| `js/sensors.js` | Camera, orientation, GPS (copied from Sun Path, plus `watchLocation` with altitude) |
| `js/solar.js` | Sun position, for sun calibration (copied from Sun Path) |
| `js/geo.js` | WGS84 → ECEF → ENU, look angles, dead reckoning |
| `js/feed.js` | Feed parsing (readsb JSON), polling, prediction and smoothing, ground filter |
| `js/gps.js` | Averages GPS fixes into a steadier position, settling / stable status |
| `js/routes.js` | Origin and destination from adsbdb.com, cached, checked against the plane's position |
| `js/airlines.js` | Callsign → airline (ICAO code table), aircraft types and wingspans |
| `js/sim.js` | Simulated traffic around Zürich for demo mode |
| `js/render.js` | Boxes, labels, edge arrows, demo sky scene |
| `js/app.js` | UI, settings, calibration, picks the feed (native / dev server / none) |
| `android/` | Capacitor Android project (permissions: camera, location, internet) |
| `android/.../OrientationPlugin.java` | Phone orientation from Android's rotation vector sensor |
| `capacitor.config.json` | App id `ch.dxan.flightspot`, native HTTP on |
| `scripts/build-www.mjs` | Copies the web app into `www/` for Capacitor |
| `scripts/make-icons.mjs` | Draws the web and Android icons |
| `serve.mjs` | Local static server with the `/adsb` passthrough |

## Known limits

- The compass is the biggest source of error. Without alignment, boxes can be 10–20° off. When
  Android reports the magnetometer as unreliable, the readout turns red: move the phone in a
  figure 8 to recalibrate it, away from metal, magnets and phone cases with magnetic clasps.
- Planes without ADS-B (some military flights, older GA aircraft) don't appear.
  Low planes far away may be missing where receiver coverage is thin.
- The airline table covers about 120 airlines, mostly European. Unknown codes show as `ABC 123`.
- Hills and buildings aren't modelled: a box can appear for a plane hidden behind a ridge.
- Targets that can't be flying are hidden: flagged on ground, ground vehicles (category C), or
  slower than about 30 kt within 300 m of your height (except helicopters, balloons, ultralights).
  Settings → Show planes on the ground shows them again; tap one to see why it was classed so.
