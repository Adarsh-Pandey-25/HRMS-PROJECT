// Generates favicons, the apple-touch icon and the Open Graph image from the
// SpaxSync logo mark. Run manually after changing the logo, then commit the
// output in public/ — it is not part of `npm run build` so that fonts and
// rendering never differ between machines:
//
//   npm run brand:assets
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markPath = path.join(root, 'src/assets/brand/spaxsync-mark.svg');
const publicDir = path.join(root, 'public');

const mark = await readFile(markPath);
await mkdir(publicDir, { recursive: true });

await writeFile(path.join(publicDir, 'favicon.svg'), mark);

const png = (size) => sharp(mark, { density: 512 }).resize(size, size).png();
await png(32).toFile(path.join(publicDir, 'favicon-32.png'));
await png(180).toFile(path.join(publicDir, 'apple-touch-icon.png'));
await png(512).toFile(path.join(publicDir, 'spaxsync-icon-512.png'));

// Open Graph card (1200×630): ink background, mark, wordmark, tagline.
const markInner = mark.toString()
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '');
const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="85%" cy="15%" r="70%">
      <stop offset="0" stop-color="#0F766E" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0B1220" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0B1220"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(96 150) scale(2.5)">${markInner}</g>
  <text x="96" y="400" font-family="Inter, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="#F8FAFC" letter-spacing="-3">SpaxSync</text>
  <text x="96" y="470" font-family="Inter, Helvetica, Arial, sans-serif" font-size="36" font-weight="500" fill="#94A3B8">HR, attendance and payroll for growing Indian companies</text>
  <rect x="96" y="520" width="120" height="6" rx="3" fill="#2DD4BF"/>
</svg>`;
await sharp(Buffer.from(og)).png().toFile(path.join(publicDir, 'og-image.png'));

console.log('Brand assets written to public/');
