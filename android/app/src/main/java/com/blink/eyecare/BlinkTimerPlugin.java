package com.blink.eyecare;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import android.Manifest;
import android.os.Build;

@CapacitorPlugin(name = "BlinkTimer")
public class BlinkTimerPlugin extends Plugin {
    private static final String SERVICE = "com.blink.eyecare.BlinkTimerService";

    @PluginMethod
    public void sync(PluginCall call) {
        Intent intent = new Intent(getContext(), BlinkTimerService.class);
        intent.putExtra("phase", call.getString("phase", "stopped"));
        intent.putExtra("endsAt", call.getLong("endsAt", 0L));
        intent.putExtra("secondsLeft", call.getInt("secondsLeft", 0));
        intent.putExtra("completed", call.getInt("completed", 0));
        getContext().startForegroundService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("phase", getContext().getSharedPreferences("blink_timer", 0).getString("phase", "stopped"));
        result.put("secondsLeft", getContext().getSharedPreferences("blink_timer", 0).getInt("secondsLeft", 0));
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), BlinkTimerService.class));
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            getActivity().requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2021);
        }
        call.resolve();
    }
}
