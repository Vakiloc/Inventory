import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: path.join(__dirname, 'src', 'renderer'),
  base: './',
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: path.join(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'src', 'renderer', 'index.html'),
        setup: path.join(__dirname, 'src', 'renderer', 'setup.html')
      }
    }
  }
});
