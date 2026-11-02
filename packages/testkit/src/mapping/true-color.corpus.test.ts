// M1-55: the ACI that AutoCAD writes for a true colour. A DXF object with a true colour (420)
// keeps an ACI right before it (62), the number R2000 files and DIMSTYLE groups 176–178 hold
// when only an ACI fits. Every such pair in the public corpus's ASCII DXFs must equal
// `aciOfTrueColor`, which Triya uses wherever it turns a true colour into an ACI number, and
// acad-ts's `Color.approxIndex`, which its writers use for the same (patch 0109, M1-43).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Color } from '@node-projects/acad-ts';
import { aciOfTrueColor } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

describe('true colour → ACI', () => {
  it('equals the ACI AutoCAD wrote beside every true colour in the corpus', () => {
    const problems = new Set<string>();
    const distinct = new Set<number>();
    let pairs = 0;
    for (const f of manifest.files) {
      if (f.format !== 'dxf-ascii') continue;
      const lines = readFileSync(`${corpusDir}${f.path}`, 'latin1').split(/\r?\n/);
      let type = '';
      for (let i = 0; i + 3 < lines.length; i += 2) {
        if (lines[i]!.trim() === '0') type = lines[i + 1]!.trim();
        // Group 62 straight followed by its 420 (VISUALSTYLE, LAYER, entities, …).
        if (lines[i]!.trim() !== '62' || lines[i + 2]!.trim() !== '420') continue;
        const aci = Math.abs(Number(lines[i + 1]));
        const rgb = Number(lines[i + 3]);
        const [r, g, b] = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
        pairs++;
        distinct.add(rgb);
        const got = aciOfTrueColor(r, g, b);
        if (got !== aci) problems.add(`${f.path} ${type} ${r},${g},${b}: ${aci} ≠ ${got}`);
        const acad = Color.approxIndex(r, g, b);
        if (acad !== aci)
          problems.add(`acad-ts ${f.path} ${type} ${r},${g},${b}: ${aci} ≠ ${acad}`);
      }
    }
    expect([...problems]).toEqual([]);
    expect(pairs).toBeGreaterThan(3000);
    expect(distinct.size).toBeGreaterThanOrEqual(21);
  }, 120_000);
});
