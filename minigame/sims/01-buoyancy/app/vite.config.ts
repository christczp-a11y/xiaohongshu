import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildStamp } from './scripts/stamp.mjs';

// One self-contained HTML file: works offline inside the Xiaohongshu sandbox
// and can be dropped onto any static host for classroom use.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000 },
});
