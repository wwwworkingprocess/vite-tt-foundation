import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const configuredBase = process.env.VITE_BASE_PATH ?? '/';
const base = `/${configuredBase.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

export default defineConfig({
  base,
  build: { chunkSizeWarningLimit: 1300, sourcemap: false },
  plugins: [
    react(),
    VitePWA({
      includeAssets: ['icons/*.png'],
      registerType: 'autoUpdate',
      manifest: {
        name: 'Torrevieja Tycoon',
        short_name: 'Torrevieja Tycoon',
        description: 'A browser-based transport-management game.',
        theme_color: '#0b2533',
        background_color: '#f3eee4',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: `${base}icons/foundation-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: `${base}icons/foundation-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
