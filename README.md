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
