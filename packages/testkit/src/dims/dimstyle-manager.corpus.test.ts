// M4-03's acceptance, "every DIMVAR round-trips through dialog", on every readable public corpus
// file with a dimension style: DIMSTYLE's New makes a style from the current one with every
// field of the seven tabs set to something other than it was (as the dialog's OK sends it),
// Modify changes the current style, and Override sets a header DIMVAR. The drawing is saved as
// AC1032 DXF (DEC-047), read back by acad-ts and mapped: the new style comes back with every
// DIMVAR the model holds (references by the record they name), the modified one with its
// change, and the header with the override. With TRIYA_DXF_AUDIT_DIR set the save goes to the
// ezdxf audit as the file's `dimension` save's sibling, `edited` being taken.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DIMSTYLE_FIELDS,
  DIMVAR_BY_CODE,
  DocumentModel,
  PromptBus,
  builtinCommands,
  currentDimStyle,
  dialogVars,
  setField,
  type DimStyleFieldValue,
  type DimStyleRecord,
  type DimVarValue,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/**
 * A value for every field, each unlike AutoCAD's defaults, in the order the dialog would take
 * them (the tolerance method before its values, the unit format before its precision).
 */
const FIELD_VALUES: readonly (readonly [string, DimStyleFieldValue])[] = [
  ['DIMCLRD', '1'],
  ['DIMLWD', '25'],
  ['DIMDLE', 0.1],
  ['DIMDLI', 0.5],
  ['DIMSD1', true],
  ['DIMSD2', true],
  ['DIMCLRE', '2'],
  ['DIMLWE', '35'],
  ['DIMSE1', true],
  ['DIMSE2', true],
  ['DIMEXE', 0.2],
  ['DIMEXO', 0.07],
  ['DIMFXLON', true],
  ['DIMFXL', 1.5],
  ['DIMBLK1', '_DOT'],
  ['DIMBLK2', '_ARCHTICK'],
  ['DIMLDRBLK', '_OPEN'],
  ['DIMASZ', 0.2],
  ['DIMCEN.type', 'line'],
  ['DIMCEN.size', 0.15],
  ['DIMARCSYM', '1'],
  ['DIMJOGANG', 30],
  ['DIMCLRT', '3'],
  ['DIMTFILL', '4'],
  ['DIMTXT', 0.25],
  ['DIMTAD', '1'],
  ['DIMJUST', '1'],
  ['DIMTXTDIRECTION', '1'],
  ['DIMGAP', 0.1],
  ['DIMTIH.alignment', 'iso'],
  ['DIMATFIT', '1'],
  ['DIMSOXD', true],
  ['DIMTMOVE', '1'],
  ['DIMSCALE', 2],
  ['DIMUPT', true],
  ['DIMTOFL', true],
  ['DIMLUNIT', '4'],
  ['DIMDEC', '3'],
  ['DIMFRAC', '1'],
  ['DIMTFAC', 0.8],
  ['DIMDSEP', ','],
  ['DIMRND', 0.5],
  ['DIMPOST.prefix', '~'],
  ['DIMPOST.suffix', ' mm'],
  ['DIMLFAC', 2],
  ['DIMLFAC.layout', true],
  ['DIMZIN.leading', true],
  ['DIMZIN.trailing', true],
  ['DIMZIN.feet', false],
  ['DIMAUNIT', '1'],
  ['DIMADEC', '2'],
  ['DIMAZIN.leading', true],
  ['DIMAZIN.trailing', true],
  ['DIMALT', true],
  ['DIMALTU', '7'],
  ['DIMALTD', '3'],
  ['DIMALTF', 2],
  ['DIMALTRND', 0.25],
  ['DIMAPOST.prefix', 'A'],
  ['DIMAPOST.suffix', ' in'],
  ['DIMALTZ.leading', true],
  ['DIMALTZ.trailing', true],
  ['DIMAPOST.placement', 'below'],
  ['DIMTOL.method', 'deviation'],
  ['DIMTDEC', '3'],
  ['DIMTP', 0.02],
  ['DIMTM', 0.01],
  ['DIMTOLJ', '2'],
  ['DIMTZIN.leading', true],
  ['DIMALTTD', '3'],
  ['DIMALTTZ.trailing', true],
];

