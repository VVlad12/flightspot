package ch.dxan.flightspot;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrientationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
