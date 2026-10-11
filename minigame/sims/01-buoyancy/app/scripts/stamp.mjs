// The small stamp in the page's bottom-right corner: package version and build time on Chris's
// clock, so a phone screenshot shows which upload is running. The version matches the 版本号
// typed into the platform.
import { readFileSync } from 'node:fs';

export function buildStamp() {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return `v${version} · ${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}
