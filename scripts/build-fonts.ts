/**
 * Bundled stroke fonts (M1-09, DEC-044). Converts the public-domain Hershey data in
 * assets/fonts/hershey/hershey.jhf into one Triya stroke-font JSON file per font in the
 * catalog (packages/text/src/hershey/catalog.ts), written to assets/fonts/<name>.json.
 *
 *   pnpm fonts:build           regenerate the files
 *
 * `packages/testkit/src/fonts/bundled.test.ts` fails when the committed files differ from
 * what this produces. Runs under Node's TypeScript type stripping; no build step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HERSHEY_FONTS } from '../packages/text/src/hershey/catalog.ts';
import {
  buildStrokeFont,
  formatStrokeFont,
  parseHershey,
} from '../packages/text/src/hershey/convert.ts';

const fontsDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const hershey = parseHershey(readFileSync(`${fontsDir}hershey/hershey.jhf`, 'latin1'));
for (const def of HERSHEY_FONTS) {
  const font = buildStrokeFont(def, hershey);
  writeFileSync(`${fontsDir}${def.name}.json`, formatStrokeFont(font));
  console.log(`${def.name}: ${Object.keys(font.glyphs).length} glyphs, below ${font.below}`);
}
