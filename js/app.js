import { sunPosition } from './solar.js';
import { Camera } from './projection.js';
import { startCamera, startOrientation, watchLocation } from './sensors.js';
import { observer, look } from './geo.js';
import { Traffic, liveFetcher } from './feed.js';
import { Simulator } from './sim.js';
import { AIRLINES, airlineOf, title, typeName } from './airlines.js';
import { OverlayRenderer, drawDemoScene, fmtAlt } from './render.js';

export const VERSION = '0.1.1';

const $ = (id) => document.getElementById(id);
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const FALLBACK_LOC = { lat: 47.3769, lon: 8.5417, h: 460, label: 'Zürich (default)' };
const RANGES = [10, 20, 40, 80, 150];
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  headingOffset: 0,       // fine correction, deg
  magDecl: null,          // magnetic declination, deg east; null = automatic
  fovLong: 67,
  feedUrl: null,          // null = '/adsb' on the local dev server, none elsewhere
  maxRange: 40,           // km
  showGround: false,
  edgeArrows: true,
  detail: 'full',
  units: 'm',
  loc: null,              // { lat, lon }
  altM: null,             // observer height override, m; null = GPS or default
};
const settings = loadSettings();

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('flightspot.settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('flightspot.settings', JSON.stringify(settings)); } catch { /* private mode */ }
}
function feedUrl() { return settings.feedUrl ?? (isLocal ? '/adsb' : ''); }

// ---------------------------------------------------------------- state
const cam = new Camera();
cam.fovLong = settings.fovLong;
const overlay = new OverlayRenderer($('overlay'));
const video = $('video');
const sceneCanvas = $('scene');
const sim = new Simulator();
window.flightspot = { cam, settings, sim }; // for poking around in the console

const state = {
  mode: null,            // 'camera' | 'demo'
  source: null,          // 'live' | 'sim'
  loc: null,             // { lat, lon, h }
  gpsAlt: null,
  locLabel: '',
  obs: null,
  items: [],
  selected: null,
  frozen: false,
  sensorSource: null,
  lastSensorAt: 0,
  lastAosAt: 0,
  sensorCounts: {},
  manualLook: false,
  yaw: 352, pitch: 7,
  cal: null,
  fps: 0,
};