const OBSOLETE = new Set(['DIMFIT', 'DIMUNIT']);
const NAMES = Object.values(DIMVAR_BY_CODE).filter((n) => !OBSOLETE.has(n));
const REFS = new Set(['DIMTXSTY', 'DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMLDRBLK']);
const LINETYPES = new Set(['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2']);

/** A DIMVAR as the comparison sees it: switches as numbers, reals to 12 figures, refs by name. */
function comparable(model: DocumentModel, name: string, v: DimVarValue | undefined): unknown {
  if (REFS.has(name)) {
    const h = typeof v === 'string' && v !== '0' ? v : '';
    if (name === 'DIMTXSTY') return h && model.tables.textStyles.get(h)?.name.toUpperCase();
    return h && model.blocks.get(h)?.name.toUpperCase();
  }
  if (LINETYPES.has(name)) {
    const h = typeof v === 'string' && v !== '0' ? v : '';
    const n = h ? model.tables.linetypes.get(h)?.name.toUpperCase() : '';
    return n === 'BYBLOCK' ? '' : n;
  }
  if (typeof v === 'boolean') return Number(v);
  if (typeof v === 'number') return Number(v.toPrecision(12)) + 0;
  return v;
}

const named = (model: DocumentModel, name: string): DimStyleRecord | undefined =>
  [...model.tables.dimStyles.values()].find((s) => s.name === name);

describe('Dimension Style Manager on the public corpus (M4-03)', () => {
  let saved = 0;
  let styleless = 0;

  it('sets every DIMVAR the dialog shows (the text style and linetypes by the drawing’s own)', () => {
    const set = new Set(
      FIELD_VALUES.flatMap(([key]) => DIMSTYLE_FIELDS.find((fl) => fl.key === key)!.vars),
    );
    const shown = [...new Set(DIMSTYLE_FIELDS.flatMap((fl) => fl.vars))];
    expect(shown.filter((n) => !set.has(n))).toEqual([
      'DIMLTYPE',
      'DIMLTEX1',
      'DIMLTEX2',
      'DIMTXSTY',
    ]);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s keeps every DIMVAR the dialog sets through a save',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      const current = currentDimStyle(model);
      if (!current) {
        styleless++;
        return;
      }
      const bus = new PromptBus({ model, registry: builtinCommands() });
      await bus.submit('DIMSTYLE');
      expect(bus.prompt?.kind, f.path).toBe('dialog');
      // A linetype other than ByBlock for the three linetype fields, when the drawing has one.
      const linetype = [...model.tables.linetypes.values()].find(
        (l) => !['BYBLOCK', 'BYLAYER', ''].includes(l.name.toUpperCase()),
      );
      let vars = dialogVars(current.vars);
      for (const [key, value] of [
        ...FIELD_VALUES,
        ...(linetype
          ? (['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2'] as const).map(
              (k) => [k, linetype.handle] as const,
            )
          : []),
      ]) {
        const next = setField(vars, key, value);
        expect(next, `${f.path} ${key}`).not.toBe(vars);
        vars = next;
      }

      const answer = (dimstyle: object) =>
        bus.answer({ kind: 'dialog', action: 'apply', dimstyle: dimstyle as never });
      await answer({ op: 'new', name: 'Triya M4-03', from: current.name, vars });
      const made = named(model, 'Triya M4-03');
      expect(made, f.path).toBeDefined();
      await answer({
        op: 'modify',
        name: current.name,
        vars: setField(dialogVars(current.vars), 'DIMEXE', 0.3125),
      });
      await answer({
        op: 'override',
        vars: setField(dialogVars(named(model, current.name)!.vars), 'DIMSCALE', 3),
      });
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command, f.path).toBeUndefined();

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      saved++;
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      const again = named(back, 'Triya M4-03');
      expect(again, f.path).toBeDefined();
      const wrong = NAMES.filter(
        (n) =>
          JSON.stringify(comparable(model, n, made!.vars[n])) !==
          JSON.stringify(comparable(back, n, again!.vars[n])),
      ).map((n) => `${n}: ${made!.vars[n]} → ${again!.vars[n]}`);
      expect(wrong, f.path).toEqual([]);
      expect(Number(named(back, current.name)!.vars.DIMEXE), f.path).toBe(0.3125);
      expect(back.header.get('$DIMSCALE'), f.path).toBe(3);
    },
    30_000,
  );

  it('saved a style on every readable file with a dimension style', () => {
    expect(saved + styleless).toBe(readable.length);
    expect(saved).toBeGreaterThan(readable.length / 2);
  });
});
