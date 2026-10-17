package ch.dxan.flightspot;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Phone orientation from Android's rotation vector sensor: gyroscope, accelerometer and
 * magnetometer fused by the system, the same source compass apps use. The WebView's
 * deviceorientation angles become unstable when the phone points up at the sky, so the
 * app uses this instead.
 *
 * Events:
 *   "reading"  { x, y, z, w (device→world quaternion, east/north/up), headingAcc (deg, -1 = unknown),
 *                accuracy (0 unreliable … 3 high) }
 *   "pause", "resume"  when the app goes to the background and comes back
 */
@CapacitorPlugin(name = "NativeOrientation")
public class OrientationPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensors;
    private Sensor rotation;
    private boolean running = false;
    private int accuracy = -1;
    private final float[] q = new float[4];

    @Override
    public void load() {
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        rotation = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (rotation == null) {
            call.reject("This phone has no rotation vector sensor");
            return;
        }
        running = true;
        sensors.registerListener(this, rotation, SensorManager.SENSOR_DELAY_GAME);
        JSObject info = new JSObject();
        info.put("sensor", rotation.getName());
        info.put("vendor", rotation.getVendor());
        call.resolve(info);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        running = false;
        sensors.unregisterListener(this);
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        if (running) sensors.unregisterListener(this);
        notifyListeners("pause", new JSObject());
    }

    @Override
    protected void handleOnResume() {
        if (running) sensors.registerListener(this, rotation, SensorManager.SENSOR_DELAY_GAME);
        notifyListeners("resume", new JSObject());
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        SensorManager.getQuaternionFromVector(q, event.values); // w, x, y, z
        JSObject r = new JSObject();
        r.put("x", q[1]);
        r.put("y", q[2]);
        r.put("z", q[3]);
        r.put("w", q[0]);
        // values[4]: estimated heading accuracy in radians, when the phone provides it.
        r.put("headingAcc", event.values.length > 4 && event.values[4] >= 0 ? Math.toDegrees(event.values[4]) : -1);
        r.put("accuracy", accuracy);
        notifyListeners("reading", r);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int value) {
        accuracy = value;
    }
}
