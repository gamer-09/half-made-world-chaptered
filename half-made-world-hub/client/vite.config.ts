import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: 'https://gamer-09.github.io/half-made-world-chaptered/',
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
});
