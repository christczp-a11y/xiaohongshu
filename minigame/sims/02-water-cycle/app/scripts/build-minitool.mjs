// Build the Xiaohongshu 小工具 package: index.html + classic main.js (ES2017 / Chrome 61) +
// style.css + fallback.webp in dist-minitool/, zipped with index.html at the root.
// The container forbids inline and module scripts, so this cannot reuse the single-file web build.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';

const OUT = 'dist-minitool';
const ZIP = 'water-cycle-minitool.zip';
const TARGET = ['es2017', 'chrome61'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: TARGET,
  minify: true, legalComments: 'eof', outfile: `${OUT}/main.js`, logLevel: 'warning',
});
await build({
  entryPoints: ['src/style.css'], bundle: true, minify: true, target: ['chrome61'],
  loader: { '.woff2': 'file' }, assetNames: '[name]', outfile: `${OUT}/style.css`, logLevel: 'warning',
});

let html = readFileSync('index.html', 'utf8');
const swaps = [
  ['<link rel="stylesheet" href="./src/style.css" />', '<link rel="stylesheet" href="./style.css" />'],
  ['<script type="module" src="./src/main.ts"></script>', '<script src="./main.js"></script>'],
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error(`index.html: expected ${from}`);
  html = html.replace(from, to);
}
writeFileSync(`${OUT}/index.html`, html);
copyFileSync('fallback.webp', `${OUT}/fallback.webp`);

// minimal zip writer (deflate), files at the archive root
const files = readdirSync(OUT).filter((f) => statSync(`${OUT}/${f}`).isFile()).sort();
const local = [], central = [];
let offset = 0;
for (const name of files) {
  const data = readFileSync(`${OUT}/${name}`);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data) >>> 0;
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(8, 8); head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12);
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
  local.push(head, nameBuf, packed);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10); cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += head.length + nameBuf.length + packed.length;
}
const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
writeFileSync(ZIP, Buffer.concat([...local, cenBuf, end]));

for (const f of files) console.log(`${OUT}/${f}  ${statSync(`${OUT}/${f}`).size} bytes`);
console.log(`${ZIP}  ${statSync(ZIP).size} bytes`);
