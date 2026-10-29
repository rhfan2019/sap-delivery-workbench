import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  preview: { port: 4173, strictPort: true },
  // Crawl every page, lazy routes included, so the dev server bundles all dependencies at start
  // instead of re-bundling (and failing the page's import) the first time an assistant page opens.
  optimizeDeps: { entries: ['index.html', 'src/**/*.vue'] },
  // Tests start their own Vite servers on this root; with the dev server's cache they would
  // replace its bundled dependencies while it runs, and every page loaded later would fail.
  cacheDir: process.env.NODE_ENV === 'test' ? 'node_modules/.vite-test' : 'node_modules/.vite',
});
