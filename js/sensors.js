// Device inputs: back camera, orientation (compass-referenced) and location.
// Copied from sunpath/js/sensors.js, plus watchLocation() for the altitude.

import { quatToCols, eulerToCols } from './projection.js';

/** Start the back camera in a <video> element. Resolves with the MediaStream. */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

/**
 * Stream orientation matrices to onMatrix(cols, source). Both Chrome APIs are started
 * together and the caller picks: AbsoluteOrientationSensor (fused rotation vector, the
 * same data native compass apps use) and the deviceorientationabsolute event.
 * Both are referenced to magnetic north.
 */
export function startOrientation(onMatrix, log = () => {}) {
  const stops = [];

  // Event API (no permission prompt on Android Chrome).
  const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  const handler = (e) => {
    if (e.alpha == null) return;
    if (evName === 'deviceorientation' && !e.absolute) return; // not compass-referenced
    const angle = (screen.orientation && screen.orientation.angle) || 0;
    onMatrix(eulerToCols(e.alpha, e.beta, e.gamma, angle), evName);
  };
  window.addEventListener(evName, handler);
  stops.push(() => window.removeEventListener(evName, handler));
  log(`Orientation: listening to ${evName}`);

  // Generic Sensor API.
  if ('AbsoluteOrientationSensor' in window) {
    const begin = () => {
      try {
        const sensor = new AbsoluteOrientationSensor({ frequency: 60, referenceFrame: 'screen' });
        sensor.addEventListener('reading', () => onMatrix(quatToCols(sensor.quaternion), 'AbsoluteOrientationSensor'));
        sensor.addEventListener('error', (e) => {
          log(`AbsoluteOrientationSensor error: ${e.error && e.error.name}: ${e.error && e.error.message}`);
        });
        sensor.start();
        stops.push(() => sensor.stop());
        log('Orientation: AbsoluteOrientationSensor started');
      } catch (err) {
        log(`AbsoluteOrientationSensor unavailable: ${err.name}: ${err.message}`);
      }
    };
    if (navigator.permissions) {
      Promise.all(['accelerometer', 'gyroscope', 'magnetometer'].map((name) =>
        navigator.permissions.query({ name }).then((r) => `${name}=${r.state}`, () => `${name}=?`)
      )).then((states) => { log(`Sensor permissions: ${states.join(', ')}`); begin(); });
    } else {
      begin();
    }
  } else {
    log('AbsoluteOrientationSensor not supported');
  }
  return () => stops.forEach((s) => s());
}

/** One-shot high-accuracy location. */
export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 600000 }
    );
  });
}

/** Continuous location with altitude (when the phone reports one). Returns a stop function. */
export function watchLocation(onFix, onError = () => {}) {
  if (!navigator.geolocation) { onError(new Error('Geolocation not supported')); return () => {}; }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({
      lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy,
      alt: p.coords.altitude, altAcc: p.coords.altitudeAccuracy,
    }),
    onError,
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Android app only: orientation from the native rotation vector sensor (OrientationPlugin.java),
 * gyro-stabilised and steady when pointing at the sky. Resolves with a stop function, or null
 * when not running in the app. onReading(cols, reading) gets the device→world matrix and the raw
 * reading ({ headingAcc, accuracy }); onLifecycle('pause' | 'resume') follows the app.
 */
export async function startNativeOrientation(onReading, onLifecycle, log = () => {}) {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.nativePromise) return null;
  const P = 'NativeOrientation';
  try {
    cap.nativeCallback(P, 'addListener', { eventName: 'reading' }, (r) => {
      if (r && r.w != null) onReading(quatToCols([r.x, r.y, r.z, r.w]), r);
    });
    for (const ev of ['pause', 'resume']) cap.nativeCallback(P, 'addListener', { eventName: ev }, () => onLifecycle(ev));
    const info = await cap.nativePromise(P, 'start', {});
    log(`Orientation: Android rotation vector (${info.sensor}, ${info.vendor})`);
    return () => cap.nativePromise(P, 'stop', {});
  } catch (err) {
    log(`Native orientation unavailable: ${err.message || err}`);
    return null;
  }
}
