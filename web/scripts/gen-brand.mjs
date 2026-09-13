#!/usr/bin/env node
// Rasterise the AutoHire mark into every icon the platforms want.
//
// The geometry is `src/components/BrandMark.tsx`'s, restated here because a
// build-time script cannot import a React component: a fastback in profile
// over two road dashes. Change the glyph there and here together.
//
//   node scripts/gen-brand.mjs            # writes into public/ and public-admin/
//
// Needs `@resvg/resvg-js` resolvable — `npm i -D @resvg/resvg-js` in web/, or
// point NODE_PATH at a directory that has it. It is not a runtime dependency
// and must not become one; the PNGs it writes are committed.
//
// What it writes, and why each exists:
//   favicon.svg                 the tab icon — a vector, so it is crisp at any size
//   icons/icon-{192,512}.png    manifest `any` icons: Android home screen, install dialog
//   icons/icon-maskable-*.png   manifest `maskable`: the glyph inside the 80% safe
//                               circle so an OEM mask (circle, squircle) never clips it
//   icons/apple-touch-icon.png  iOS ignores the manifest; 180px is what it reads
//   icons/splash-*.png          iOS launch screens, one per device viewport — iOS
//                               reads none of the manifest for this either, and a
//                               PWA without them opens on a blank white sheet.
//                               Android draws its own from the manifest's icon and
//                               `background_color`, so these match that: white,
//                               the tile centred.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

const BRAND = '#0e7c66';
const INK_DARK = '#0d1211';

/** The glyph, in its own 64-unit box, filled with `color`. */
function glyph(color) {
  return `
    <g fill="${color}" fill-rule="evenodd">
      <path d="M 6 35.5 L 6 30.5 Q 6 26.5 10.5 26 L 17 25 Q 24 15 33 14.5 Q 39 14.5 43.5 17.5 L 47 21.5 L 55 23.5 Q 58 24 58 27 L 58 35.5 Q 58 38 55.5 38 L 8.5 38 Q 6 38 6 35.5 Z M 21 25 Q 27 18.5 33.5 18 L 38 18 L 43.5 23 Z M 11.8 38 A 7.2 7.2 0 0 1 26.2 38 Z M 38.8 38 A 7.2 7.2 0 0 1 53.2 38 Z"/>
      <path d="M 13.8 38 a 5.2 5.2 0 1 0 10.4 0 a 5.2 5.2 0 1 0 -10.4 0 M 17.1 38 a 1.9 1.9 0 1 0 3.8 0 a 1.9 1.9 0 1 0 -3.8 0"/>
      <path d="M 40.8 38 a 5.2 5.2 0 1 0 10.4 0 a 5.2 5.2 0 1 0 -10.4 0 M 44.1 38 a 1.9 1.9 0 1 0 3.8 0 a 1.9 1.9 0 1 0 -3.8 0"/>
      <rect x="8" y="46" width="19" height="3.5" rx="1.75"/>
      <rect x="32" y="46" width="10" height="3.5" rx="1.75"/>
    </g>`;
}

/**
 * The tile: the glyph on a rounded brand square.
 *
 * `scale` is how much of the tile the glyph's box takes up. 1 is the `any`
 * icon — the car spans ~81% of its box wide and ~55% tall, which is the
 * proportion a home-screen icon wants. Maskable icons get 0.78, which keeps
 * the glyph's far corners inside the 40%-radius safe circle Android masks to.
 */
function tile(size, { scale = 1, radius = 0.22 } = {}) {
  const r = size * radius;
  const g = size * scale;
  const off = (size - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BRAND}"/>
  <g transform="translate(${off} ${off}) scale(${g / 64})">${glyph('#ffffff')}</g>
</svg>`;
}

/** A maskable icon is the tile with no corner radius — the OS supplies the shape. */
function maskable(size) {
  return tile(size, { scale: 0.78, radius: 0 });
}

/** An iOS launch screen: the tile centred on the app's light ground. */
function splash(w, h, scaleFactor) {
  // 88pt: larger than the 60pt home-screen icon the finger just left, so the
  // launch reads as the app opening rather than the icon sitting still, and
  // small enough that it is plainly a mark on a sheet and not a full-bleed
  // brand wall. Same tile, same radius — the transition into the header's
  // mark is a change of size and not of identity.
  const t = 88 * scaleFactor;
  const r = t * 0.22;
  const g = t;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <g transform="translate(${(w - t) / 2} ${(h - t) / 2})">
    <rect width="${t}" height="${t}" rx="${r}" fill="${BRAND}"/>
    <g transform="scale(${g / 64})">${glyph('#ffffff')}</g>
  </g>
</svg>`;
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

function write(rel, data) {
  const path = join(web, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${rel}`);
}

// --- Vector favicons -------------------------------------------------------
// One tile for both sites; the admin site is the same product, and a
// different mark on the tab would read as a different company.
const favicon = tile(64);
write('public/favicon.svg', favicon);
write('public-admin/favicon.svg', favicon);

// --- Manifest and iOS icons -----------------------------------------------
write('public/icons/icon-192.png', png(tile(192), 192));
write('public/icons/icon-512.png', png(tile(512), 512));
write('public/icons/icon-maskable-192.png', png(maskable(192), 192));
write('public/icons/icon-maskable-512.png', png(maskable(512), 512));
write('public/icons/apple-touch-icon.png', png(tile(180, { radius: 0 }), 180));

// --- iOS launch screens ---------------------------------------------------
// Portrait, CSS-pixel viewport × device-pixel ratio. iOS matches these on the
// `media` attribute of each <link rel="apple-touch-startup-image">, and it
// matches exactly — a size that is one point off is simply never shown. The
// list is the current iPhone line plus the sizes still common in Rwanda.
const DEVICES = [
  [440, 956, 3], // 16 Pro Max
  [402, 874, 3], // 16 Pro
  [430, 932, 3], // 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus
  [393, 852, 3], // 14 Pro / 15 / 15 Pro / 16
  [390, 844, 3], // 12 / 12 Pro / 13 / 13 Pro / 14
  [375, 812, 3], // X / XS / 11 Pro / 12 mini / 13 mini
  [414, 896, 3], // XS Max / 11 Pro Max
  [414, 896, 2], // XR / 11
  [414, 736, 3], // 6+ / 7+ / 8+
  [375, 667, 2], // 6 / 7 / 8 / SE 2 / SE 3
];
const links = [];
for (const [w, h, dpr] of DEVICES) {
  const name = `icons/splash-${w * dpr}x${h * dpr}.png`;
  write(`public/${name}`, png(splash(w * dpr, h * dpr, dpr), w * dpr));
  links.push(
    `    <link rel="apple-touch-startup-image" href="/${name}"\n` +
      `          media="(device-width: ${w}px) and (device-height: ${h}px) ` +
      `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`,
  );
}

console.log('\nPaste into index.html after the apple-touch-icon link:\n');
console.log(links.join('\n'));
