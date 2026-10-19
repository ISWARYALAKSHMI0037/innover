import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies /api to the Express server, so no CORS setup or secrets are needed in the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:5000', changeOrigin: true } },
  },
});
