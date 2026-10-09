import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Transpile for older Android Chrome / WebView versions.
  build: { target: ['es2017', 'chrome61'] },
});
