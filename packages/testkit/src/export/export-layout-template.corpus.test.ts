// LAYOUT Template and SAveas saved (M6-01 part 4) on every readable public corpus file from R2000
// on that has a paper layout.
//
// Template: every layout of the file (`layoutTemplates`, through a structured clone as the app
// hands them over) inserted into ezdxf's colors.dxf (no viewports of its own) after its last tab,
// as LAYOUT Template inserts them, and that drawing saved as AC1032 DXF (DEC-047) and read again:
// the layouts read back as the engine has them, and each inserted sheet holds what the engine
// pasted, in the same order. SAveas: each layout written as a new drawing (`writeBlockDrawing`
// with the layout: the blank drawing's layout takes it), read again with that one layout, its
// page setup and its sheet's objects. ACadSharp's AC1032 sample and ezdxf's text_in_viewports.dxf
// (a clipped viewport) are saved for the ezdxf audit (audit.py `FIXTURE_SAVES`, kinds
// `layout-template` and `layout-saveas`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  insertLayoutTemplate,
  layoutTemplates,
  paperLayouts,
  templateLayoutName,
  type Clipboard,
  type Entity,
  type Layout,
  type LayoutTemplateCopy,
} from '@triya/engine';
import { documentInit, readCadDocument, writeBlockDrawing } from '@triya/io';
import { describe, expect } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const TARGET = 'public/third-party/ezdxf/examples_dxf/colors.dxf';
const AUDITED = new Set([
  'public/third-party/acadsharp/sample_AC1032_ascii.dxf',
  'public/third-party/ezdxf/examples_dxf/text_in_viewports.dxf',
]);

const comparable = ({ raw: _raw, ...rest }: Layout): unknown => JSON.parse(JSON.stringify(rest));

/** Keys whose values are handles (or ids) of other objects: a copy names its own. */
const LINKS = new Set([
  'handle',
  'id',
  'owner',
  'raw',
  'reactors',
  'extDict',
  'block',
  'clipBoundary',
  'frozenLayers',
  'layer',
  'linetype',
  'style',
  'textStyle',
  'dimStyle',
  'material',
  'plotStyle',
  'annotation',
  'sources',
  'xdata',
]);

/** An object as its copy repeats it: without the handles it has or names. */
function shape(e: Entity): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (typeof v === 'bigint') return v.toString();
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !LINKS.has(k))
        .map(([k, x]) => [k, strip(x)]),
    );
  };
  const { id: _id, ...rest } = e;
  const g = e.geom as unknown as Record<string, unknown>;
  // A viewport's own id (DXF 69) is carried: keep it.
  return { ...(strip(rest) as object), ...(e.geom.kind === 'VIEWPORT' && { vp: g['id'] }) };
}

const sheet = (model: DocumentModel, handle: string) =>
  model
    .blockEntities(model.layouts.find((l) => l.handle === handle)!.blockRecord)
    .map((id) => model.entity(id)!);

const metric = (model: DocumentModel) => model.header.get('$MEASUREMENT') === 1;

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const NOTHING: Clipboard = {
  base: { x: 0, y: 0 },
  entities: [],
  blockEntities: [],
  tables: {},
  blocks: [],
};

const targetBytes = new Uint8Array(readFileSync(`${corpusDir}${TARGET}`));
let inserted = 0;
let written = 0;
let objects = 0;
let viewports = 0;
let clipped = 0;
let refusals = 0;

describe('LAYOUT Template and SAveas saved on the public corpus', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.version >= 'AC1015'),
    (f) => {
      const path = f.path;
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      withPinnedClock(() => {
        const source = open(bytes);
        if (paperLayouts(source).length === 0) return;
        // As the app hands them to the drawing's engine.
        const copies = structuredClone(layoutTemplates(source)) as LayoutTemplateCopy[];
        for (const c of copies) refusals += [...c.refused.values()].reduce((a, n) => a + n, 0);

        // Template: all of them into colors.dxf.
        const target = open(targetBytes);
        const b = new ChangeSetBuilder(target);
        const taken = new Set<string>();
        const made: string[] = [];
        for (const c of copies) {
          const name = templateLayoutName(target, c.template.name, taken);
          taken.add(name.toUpperCase());
          made.push(insertLayoutTemplate(b, target, c.template, name).layout.handle);
        }
        target.apply(b.build());
        const save = () => saveAc1032Dxf(readCadDocument(targetBytes), target);
        if (AUDITED.has(path))
          writeAuditSave(path.replace(/^public\//, ''), 'layout-template', save);
        const back = open(save());
        expect(back.layouts.map(comparable), path).toEqual(target.layouts.map(comparable));
        made.forEach((h, i) => {
          const now = sheet(back, h);
          expect(now.map(shape), `${path}: ${h}`).toEqual(sheet(target, h).map(shape));
          expect(now.length, `${path}: ${h}`).toBe(copies[i]!.template.content.entities.length);
          objects += now.length;
          for (const e of now) {
            if (e.geom.kind !== 'VIEWPORT') continue;
            viewports++;
            if (e.geom.clipBoundary !== undefined) clipped++;
          }
        });
        inserted += made.length;

        // SAveas: each one as a new drawing of its own.
        copies.forEach((c, i) => {
          // In the template drawing's units, as SAveas writes it (carriedHeader).
          const header = {
            $INSUNITS: source.meta.insUnits ?? 0,
            $MEASUREMENT: source.header.get('$MEASUREMENT') ?? 0,
          };
          const out = writeBlockDrawing(NOTHING, header, c.template);
          if (AUDITED.has(path) && i === 0)
            writeAuditSave(path.replace(/^public\//, ''), 'layout-saveas', () => out);
          const drawing = open(out);
          const layouts = paperLayouts(drawing);
          expect(
            layouts.map((l) => l.name),
            path,
          ).toEqual([c.template.name]);
          const [only] = layouts;
          // As in colors.dxf, where both drawings agree on the units' own sheet (a paper of no
          // size takes it, layout-templates.ts).
          const was = target.layouts.find((l) => l.handle === made[i])!;
          if (metric(drawing) === metric(target)) {
            expect(only!.plot, path).toEqual(was.plot);
            expect(only!.limits, path).toEqual(was.limits);
          }
          expect(only!.plot!.paperWidth, path).toBeGreaterThan(0);
          expect(sheet(drawing, only!.handle).map(shape), path).toEqual(
            sheet(target, made[i]!).map(shape),
          );
          written++;
        });
      });
    },
    () => {
      // Every layout of the corpus inserted and written, with what is on it: 197 layouts, 210
      // objects, 172 viewports (6 clipped), none refused at the time of writing.
      expect(inserted).toBeGreaterThanOrEqual(197);
      expect(written).toBe(inserted);
      expect(objects).toBeGreaterThanOrEqual(210);
      expect(viewports).toBeGreaterThanOrEqual(172);
      expect(clipped).toBeGreaterThanOrEqual(6);
      expect(refusals).toBe(0);
    },
  );
});
