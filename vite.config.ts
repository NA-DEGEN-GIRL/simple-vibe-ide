import { defineConfig } from 'vite';

const projectRoot = process.cwd();

export default defineConfig({
  root: projectRoot,
  clearScreen: false,
  server: {
    strictPort: true,
    host: '127.0.0.1',
    port: 15320,
    watch: {
      usePolling: true,
      ignored: ['**/src-tauri/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true
  }
});
