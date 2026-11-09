// Renders the app's PNG icons (M2-19) from the SVGs in apps/web/public/icons, for the web app
// manifest (installability wants 192 and 512 px PNGs) and the apple-touch-icon. Run after
// changing an SVG and commit the PNGs: `node --experimental-strip-types scripts/build-icons.ts`.
// Set TRIYA_CHROMIUM to a Chromium binary when Playwright's own browser is not installed.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ICONS = path.join(import.meta.dirname, '../apps/web/public/icons');

const OUTPUTS = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch(
  process.env['TRIYA_CHROMIUM'] ? { executablePath: process.env['TRIYA_CHROMIUM'] } : {},
);
try {
  for (const o of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    const svg = readFileSync(path.join(ICONS, o.svg), 'utf8');
    const style = '<style>html,body{margin:0;background:transparent}svg{display:block}</style>';
    await page.setContent(
      `${style}${svg.replace('<svg ', `<svg width="${o.size}" height="${o.size}" `)}`,
    );
    await page.screenshot({ path: path.join(ICONS, o.png), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
