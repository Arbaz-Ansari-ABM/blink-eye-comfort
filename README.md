# Blink 👁️✨
 
**Your minimalist companion for healthier screen time.**
 
Built for developers, designers, and anyone glued to a display, Blink automates the science-backed 20-20-20 rule to prevent digital eye strain, fatigue, and dry eyes.
 
---
 
## ✨ Features
 
- **Automated 20-20-20 Cycle** — Runs seamlessly in the background, tracking 20 minutes of focus followed by a gentle 20-second break to look 20 feet away.
- **Interactive Rest UI** — Immersive, distraction-free overlays designed to help you actually relax your eyes.
- **Instant Preview** — Test and inspect the rest-state UI on demand, without waiting for the timer to run out.
- **Session Tracking** — Keep tabs on your completed eye-care cycles throughout the workday.
- **Browser-First** — Runs entirely in your browser with zero server dependencies or data tracking.
- **Resilient timer** — Timer state, timestamps, completed breaks, and daily history survive refreshes, browser restarts, and short background periods.
- **Working hours** — Configure working days, working hours, overnight-safe quiet hours, and automatic pause/resume from the Working hours panel.
- **Weekly dashboard** — Review Monday-to-Sunday break consistency with locally persisted activity.
- **Wake lock and device alerts** — Rest mode requests Screen Wake Lock where supported and uses sound, vibration, and accessible visual controls with graceful fallbacks.
---
 
## 🚀 Getting Started
 
### Install dependencies
 
```bash
npm install
```
 
### Start the development server

```bash
npm run dev
```

`pwd` only prints the current project directory; it does not start the app. Open
the `http://localhost:5173/` URL printed by Vite in Chrome. Do not open
`index.html` directly with a `file://` URL, because Chrome blocks the module
entry point and the app cannot load correctly without an HTTP development
server.
 
---
 
## 🌐 Demo — (https://eyescomfortz.netlify.app/)

## 📲 Install as a PWA

The production build includes a web app manifest, install icons, and a service
worker. Open the deployed HTTPS site in a supported browser and use its
“Install app” or “Add to Home Screen” option. The app shell remains available
offline after the first successful load; audio still requires a user gesture
when the browser blocks autoplay.

The install prompt is shown by supported Chromium browsers after the app meets their installability
criteria. On iOS Safari, use **Share → Add to Home Screen**. Screen Wake Lock, vibration, notifications,
and background execution are browser/device capabilities and should be tested on the target device.

## Android packaging

The project now includes a Capacitor Android wrapper with a native foreground timer service. In the
installed Android app, starting Blink requests notification permission and keeps a persistent
notification with **Pause/Resume** and **Stop** controls while the screen is off. The native service
uses the same timestamp-based phases and the web UI synchronizes with native actions when it returns
to the foreground.

Build the Android debug APK:

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Open the `android/` project
in Android Studio for signing and release builds. Android 13+ notification permission must be accepted,
and battery optimization restrictions may still vary by device manufacturer.

The foreground service and notification controls require real-device testing; the Gradle build and
screen-off behavior must be verified on the target Android version before distributing a release APK.

If Gradle reports `SDK location not found`, install Android Studio and the Android SDK, then set
`ANDROID_HOME=$HOME/Library/Android/sdk` (or configure the SDK path in Android Studio). The project
intentionally does not commit `android/local.properties` because that path is machine-specific.
