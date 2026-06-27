import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The frontend is a pure client of the BFF. In dev, proxy the API + media to the standalone
// BFF (default http://localhost:3000) so the SPA stays same-origin (cookies + SSE just work).
const BFF = process.env.BFF_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': BFF,
      '/media': BFF,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
