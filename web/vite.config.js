import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forgePort = process.env.FORGE_PORT ?? 2525;

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, 'dist') },
  server: {
    proxy: {
      '/api': `http://localhost:${forgePort}`,
      '/ws':  { target: `ws://localhost:${forgePort}`, ws: true, rewriteWsOrigin: true },
    },
  },
});
