import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Express server runs on :5000 and Vite proxies API +
// WebSocket traffic to it, so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
