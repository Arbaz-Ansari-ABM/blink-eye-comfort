package com.blink.eyecare;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BlinkTimerActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (BlinkTimerService.ACTION_STOP.equals(intent.getAction())) {
            context.stopService(new Intent(context, BlinkTimerService.class));
            return;
        }
        Intent service = new Intent(context, BlinkTimerService.class);
        service.setAction(intent.getAction());
        context.startForegroundService(service);
    }
}
