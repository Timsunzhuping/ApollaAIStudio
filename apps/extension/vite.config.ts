import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// MV3 build: the side panel (panel.html) + a module service worker (background.js). The selection
// capture runs via chrome.scripting (no static content script → least privilege). Stable entry
// names so manifest.json can reference background.js. manifest.json is copied from public/.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { background: 'src/background.ts', panel: 'panel.html' },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash].[ext]' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
