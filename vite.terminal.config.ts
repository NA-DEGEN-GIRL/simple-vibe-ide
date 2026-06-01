import { defineConfig } from 'vite';

const projectRoot = process.cwd();
const enableSourceMaps = process.env.SVIDE_SOURCEMAP === '1';

export default defineConfig({
  root: projectRoot,
  clearScreen: false,
  server: {
    strictPort: true,
    host: '127.0.0.1',
    port: 15321,
    watch: {
      usePolling: true,
      ignored: ['**/src-tauri/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: 'dist-terminal',
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: enableSourceMaps,
    reportCompressedSize: false,
    modulePreload: {
      polyfill: false
    },
    rollupOptions: {
      input: {
        terminal: 'terminal.html'
      }
    }
  }
});
