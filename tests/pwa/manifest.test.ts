// M2-19 (PRD FR-F10, §13 item 5): the web app manifest makes the app installable and the
// `.dwg`/`.dxf` file handler, and its icons exist at the sizes it states. Chromium's own
// installability check runs on the built app in tests/e2e/offline/pwa.spec.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = path.join(import.meta.dirname, '../../apps/web/public');
const manifest = JSON.parse(readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
  file_handlers: { action: string; accept: Record<string, string[]> }[];
};

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): string {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

describe('web app manifest', () => {
  it('describes an installable standalone app scoped to the whole origin', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Triya CAD 2D',
      short_name: 'Triya CAD',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
  });

  it('has 192 and 512 px PNG icons, a maskable one, and an SVG, each as stated', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    expect(png.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const i of png) expect(pngSize(path.join(PUBLIC, i.src))).toBe(i.sizes);
    const svg = manifest.icons.find((i) => i.type === 'image/svg+xml')!;
    expect(readFileSync(path.join(PUBLIC, svg.src), 'utf8')).toMatch(/^<svg /);
    expect(pngSize(path.join(PUBLIC, 'icons/apple-touch-icon.png'))).toBe('180x180');
  });

  it('opens .dwg and .dxf files launched from the system in the app', () => {
    const accepted = manifest.file_handlers.flatMap((h) => Object.values(h.accept).flat());
    expect(accepted.sort()).toEqual(['.dwg', '.dxf']);
    expect(manifest.file_handlers.every((h) => h.action === '/')).toBe(true);
  });
});
