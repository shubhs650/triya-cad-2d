// Plot style name and material edits on every readable public corpus file (M1-75 part 21): what
// the Properties palette's Plot style and Material rows do. Every model-space entity of a
// named-plot-style drawing ($PSTYLEMODE 0) is given the ACAD_PLOTSTYLENAME default (Normal), and
// from R2007 every one with no material is given Global and every one with a material loses it.
// The edits map back and nothing else in the drawing changes. A colour-dependent drawing refuses
// a plot style name, and a drawing before R2007 a material.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACadVersion,
  CadDictionary,
  CadDictionaryWithDefault,
  type CadDocument,
} from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Handle } from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files read three times and written once under full-suite load. */
const PER_FILE_BUDGET_MS = 10_000;

const hex = (n: number): Handle => n.toString(16).toUpperCase();

/** The ACAD_PLOTSTYLENAME default (Normal), when the drawing has one. */
function defaultPlotStyle(doc: CadDocument): Handle | undefined {
  const dict = doc.rootDictionary?.getEntry<CadDictionary>(CadDictionary.acadPlotStyleName);
  return dict instanceof CadDictionaryWithDefault && dict.defaultEntry
    ? hex(dict.defaultEntry.handle)
    : undefined;
}

describe('TriyaToAcad plot style name and material edits on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'restyles the model-space entities of %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const version = original.header?.version ?? ACadVersion.AC1032;
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const space = [...model.tables.blockRecords.values()].find(
          (b) => b.name.toUpperCase() === '*MODEL_SPACE',
        );
        const entities = space
          ? model.blockEntities(space.handle).map((id) => model.entity(id)!)
          : [];
        if (entities.length === 0) return;
        const normal = defaultPlotStyle(original);
        const named = version >= ACadVersion.AC1015 && original.header?.plotStyleMode === 0;
        const global = original.materials?.tryGet('Global');
        const withMaterials =
          version >= ACadVersion.AC1021 && global !== null && global !== undefined;

        if (normal !== undefined && !named) {
          const refused = DocumentModel.create(documentInit(readCadDocument(bytes)));
          const b = new ChangeSetBuilder(refused);
          b.updateEntity(entities[0]!.id, { plotStyle: normal });
          refused.apply(b.build());
          expect(() => exportDocument(readCadDocument(bytes), refused, options), f.path).toThrow(
            /plot style name in a colour-dependent drawing|has no plot style names/,
          );
        }
        const plotStyle = named ? normal : undefined;
        if (plotStyle === undefined && !withMaterials) return;

        const b = new ChangeSetBuilder(model);
        for (const e of entities) {
          b.updateEntity(e.id, {
            ...(plotStyle !== undefined ? { plotStyle } : {}),
            ...(withMaterials ? { material: e.material ? undefined : hex(global.handle) } : {}),
          });
        }
        model.apply(b.build());

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e]));
        for (const e of entities) {
          const now = model.entity(e.id)!;
          expect([back.get(e.handle)?.plotStyle, back.get(e.handle)?.material], f.path).toEqual([
            now.plotStyle,
            now.material,
          ]);
        }
        // Nothing else changes: only the restyled entities differ.
        const ignoreHandles = new Set(entities.map((e) => Number.parseInt(e.handle, 16)));
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences;
        expect(JSON.stringify(diff.slice(0, 5)), f.path).toEqual('[]');
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
