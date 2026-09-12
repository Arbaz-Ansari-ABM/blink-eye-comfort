# Blink — 20-20-20 eye rest companion

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in your terminal. Create a production bundle with `npm run build`.

## Deploy to Netlify

This project includes `netlify.toml`. Connect the repository in Netlify; it will use `npm run build` and publish the `dist` directory automatically.

Blink runs entirely in the browser. **Start session** begins the 20-minute focus timer, transitions to a 20-second look-away timer, then records the completed cycle. **Preview a rest state** lets you inspect the rest UI without waiting.
