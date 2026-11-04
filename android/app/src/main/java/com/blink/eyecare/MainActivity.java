package com.blink.eyecare;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle state) {
        registerPlugin(BlinkTimerPlugin.class);
        super.onCreate(state);
    }
}
