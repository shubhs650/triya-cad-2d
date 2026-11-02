/**
 * Bundled stroke fonts (M1-09, DEC-044). Converts the public-domain Hershey data in
 * assets/fonts/hershey/hershey.jhf into one Triya stroke-font JSON file per font in the
 * catalog (packages/text/src/hershey/catalog.ts), written to assets/fonts/<name>.json, and
 * the GD&T font `oet-gdt` (M1-54: `oet-simplex` with our symbols on the lower-case letters).
 *
 *   pnpm fonts:build           regenerate the files
 *
 * `packages/testkit/src/fonts/bundled.test.ts` fails when the committed files differ from
 * what this produces. Runs under Node's TypeScript type stripping; no build step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HERSHEY_FONTS } from '../packages/text/src/hershey/catalog.ts';
import { buildGdtFont } from '../packages/text/src/hershey/gdt.ts';
import {
  buildStrokeFont,
  formatStrokeFont,
  parseHershey,
} from '../packages/text/src/hershey/convert.ts';

const fontsDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const hershey = parseHershey(readFileSync(`${fontsDir}hershey/hershey.jhf`, 'latin1'));
const fonts = HERSHEY_FONTS.map((def) => buildStrokeFont(def, hershey));
fonts.push(buildGdtFont(fonts.find((f) => f.name === 'oet-simplex')!));
for (const font of fonts) {
  writeFileSync(`${fontsDir}${font.name}.json`, formatStrokeFont(font));
  console.log(`${font.name}: ${Object.keys(font.glyphs).length} glyphs, below ${font.below}`);
}
