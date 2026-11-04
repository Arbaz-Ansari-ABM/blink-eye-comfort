package com.blink.eyecare;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.util.Locale;

public class BlinkTimerService extends Service {
    static final String CHANNEL_ID = "blink_timer";
    static final int NOTIFICATION_ID = 2020;
    static final String ACTION_PAUSE = "com.blink.eyecare.PAUSE";
    static final String ACTION_RESUME = "com.blink.eyecare.RESUME";
    static final String ACTION_STOP = "com.blink.eyecare.STOP";
    static final String ACTION_OPEN = "com.blink.eyecare.OPEN";
    private final Handler handler = new Handler();
    private android.content.SharedPreferences prefs;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            long endsAt = prefs.getLong("endsAt", 0L);
            String phase = prefs.getString("phase", "stopped");
            if (!"focus".equals(phase) && !"rest".equals(phase)) {
                updateNotification();
                return;
            }
            long left = Math.max(0L, (endsAt - System.currentTimeMillis() + 999L) / 1000L);
            prefs.edit().putInt("secondsLeft", (int) left).apply();
            if (left == 0L) {
                if ("focus".equals(phase)) {
                    long nextEnd = System.currentTimeMillis() + 20_000L;
                    prefs.edit().putString("phase", "rest").putLong("endsAt", nextEnd).putInt("secondsLeft", 20).apply();
                } else {
                    long nextEnd = System.currentTimeMillis() + 1_200_000L;
                    prefs.edit().putString("phase", "focus").putLong("endsAt", nextEnd).putInt("secondsLeft", 1200).apply();
                }
            }
            updateNotification();
            handler.postDelayed(this, 1000L);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("blink_timer", MODE_PRIVATE);
        createChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            handleAction(intent.getAction());
            if (ACTION_STOP.equals(intent.getAction())) return START_NOT_STICKY;
        }
        if (intent != null && intent.hasExtra("phase")) {
            prefs.edit()
                .putString("phase", intent.getStringExtra("phase"))
                .putLong("endsAt", intent.getLongExtra("endsAt", 0L))
                .putInt("secondsLeft", intent.getIntExtra("secondsLeft", 0))
                .putInt("completed", intent.getIntExtra("completed", 0))
                .apply();
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        handler.removeCallbacks(ticker);
        handler.post(ticker);
        return START_STICKY;
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(ticker);
        super.onDestroy();
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Blink timer", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Persistent timer controls");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private PendingIntent action(String action) {
        if (ACTION_OPEN.equals(action)) {
            Intent intent = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            return PendingIntent.getActivity(this, action.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        Intent intent = new Intent(this, BlinkTimerActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(this, action.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        String phase = prefs.getString("phase", "stopped");
        int seconds = prefs.getInt("secondsLeft", 0);
        String title = "rest".equals(phase) ? "Time to rest your eyes" : "Blink is keeping your rhythm";
        String time = String.format(Locale.US, "%02d:%02d remaining", seconds / 60, seconds % 60);
        boolean paused = "paused".equals(phase) || "stopped".equals(phase);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(com.blink.eyecare.R.mipmap.ic_launcher)
            .setContentTitle(title).setContentText(time)
            .setContentIntent(action(ACTION_OPEN))
            .setOngoing(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(new NotificationCompat.Action(0, paused ? "Resume" : "Pause", action(paused ? ACTION_RESUME : ACTION_PAUSE)))
            .addAction(new NotificationCompat.Action(0, "Stop", action(ACTION_STOP)));
        return builder.build();
    }

    private void updateNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, buildNotification());
    }

    public void handleAction(String action) {
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return;
        }
        if (ACTION_PAUSE.equals(action)) {
            long remaining = Math.max(1L, (prefs.getLong("endsAt", 0L) - System.currentTimeMillis() + 999L) / 1000L);
            prefs.edit().putString("pausedFrom", prefs.getString("phase", "focus")).putString("phase", "paused").putInt("secondsLeft", (int) remaining).remove("endsAt").apply();
        } else if (ACTION_RESUME.equals(action)) {
            long end = System.currentTimeMillis() + prefs.getInt("secondsLeft", 1200) * 1000L;
            prefs.edit().putString("phase", prefs.getString("pausedFrom", "focus")).putLong("endsAt", end).apply();
        }
        updateNotification();
    }
}
