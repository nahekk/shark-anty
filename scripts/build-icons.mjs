// Renders assets/logo.svg into every icon the app, installer, extension and Discord need.
// Usage: npm run icons
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, 'assets', 'logo.svg'));

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

async function out(rel, buf) {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log('  wrote', rel);
}

console.log('Building icons…');

// App / installer
await out('build/icon.png', await png(1024));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
await out('build/icon.ico', await pngToIco(await Promise.all(icoSizes.map(png))));
await out('src/renderer/assets/logo.png', await png(256));
await out('src/renderer/assets/tray.png', await png(32));

// Discord Rich Presence art assets (upload these in the Developer Portal)
await out('assets/discord/logo.png', await png(1024));
await out('assets/discord/small_logo.png', await png(512));

// In-browser extension
for (const s of [16, 32, 48, 128]) await out(`extension/shark-cookies/icons/icon${s}.png`, await png(s));

// NSIS installer sidebar (164x314, 24-bit BMP)
const W = 164, H = 314;
const logoSmall = await png(120);
const sidebarRaw = await sharp({
  create: { width: W, height: H, channels: 3, background: '#0A1A3A' },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#0A1A3A"/><stop offset="1" stop-color="#0B4D7A"/>
          </linearGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#g)"/>
          <text x="${W / 2}" y="210" font-family="Segoe UI, Arial" font-size="22" font-weight="700"
                fill="#FFFFFF" text-anchor="middle">Shark{anty}</text>
          <text x="${W / 2}" y="236" font-family="Segoe UI, Arial" font-size="11"
                fill="#7DD3FC" text-anchor="middle">free · open-source</text>
        </svg>`,
      ),
      top: 0,
      left: 0,
    },
    { input: logoSmall, top: 50, left: (W - 120) / 2 },
  ])
  .removeAlpha()
  .raw()
  .toBuffer();
await out('build/installerSidebar.bmp', toBmp24(sidebarRaw, W, H));

console.log('Done.');

function toBmp24(rgb, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3;
      b[dst + x * 3] = rgb[s + 2];
      b[dst + x * 3 + 1] = rgb[s + 1];
      b[dst + x * 3 + 2] = rgb[s];
    }
  }
  return b;
}
