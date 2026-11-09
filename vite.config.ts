import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/Dermatology-/").
// Locally it defaults to "/".
const base = process.env.BASE_PATH || '/';

// Shown in Settings so you can tell which version is installed, e.g. "2026-11-09 04:40 · 595d514".
function gitShort() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const APP_VERSION = `${stamp} UTC · ${gitShort()}`;

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Derm Path',
        short_name: 'Derm Path',
        description: 'Personal dermatology training: study, interest group log and research protocols.',
        theme_color: '#277a75',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // cache the app shell (incl. the lazily-loaded AI chunk) so it works offline
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
