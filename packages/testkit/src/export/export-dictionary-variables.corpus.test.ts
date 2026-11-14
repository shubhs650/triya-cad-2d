// SETVAR on the AcDbVariableDictionary's variables (M2-59 part 4), on every readable public
// corpus file that has them: CANNOSCALE is set to another of the drawing's annotation scales,
// CMLEADERSTYLE and CTABLESTYLE to another style the drawing has (typed in lower case, so the
// style's own spelling is what is kept), MSLTSCALE and HIDETEXT flipped and LAYEREVAL,
// LAYERNOTIFY and CENTEREXE given new values, each as typed at `Command:`. The drawing is saved
// as AC1032 DXF (DEC-047) and read back: every DICTIONARYVAR holds what SETVAR set, and
// CANNOSCALEVALUE is the new scale's.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel, PromptBus, builtinCommands, type HeaderValue } from '@triya/engine';
import { documentInit, mapHeader, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Another name than `current` from `names`, else `current` (a drawing with one style). */
function another(names: readonly string[], current: HeaderValue | undefined): string | undefined {
  if (typeof current !== 'string') return undefined;
  const key = current.toUpperCase();
  return names.find((n) => n.toUpperCase() !== key) ?? names.find((n) => n.toUpperCase() === key);
}

describe('AcDbVariableDictionary variables set by SETVAR save and read back', () => {
  let files = 0;
  let scales = 0;
  let styles = 0;

  it.each(readable.map((f) => [f.path] as const))(
    '%s',
    async (path) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
      await withPinnedClock(async () => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(original));
        const header = model.header;
        if (!header.has('CANNOSCALE') && !header.has('CMLEADERSTYLE')) return;
        const typed: string[] = [];
        const want = new Map<string, HeaderValue>();
        const set = (name: string, value: string, kept: HeaderValue = value) => {
          if (!header.has(name)) return;
          typed.push(name, value);
          want.set(name, kept);
        };
        const scale = another(
          (model.meta.annotationScales ?? []).map((s) => s.name),
          header.get('CANNOSCALE'),
        );
        if (scale !== undefined) {
          set('CANNOSCALE', scale);
          want.set(
            'CANNOSCALEVALUE',
            model.meta.annotationScales!.find((s) => s.name === scale)!.value,
          );
          if (scale !== header.get('CANNOSCALE')) scales++;
        }
        for (const [name, table] of [
          ['CMLEADERSTYLE', model.tables.mleaderStyles],
          ['CTABLESTYLE', model.tables.tableStyles],
        ] as const) {
          const names = [...table.values()].map((s) => s.name);
          const style = another(names, header.get(name));
          if (style === undefined) continue;
          set(name, style.toLowerCase(), style);
          if (style.toUpperCase() !== String(header.get(name)).toUpperCase()) styles++;
        }
        set('MSLTSCALE', header.get('MSLTSCALE') === '1' ? '0' : '1');
        set('HIDETEXT', header.get('HIDETEXT') === '1' ? '0' : '1');
        set('LAYEREVAL', '1');
        set('LAYERNOTIFY', '15');
        set('CENTEREXE', '0.12', '0.120000');
        if (typed.length === 0) return;

        const bus = new PromptBus({ model, registry: builtinCommands() });
        await bus.script(typed);
        expect(bus.command, path).toBeUndefined();
        for (const [name, value] of want) expect(model.header.get(name), name).toBe(value);

        const saved = mapHeader(readCadDocument(saveAc1032Dxf(original, model))).header;
        for (const [name, value] of want) {
          if (name === 'CANNOSCALEVALUE') {
            expect(saved.get(name) as number, `${path} ${name}`).toBeCloseTo(value as number, 12);
          } else {
            expect(saved.get(name), `${path} ${name}`).toBe(value);
          }
        }
        files++;
      });
    },
    30_000,
  );

  it('changed a scale and a style somewhere', () => {
    expect(files).toBeGreaterThan(20);
    expect(scales).toBeGreaterThan(10);
    expect(styles).toBeGreaterThan(10);
  });
});
