import { defineConfig } from 'vite';
import { statSync } from 'node:fs';

// The APK size shown on the page is read from the real file, never typed by hand.
function apkSizeBytes() {
  for (const file of ['public/Blink.apk', 'Blink.apk']) {
    try { return statSync(file).size; } catch { /* try next */ }
  }
  console.warn('[blink] Blink.apk not found, the file size will be hidden on the download section.');
  return 0;
}

export default defineConfig({
  define: { __APK_SIZE_BYTES__: JSON.stringify(apkSizeBytes()) },
});
