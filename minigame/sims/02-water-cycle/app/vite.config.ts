import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file: works offline inside the Xiaohongshu sandbox
// and can be dropped onto any static host for classroom use.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(((d) => `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)(new Date())) },
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000 },
});
