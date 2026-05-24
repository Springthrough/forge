import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const forgePort = process.env.FORGE_PORT ?? 2525;

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': `http://localhost:${forgePort}`,
      '/ws':  { target: `ws://localhost:${forgePort}`, ws: true, rewriteWsOrigin: true },
    },
  },
});
