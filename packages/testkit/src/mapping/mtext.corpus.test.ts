// M1-11 on the public corpus: every string that carries MTEXT format codes (MTEXT contents,
// multiline attributes, MULTILEADER text, dimension text overrides, table cells) parses and
// lays out, and no formatting code is left over as visible text. The render comparison
// against reference plots comes with the fidelity harness (M1-24) and the renderer (M1-12).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntityInit } from '@triya/engine';
import { mapEntities, readCadDocument } from '@triya/io';
import {
  layoutMText,
  parseMText,
  type MTextBase,
  type MTextLayoutOptions,
  type MTextMeasure,
} from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

const base: MTextBase = {
  font: { name: 'txt', kind: 'shx', bold: false, italic: false },
  height: 1,
  widthFactor: 1,
  oblique: 0,
};
// Fixed-pitch stand-in: this test checks codes and structure, not glyph widths.
const mono: MTextMeasure = {
  advance: (text, style) => [...text].length * style.height * style.widthFactor,
};

interface Sample {
  readonly where: string;
  readonly contents: string;
  readonly options: MTextLayoutOptions;
}

const plain = (height: number): MTextLayoutOptions => ({
  height,
  width: 0,
  attachment: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

/** Every MTEXT-coded string an entity carries, with the box it is laid out in. */
function samples(e: EntityInit, where: string): Sample[] {
  const g = e.geom;
  switch (g.kind) {
    case 'MTEXT':
      return [
        {
          where,
          contents: g.contents,
          options: {
            height: g.height,
            width: g.width,
            attachment: g.attachment,
            lineSpacingStyle: g.lineSpacingStyle,
            lineSpacing: g.lineSpacing,
            ...(g.columns && g.columns.count > 0
              ? {
                  columns: {
                    type: g.columns.type === 1 ? 'static' : 'dynamic',
                    count: g.columns.count,
                    width: g.columns.width,
                    gutter: g.columns.gutter,
                    heights: g.columns.heights,
                    flowReversed: g.columns.flowReversed,
                    ...(g.definedHeight === undefined ? {} : { height: g.definedHeight }),
                  },
                }
              : {}),
            ...(g.background ? { background: { scale: g.background.scale } } : {}),
          },
        },
      ];
    case 'MULTILEADER':
      return g.text ? [{ where, contents: g.text.content, options: plain(1) }] : [];
    case 'DIMENSION':
      return g.text ? [{ where, contents: g.text, options: plain(1) }] : [];
    case 'ACAD_TABLE':
      return g.cells.flatMap((row, r) =>
        row.flatMap((cell, c) =>
          cell.text
            ? [{ where: `${where} cell ${r},${c}`, contents: cell.text, options: plain(1) }]
            : [],
        ),
      );
    case 'INSERT':
      return (g.attributes ?? []).flatMap((a) =>
        a.mtext
          ? [{ where: `${where} ATTRIB`, contents: a.mtext.contents, options: plain(1) }]
          : [],
      );
    case 'ATTDEF':
      return g.mtext ? [{ where, contents: g.mtext.contents, options: plain(1) }] : [];
    default:
      return [];
  }
}

/** Visible text that still looks like a formatting code, known or not: a backslash and a letter. */
const LEFTOVER = /\\[A-Za-z~]/;

describe('MTEXT formatting engine on the public corpus (M1-11)', () => {
  const readable = readableFiles(manifest);

  it('parses and lays out every MTEXT-coded string with no code left as text', () => {
    const leftovers: string[] = [];
    const broken: string[] = [];
    let count = 0;
    let coded = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      for (const e of mapEntities(doc).entities) {
        for (const s of samples(e, `${f.path} ${e.geom.kind} ${e.handle}`)) {
          count++;
          if (/[\\{}^]|%%|%</.test(s.contents)) coded++;
          const parsed = parseMText(s.contents, { ...base, height: s.options.height || 1 });
          const layout = layoutMText(parsed, mono, { ...s.options, height: s.options.height || 1 });
          const b = layout.bounds;
          if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) {
            broken.push(`${s.where}: bounds ${JSON.stringify(b)}`);
          }
          for (const p of parsed.paragraphs)
            for (const i of p.items) {
              const t = i.type === 'stack' ? `${i.upper}${i.lower}` : 'text' in i ? i.text : '';
              // An escaped backslash (\\) before a letter is legitimately visible.
              const escaped = s.contents.includes(`\\\\${t.match(LEFTOVER)?.[0]?.slice(1) ?? ''}`);
              if (LEFTOVER.test(t) && !escaped) leftovers.push(`${s.where}: ${JSON.stringify(t)}`);
            }
        }
      }
    }
    console.log(`MTEXT corpus: ${count} strings, ${coded} with format codes`);
    expect(count).toBeGreaterThan(0);
    expect(broken).toEqual([]);
    expect(leftovers).toEqual([]);
  });
});
