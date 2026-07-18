import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Torrevieja Tycoon',
        short_name: 'Torrevieja Tycoon',
        description: 'A browser-based transport-management game.',
        theme_color: '#0b2533',
        background_color: '#f3eee4',
        display: 'standalone',
        start_url: '/',
      },
    }),
  ],
});
