import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5175
  }
});
