import { defineConfig } from 'vite';

const projectRoot = process.cwd();
const enableSourceMaps = process.env.SVIDE_SOURCEMAP === '1';
const buildId = process.env.SVIDE_BUILD_ID ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const ignoredWatchPaths = [
  '**/src-tauri/**',
  '**/.antigravitycli/**',
  '**/.claude/**',
  '**/.codex/**',
  '**/.handoff/**',
  '**/.vibe-ide-temp/**',
  '**/dist/**',
  '**/dist-terminal/**',
  '**/target/**'
];

export default defineConfig({
  root: projectRoot,
  clearScreen: false,
  define: {
    __SVIDE_BUILD_ID__: JSON.stringify(buildId)
  },
  server: {
    strictPort: true,
    host: '127.0.0.1',
    port: 15320,
    watch: {
      usePolling: true,
      ignored: ignoredWatchPaths
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: enableSourceMaps,
    reportCompressedSize: false,
    modulePreload: {
      polyfill: false
    }
  }
});
