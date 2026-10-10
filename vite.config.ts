import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// package.json 是版本号的唯一来源；发布流程（release-please）只改这里
const pkg = require('./package.json') as { name?: string; version?: string };
const appVersion = pkg.version ?? '0.0.0';
const commit = process.env.GIT_COMMIT || process.env.GITHUB_SHA || '';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/'),
      '@shared': path.resolve(__dirname, './shared/'),
    },
  },
  define: {
    // 供 src/hooks/useVersion.ts 作为构建期兜底；权威值仍来自 GET /api/version
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  server: {
    port: 8080,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
