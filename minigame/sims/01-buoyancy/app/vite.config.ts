import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file: works offline inside the Xiaohongshu sandbox
// and can be dropped onto any static host for classroom use.
// the stamp reads in Vancouver time wherever the package is built, so it matches the phone's clock
function buildStamp() {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) p[x.type] = x.value;
  return `${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000 },
});
