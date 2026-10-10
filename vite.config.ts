import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from cloudcody.cc/DCTtraining/ (FastAPI StaticFiles in chorebot/backend/public).
// Override with DCT_BASE=/ for local preview at the root.
export default defineConfig({
  base: process.env.DCT_BASE ?? '/DCTtraining/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three';
          if (id.includes('@xterm')) return 'xterm';
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