// ---------------------------------------------------------------- logging
const logLines = [];
function log(msg) {
  logLines.push(`${new Date().toLocaleTimeString()} ${msg}`);
  if (logLines.length > 60) logLines.shift();
  if (!$('debug').hidden) $('debugLog').textContent = logLines.join('\n');
}
window.addEventListener('error', (e) => log(`ERROR ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => log(`REJECTION ${e.reason?.message || e.reason}`));

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- traffic
const traffic = new Traffic(null, log);
window.flightspot.traffic = traffic;
function setSource(src) {
  state.source = src;
  traffic.setFetcher(src === 'sim' ? sim.fetcher() : liveFetcher(feedUrl()));
  $('srcIn').value = src;
  log(`Traffic source: ${src === 'sim' ? 'simulated' : feedUrl() || '(no feed URL)'}`);
}
traffic.where = () => ({ lat: state.loc.lat, lon: state.loc.lon, rangeKm: settings.maxRange + 10 });

function computeItems() {
  if (!state.obs) return [];
  const out = [];
  for (const p of traffic.current()) {
    if (p.ac.ground && !settings.showGround) continue;
    const h = p.alt ?? state.obs.h;
    const l = look(state.obs.toEnu(p.lat, p.lon, h));
    if (l.range > settings.maxRange * 1000 || l.el < -1) continue;
    out.push({ ac: p.ac, look: l, alt: p.ac.ground ? null : h, age: p.age });
  }
  return out.sort((a, b) => a.look.range - b.look.range);
}

// ---------------------------------------------------------------- start
async function start(mode) {
  state.mode = mode;
  $('start').hidden = true;
  $('topbar').hidden = false;
  $('hud').hidden = false;

  if (mode === 'camera') {
    state.lastSensorAt = performance.now() + 1500;
    startOrientation((m, src) => {
      const now = performance.now();
      state.sensorCounts[src] = (state.sensorCounts[src] || 0) + 1;
      if (src === 'AbsoluteOrientationSensor') state.lastAosAt = now;
      else if (now - state.lastAosAt < 500) return;
      if (state.sensorSource !== src) { state.sensorSource = src; log(`Using readings from ${src}`); }
      state.lastSensorAt = now;
      if (!state.frozen) cam.setSensorMatrix(m);
    }, log);
    try {
      await startCamera(video);
      const setSize = () => cam.setVideoSize(video.videoWidth, video.videoHeight);
      video.addEventListener('loadedmetadata', setSize);
      video.addEventListener('resize', setSize);
      setSize();
    } catch (err) {
      log(`Camera failed: ${err.name}: ${err.message}`);
      toast('Camera not available, switching to demo mode.');
      return switchToDemo();
    }
    if (settings.loc) setLoc(settings.loc.lat, settings.loc.lon, 'saved');
    else setLoc(FALLBACK_LOC.lat, FALLBACK_LOC.lon, 'locating…');
    locate();
    setSource('live');
  } else {
    switchToDemo();
  }
  traffic.start(traffic.where);
}

function switchToDemo() {
  state.mode = 'demo';
  state.manualLook = true;
  $('sensorWarn').hidden = true;
  video.hidden = true;
  sceneCanvas.hidden = false;
  cam.setVideoSize(0, 0);
  setLoc(FALLBACK_LOC.lat, FALLBACK_LOC.lon, 'Zürich (demo)');
  setSource('sim');
  toast('Demo: Zürich, looking north to the airport. Drag to look around, tap a box.', 4500);
}

let stopWatch = null;
function locate() {
  if (stopWatch) stopWatch();
  let first = true;
  stopWatch = watchLocation((p) => {
    state.gpsAlt = p.alt;
    setLoc(p.lat, p.lon, `GPS ±${Math.round(p.acc)} m`);
    settings.loc = { lat: p.lat, lon: p.lon }; saveSettings();
    if (first) { log(`GPS fix ±${Math.round(p.acc)} m, altitude ${p.alt == null ? 'n/a' : Math.round(p.alt) + ' m'}`); first = false; }
  }, (err) => {
    log(`Location failed: ${err.message}`);
    if (state.locLabel === 'locating…') {
      state.locLabel = FALLBACK_LOC.label;
      toast('Location unavailable, using Zürich. Set it in Settings.', 4500);
    }
  });
}

function setLoc(lat, lon, label) {
  const h = settings.altM ?? state.gpsAlt ?? FALLBACK_LOC.h;
  state.loc = { lat, lon, h };
  state.locLabel = label;
  state.obs = observer(lat, lon, h);
  applyCalibration();
}

// ---------------------------------------------------------------- compass
function declination() { return settings.magDecl ?? autoDeclination(); }
function autoDeclination() {
  const l = state.loc;
  if (!l) return 0;
  // Switzerland, 2026: roughly +2.5° (Geneva) to +3.5° (Graubünden).
  if (l.lat > 45.5 && l.lat < 48.2 && l.lon > 5.5 && l.lon < 11) return 2.4 + (l.lon - 6) * 0.27;
  return 0;
}

function applyCalibration() {
  cam.headingOffset = declination() + settings.headingOffset;
  cam.fovLong = settings.fovLong;
  cam.updateFocal();
  cam.applyOffset();
  saveSettings();
  syncSettingsUI();
}

// ---------------------------------------------------------------- layout & loop
function resize() {
  // A hidden tab can report 0×0, which would make the focal length 0.
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight), dpr = Math.min(window.devicePixelRatio || 1, 3);
  cam.resize(w, h);
  overlay.resize(w, h, dpr);
  sceneCanvas.width = Math.round(w * dpr); sceneCanvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);
resize();

let frames = 0, fpsT = performance.now();
function frame(t) {
  frames++;
  if (t - fpsT > 1000) { state.fps = frames; frames = 0; fpsT = t; }
  if (state.mode) {
    if (state.manualLook) cam.setYawPitch(state.yaw - cam.headingOffset, state.pitch);
    if (state.mode === 'camera') updateSensorWarning();
    if (!state.frozen) state.items = computeItems();
    if (state.mode === 'demo') {
      // Draw the simulated planes only when the overlay shows simulated traffic.
      const truth = state.source !== 'sim' ? [] : state.frozen && state.truth ? state.truth : sim.truth().map((p) => ({
        ...p, look: look(state.obs.toEnu(p.lat, p.lon, p.alt)),
      }));
      state.truth = truth;
      drawDemoScene(sceneCanvas, cam, overlay.dpr, truth, state.obs.toEnu);
    }
    overlay.draw(cam, state.items, {
      selected: state.selected,
      edgeArrows: settings.edgeArrows,
      detail: settings.detail,
      units: settings.units,
    });
    updateReadout();
    if (t - statusAt > 500) { updateStatus(); statusAt = t; }
    updateDetail();
    if (!$('debug').hidden) updateDebug();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
let statusAt = 0;

function updateSensorWarning() {
  $('sensorWarn').hidden = performance.now() - state.lastSensorAt < 1500 || state.frozen;
}

function updateStatus() {
  if (!state.mode) return;
  const n = state.items.length;
  const src = state.source === 'sim' ? 'simulated' : hostOf(feedUrl());
  const ago = traffic.lastOk ? `${Math.round((Date.now() - traffic.lastOk) / 1000)} s ago` : 'no data yet';
  $('statusMain').textContent = traffic.lastOk ? `${n} plane${n === 1 ? '' : 's'} within ${settings.maxRange} km` : 'Waiting for traffic…';
  $('statusSub').textContent = traffic.lastError ? `${src} · ${traffic.lastError}` : `${src} · updated ${ago}`;
  const err = state.source === 'live' && traffic.lastError && !traffic.lastOk;
  $('feedWarn').hidden = !err || !$('settingsSheet').hidden;
  if (err) {
    $('feedWarnText').innerHTML = feedUrl()
      ? `<b>No traffic from the feed.</b> ${escapeHtml(traffic.lastError)}. Check the feed URL in Settings.`
      : '<b>No feed URL set.</b> The free ADS-B feeds need a small proxy to be used from a web page. Set its URL in Settings (see the README).';
  }
}

function hostOf(u) {
  if (!u) return 'no feed';
  if (u.startsWith('/')) return `local proxy ${u}`;
  try { return new URL(u).host; } catch { return u; }
}

function updateReadout() {
  const f = cam.forward();
  const dir = COMPASS16[Math.round(f.az / 22.5) % 16];
  const frozen = state.frozen ? ' · FROZEN' : '';
  $('readout').textContent = `Facing ${Math.round(f.az)}° ${dir} · elev ${Math.round(f.el)}°${frozen}`;
}

function updateDebug() {
  const m = cam.measuredForward(), f = cam.forward();
  const ages = state.items.map((i) => i.age);
  $('debugInfo').textContent = [
    `FlightSpot v${VERSION}  mode=${state.mode}  source=${state.source}  fps=${state.fps}`,
    `orientation: ${state.manualLook ? 'manual drag (demo)' : state.sensorSource || 'NO READINGS'}`,
    `readings: ${Object.entries(state.sensorCounts).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'}`,
    `magnetic az ${m.az.toFixed(1)}  el ${m.el.toFixed(1)}  roll ${cam.roll().toFixed(1)}`,
    `true az ${f.az.toFixed(1)}  = magnetic + decl ${declination().toFixed(1)} + fine ${settings.headingOffset.toFixed(1)}`,
    `fovLong ${cam.fovLong.toFixed(1)}°  f ${cam.f.toFixed(0)} css px  screen ${cam.width}×${cam.height}`,
    `loc ${state.loc?.lat.toFixed(5)}, ${state.loc?.lon.toFixed(5)}  h ${state.loc?.h.toFixed(0)} m (${state.locLabel})`,
    `feed ${feedUrl() || '–'}  polls ${traffic.polls}  tracked ${traffic.planes.size}  shown ${state.items.length}`,
    `clock offset ${(traffic.clockOffset / 1000).toFixed(1)} s  data age ${ages.length ? `${Math.min(...ages).toFixed(1)}–${Math.max(...ages).toFixed(1)} s` : '–'}`,
    `secure=${window.isSecureContext}  AOS=${'AbsoluteOrientationSensor' in window}`,
  ].join('\n');
}

// ---------------------------------------------------------------- selection & detail
function selectedItem() { return state.items.find((i) => i.ac.hex === state.selected) || null; }

let detailKey = '';
function updateDetail() {
  const it = selectedItem();
  $('detail').hidden = !it;
  if (!it) { detailKey = ''; return; }
  const { ac, look: l } = it;
  // Refresh the text about 4 times a second, not every frame.
  const key = `${ac.hex}|${Math.round(l.range / 50)}|${Math.round(it.age * 4)}`;
  if (key === detailKey) return;
  detailKey = key;
  const a = airlineOf(ac.callsign);
  $('dTitle').textContent = title(ac);
  $('dSub').textContent = [a.name ? ac.callsign : (a.code ? 'unknown airline code' : 'private or other flight'),
    ac.desc || typeName(ac.type), ac.reg].filter(Boolean).join(' · ');
  const vr = ac.vr * 196.85; // m/s → ft/min
  const rows = [
    ['Distance', `${(l.range / 1000).toFixed(1)} km`],
    ['Altitude', it.alt == null ? 'ground' : `${fmtAlt(it.alt, settings.units)}${ac.altSrc === 'baro' ? ' (baro)' : ''}`],
    ['Speed', `${Math.round(ac.gs * 3.6)} km/h`],
    ['Climb', Math.abs(vr) < 100 ? 'level' : `${vr > 0 ? '↑' : '↓'} ${Math.round(Math.abs(vr) / 100) * 100} ft/min`],
    ['Direction', `${Math.round(l.az)}° ${COMPASS16[Math.round(l.az / 22.5) % 16]}`],
    ['Elevation', `${l.el.toFixed(1)}°`],
    ['Heading', `${Math.round(ac.track)}°`],
    ['Data age', `${it.age.toFixed(0)} s`],
  ];
  $('dGrid').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  $('dMap').href = `https://globe.adsb.lol/?icao=${encodeURIComponent(ac.hex)}`;
  $('dMap').hidden = state.source === 'sim';
}
$('dClose').onclick = () => { state.selected = null; };

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------------------------------------------------------------- drag to look / tap
let drag = null;
$('overlay').addEventListener('pointerdown', (e) => {
  state.dragMoved = false;
  if (!state.manualLook) return;
  drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
  $('overlay').setPointerCapture(e.pointerId);
});
$('overlay').addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) state.dragMoved = true;
  const k = 57.2958 / cam.f;
  state.yaw = (drag.yaw - (e.clientX - drag.x) * k + 360) % 360;
  state.pitch = Math.max(-30, Math.min(85, drag.pitch + (e.clientY - drag.y) * k));
});
$('overlay').addEventListener('pointerup', () => (drag = null));
$('overlay').addEventListener('pointercancel', () => (drag = null));
window.addEventListener('keydown', (e) => {
  if (!state.manualLook || e.target.matches('input, select')) return;
  const s = e.shiftKey ? 5 : 1;
  if (e.key === 'ArrowLeft') state.yaw = (state.yaw - s + 360) % 360;
  if (e.key === 'ArrowRight') state.yaw = (state.yaw + s) % 360;
  if (e.key === 'ArrowUp') state.pitch = Math.min(85, state.pitch + s);
  if (e.key === 'ArrowDown') state.pitch = Math.max(-30, state.pitch - s);
});
$('overlay').addEventListener('click', (e) => {
  if ([...document.querySelectorAll('.sheet')].some((s) => !s.hidden)) return closeSheets();
  if (state.dragMoved) { state.dragMoved = false; return; }
  state.selected = overlay.hitTest(e.clientX, e.clientY);
});

