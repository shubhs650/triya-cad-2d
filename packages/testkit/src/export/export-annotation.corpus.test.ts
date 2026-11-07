// Annotative texts edited on every readable public corpus file that has one (M1-75 part 37):
// MOVE takes every annotation scale representation along with the text, and a grip edit then
// moves the text with its default (current) representation only. The reopened file maps the
// edits back, and nothing else changes: the text and its context data objects are the only
// differences. A text moved without any representation is refused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type AnnotationRepresentation,
  type Entity,
  type TextGeometry,
  type TextRepresentation,
  type Vec2,
} from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files read four times and written twice under load. */
const PER_FILE_BUDGET_MS = 15_000;

const D: Vec2 = { x: 1.5, y: -0.75 };
const moved = (p: Vec2): Vec2 => ({ x: p.x + D.x, y: p.y + D.y });

const repsOf = (e: Entity): readonly AnnotationRepresentation[] =>
  e.annotative?.representations ?? [];
const texts = (model: DocumentModel): Entity[] =>
  [...model.entities()].filter(
    (e) => e.geom.kind === 'TEXT' && repsOf(e).length > 0 && repsOf(e).every((r) => r.text),
  );

/** `g` and the representations `which` picks moved by D (a left-baseline text has no 11). */
function move(
  b: ChangeSetBuilder,
  e: Entity,
  which: (r: AnnotationRepresentation) => boolean,
): void {
  const g = e.geom as TextGeometry;
  const rep = (t: TextRepresentation): TextRepresentation => ({
    ...t,
    position: moved(t.position),
    ...(g.alignmentPoint ? { alignmentPoint: moved(t.alignmentPoint) } : {}),
  });
  b.updateEntity(e.id, {
    geom: {
      ...g,
      position: moved(g.position),
      ...(g.alignmentPoint ? { alignmentPoint: moved(g.alignmentPoint) } : {}),
    },
    annotative: {
      representations: repsOf(e).map((r) => (which(r) ? { ...r, text: rep(r.text!) } : r)),
    },
  });
}

let edited = 0;

describe('TriyaToAcad annotative texts on the public corpus', () => {
  const files = readable.filter((f) => {
    if (f.format !== 'dwg') {
      return /ACDB_TEXTOBJECTCONTEXTDATA_CLASS/.test(
        readFileSync(`${corpusDir}${f.path}`, 'latin1'),
      );
    }
    return true;
  });
  it.each(files.map((f) => [f.path, f] as const))(
    'moves the annotative texts of %s with their representations',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const open = (from: Uint8Array): DocumentModel =>
          DocumentModel.create(documentInit(readCadDocument(from)));
        const model = open(bytes);
        const targets = texts(model);
        if (targets.length === 0) return;
        const ignore = (
          reopened: ReturnType<typeof readCadDocument>,
          original: Uint8Array = bytes,
        ) =>
          structuralDiff(readCadDocument(original), reopened, {
            ignoreHandles: new Set(
              targets
                .flatMap((e) => [e.handle, ...repsOf(e).map((r) => r.handle)])
                .map((h) => Number.parseInt(h, 16)),
            ),
          }).differences.slice(0, 5);
        const mapsBack = (m: DocumentModel, saved: Uint8Array) => {
          const back = open(saved);
          const now = (x: DocumentModel) =>
            texts(x).map((e) => [e.handle, e.geom, e.annotative] as const);
          expect(now(back), f.path).toEqual(now(m));
        };

        // Refused: the text alone.
        const alone = open(bytes);
        const b0 = new ChangeSetBuilder(alone);
        move(b0, texts(alone)[0]!, () => false);
        alone.apply(b0.build());
        expect(() => exportDocument(readCadDocument(bytes), alone, options), f.path).toThrow(
          UnsupportedChangeError,
        );

        // MOVE: every representation.
        const b = new ChangeSetBuilder(model);
        for (const e of targets) move(b, e, () => true);
        model.apply(b.build());
        const saved = exportDocument(readCadDocument(bytes), model, options);
        mapsBack(model, saved);
        expect(ignore(readCadDocument(saved)), f.path).toEqual([]);

        // A grip edit: the text and its default (current) representation only.
        const again = open(saved);
        const g = new ChangeSetBuilder(again);
        for (const e of texts(again)) move(g, e, (r) => r.isDefault === true);
        again.apply(g.build());
        const saved2 = exportDocument(readCadDocument(saved), again, options);
        mapsBack(again, saved2);
        expect(ignore(readCadDocument(saved2), saved), f.path).toEqual([]);
        edited += targets.length;
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('edited the annotative texts of the ACadSharp samples', () => {
    // Two in each R2010, R2013 and R2018 sample (DWG, ASCII and binary DXF), and the base sample.
    expect(edited).toBeGreaterThanOrEqual(18);
  });
});