// ---------------------------------------------------------------- calibration
/** The plane to align on: the selected one, or the one closest to the crosshair. */
function alignTarget() {
  const sel = selectedItem();
  if (sel) return sel;
  let best = null, bestD = Infinity;
  for (const it of state.items) {
    const p = cam.project(it.look.unit);
    if (!p) continue;
    const d = Math.hypot(p[0] - cam.width / 2, p[1] - cam.height / 2);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function beginCal(kind) {
  closeSheets();
  if (kind === 'sun') {
    const s = state.loc && sunPosition(new Date(), state.loc.lat, state.loc.lon);
    if (!s || s.el < 1) return toast('The sun is below the horizon now. Align on a plane instead.', 4500);
    state.cal = { kind };
    $('calText').innerHTML = 'Put the <b>real sun</b> in the centre circle (look at the screen, not at the sun), then tap <b>Set</b>.';
  } else {
    const it = alignTarget();
    if (!it) return toast('No plane in view to align on.');
    state.selected = it.ac.hex;
    state.cal = { kind, hex: it.ac.hex };
    $('calText').innerHTML = `Find <b>${escapeHtml(title(it.ac))}</b> (${(it.look.range / 1000).toFixed(1)} km, the highlighted box) in the real sky, put it in the <b>centre circle</b> and tap <b>Set</b>. Pick a plane that is clearly visible and close.`;
  }
  $('calBanner').hidden = false;
}

function setCal() {
  const c = state.cal;
  if (!c) return;
  let target;
  if (c.kind === 'sun') target = sunPosition(new Date(), state.loc.lat, state.loc.lon);
  else {
    const it = state.items.find((i) => i.ac.hex === c.hex);
    if (!it) { toast('That plane is no longer tracked.'); return endCal(); }
    target = it.look;
  }
  const m = cam.measuredForward();
  const off = ((target.az - m.az - declination() + 540) % 360) - 180;
  settings.headingOffset = Math.round(off * 10) / 10;
  applyCalibration();
  const dEl = target.el - m.el;
  toast(`Fine correction set to ${settings.headingOffset > 0 ? '+' : ''}${settings.headingOffset.toFixed(1)}°` +
    (Math.abs(dEl) > 3 ? `. Elevation is off by ${dEl.toFixed(1)}°; check the field of view.` : '.'), 5000);
  endCal();
}

function endCal() { state.cal = null; $('calBanner').hidden = true; }

$('calSunBtn').onclick = () => beginCal('sun');
$('alignBtn').onclick = () => beginCal('plane');
$('dAlign').onclick = () => beginCal('plane');
$('calSet').onclick = setCal;
$('calCancel').onclick = endCal;

// ---------------------------------------------------------------- buttons
$('freezeBtn').onclick = () => {
  state.frozen = !state.frozen;
  $('freezeBtn').classList.toggle('on', state.frozen);
  $('freezeBtn').textContent = state.frozen ? 'Live' : 'Freeze';
  if (state.mode === 'camera') state.frozen ? video.pause() : video.play();
};
$('rangeBtn').onclick = () => {
  const i = RANGES.findIndex((r) => r >= settings.maxRange);
  settings.maxRange = RANGES[(i + 1) % RANGES.length];
  saveSettings(); syncSettingsUI(); updateStatus();
};
$('debugBtn').onclick = () => {
  $('debug').hidden = !$('debug').hidden;
  $('debugBtn').classList.toggle('on', !$('debug').hidden);
  $('debugLog').textContent = logLines.join('\n');
};
$('statusBtn').onclick = () => { syncSettingsUI(); openSheet('settingsSheet'); };
$('feedSetBtn').onclick = () => { syncSettingsUI(); openSheet('settingsSheet'); };
$('feedDemoBtn').onclick = () => setSource('sim');

// ---------------------------------------------------------------- settings sheet
function closeSheets() { for (const s of document.querySelectorAll('.sheet')) s.hidden = true; }
function openSheet(id) { closeSheets(); $(id).hidden = false; $('feedWarn').hidden = true; }
for (const b of document.querySelectorAll('[data-close]')) b.onclick = closeSheets;
$('settingsBtn').onclick = () => { syncSettingsUI(); openSheet('settingsSheet'); };

function syncSettingsUI() {
  $('srcIn').value = state.source || 'live';
  $('feedIn').value = settings.feedUrl ?? '';
  $('feedIn').placeholder = isLocal ? '/adsb (local dev proxy)' : 'https://your-proxy.workers.dev';
  $('rangeIn').value = settings.maxRange;
  $('rangeOut').textContent = `${settings.maxRange} km`;
  $('rangeBtn').textContent = `${settings.maxRange} km`;
  $('optGround').checked = settings.showGround;
  $('optArrows').checked = settings.edgeArrows;
  $('optDetail').value = settings.detail;
  $('optUnits').value = settings.units;
  $('declIn').value = settings.magDecl ?? '';
  $('declIn').placeholder = `auto ${autoDeclination().toFixed(1)}`;
  $('declInfo').textContent = settings.magDecl == null
    ? `Automatic: ${autoDeclination().toFixed(1)}°${autoDeclination() ? ' (estimate for Switzerland)' : ' (unknown here: enter it from magnetic-declination.com)'}.`
    : `Manual: ${settings.magDecl.toFixed(1)}°. Clear the field for automatic.`;
  $('offsetIn').value = settings.headingOffset;
  $('offsetOut').textContent = `${settings.headingOffset > 0 ? '+' : ''}${settings.headingOffset.toFixed(1)}°`;
  $('fovIn').value = settings.fovLong;
  $('fovOut').textContent = `${settings.fovLong.toFixed(1)}°`;
  if (state.loc) { $('latIn').value = state.loc.lat.toFixed(5); $('lonIn').value = state.loc.lon.toFixed(5); }
  $('altIn').value = settings.altM ?? '';
  $('altIn').placeholder = state.gpsAlt != null ? `GPS ${Math.round(state.gpsAlt)}` : `${FALLBACK_LOC.h}`;
  $('locInfo').textContent = state.loc
    ? `Using ${state.loc.lat.toFixed(4)}, ${state.loc.lon.toFixed(4)}, ${Math.round(state.loc.h)} m (${state.locLabel}).`
    : 'No location yet.';
  $('versionInfo').textContent = `FlightSpot v${VERSION} · ${Object.keys(AIRLINES).length} airlines known`;
}

$('srcIn').onchange = (e) => setSource(e.target.value);
$('feedIn').onchange = (e) => {
  const v = e.target.value.trim();
  settings.feedUrl = v === '' ? null : v;
  saveSettings();
  if (state.source === 'live') setSource('live');
};
$('rangeIn').oninput = (e) => { settings.maxRange = +e.target.value; saveSettings(); syncSettingsUI(); };
$('optGround').onchange = (e) => { settings.showGround = e.target.checked; saveSettings(); };
$('optArrows').onchange = (e) => { settings.edgeArrows = e.target.checked; saveSettings(); };
$('optDetail').onchange = (e) => { settings.detail = e.target.value; saveSettings(); };
$('optUnits').onchange = (e) => { settings.units = e.target.value; saveSettings(); detailKey = ''; };
$('declIn').onchange = (e) => {
  const v = e.target.value.trim();
  settings.magDecl = v === '' || isNaN(+v) ? null : Math.max(-30, Math.min(30, +v));
  applyCalibration();
};
$('offsetIn').oninput = (e) => { settings.headingOffset = +e.target.value; applyCalibration(); };
$('fovIn').oninput = (e) => { settings.fovLong = +e.target.value; applyCalibration(); };
$('gpsBtn').onclick = () => { $('locInfo').textContent = 'Locating…'; locate(); };
$('locApply').onclick = () => {
  const lat = parseFloat($('latIn').value), lon = parseFloat($('lonIn').value);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return toast('Invalid coordinates.');
  const alt = $('altIn').value.trim();
  settings.altM = alt === '' || isNaN(+alt) ? null : +alt;
  if (stopWatch) { stopWatch(); stopWatch = null; }
  settings.loc = { lat, lon }; saveSettings();
  setLoc(lat, lon, 'manual');
  toast('Location updated.');
};
$('resetBtn').onclick = () => {
  settings.headingOffset = DEFAULTS.headingOffset;
  settings.magDecl = DEFAULTS.magDecl;
  settings.fovLong = DEFAULTS.fovLong;
  applyCalibration();
  toast('Corrections reset.');
};
$('updateBtn').onclick = async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (err) { log(`Update: ${err.message}`); }
  location.reload();
};

// ---------------------------------------------------------------- boot
$('startBtn').onclick = () => start('camera');
$('demoBtn').onclick = () => start('demo');
if (new URLSearchParams(location.search).has('demo')) start('demo');

if ('serviceWorker' in navigator && !isLocal) {
  navigator.serviceWorker.register('sw.js').catch((err) => log(`SW: ${err.message}`));
}
$('reloadBtn').onclick = () => location.reload();
syncSettingsUI();
log(`FlightSpot v${VERSION} loaded`);
