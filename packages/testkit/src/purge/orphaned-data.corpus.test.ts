// PURGE's Orphaned data on the self-authored DGN linestyle drawing (M5-09 part 5,
// scripts/corpus/dgn-linestyles.py): the reader maps the `ACAD_DGNLINESTYLECOMP` components with
// the linetypes using them and their links, the engine offers those no linetype uses, and the
// save removes them (with the anonymous block only an orphaned symbol drew) and nothing else; the
// dictionary goes once empty. What a linetype still uses, or the file refers to otherwise, is
// refused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  isDgnLinestyleComponent,
  orphanedData,
  purgeClosure,
  purgeInto,
  purgeOrphanedInto,
  purgeState,
  type DgnLinestyleComponent,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument } from '@triya/io';
import { CadDictionary, XRecord } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { writeAuditSave } from '../dxf-audit/saves.ts';

const file = fileURLToPath(
  new URL('../../../../corpus/public/self-authored/dgn-linestyles.dxf', import.meta.url),
);
const bytes = new Uint8Array(readFileSync(file));

const open = (b: Uint8Array = bytes) => DocumentModel.create(documentInit(readCadDocument(b)));
const components = (m: DocumentModel): DgnLinestyleComponent[] =>
  [...m.objects.values()].filter(isDgnLinestyleComponent);
const names = (cs: readonly { name: string }[]) => cs.map((c) => c.name).sort();
const linetype = (m: DocumentModel, name: string) =>
  [...m.tables.linetypes.values()].find((l) => l.name === name)!.handle;
const block = (m: DocumentModel, name: string) =>
  [...m.tables.blockRecords.values()].find((b) => b.name === name)?.handle;
const save = (m: DocumentModel) =>
  withPinnedClock(() => exportDocument(readCadDocument(bytes), m, { format: 'dxf' }));
const AUDIT_PATH = 'self-authored/dgn-linestyles.dxf';
const OLD = ['DGN_OLD_COMPOUND', 'DGN_OLD_INTERNAL', 'DGN_OLD_STROKE', 'DGN_OLD_SYMBOL'];

/** Purges the orphaned data of `m`. */
function purgeOrphaned(m: DocumentModel): void {
  const b = new ChangeSetBuilder(m);
  purgeOrphanedInto(b, m, orphanedData(m));
  m.apply(b.build());
}

describe('Orphaned data (DGN linestyle data no linetype uses)', () => {
  it('is read with the linetypes using each component and its links', () => {
    const m = open();
    const by = new Map(components(m).map((c) => [c.name, c]));
    expect(by.size).toBe(10);
    const dash = linetype(m, 'DGN_DASH');
    const unused = linetype(m, 'DGN_UNUSED');
    expect(by.get('DGN_DASH_STROKE')).toMatchObject({
      className: 'AcDbLSStrokePatternComponent',
      usedBy: [dash, unused],
      parts: [],
    });
    expect(by.get('DGN_RAIL_COMPOUND')).toMatchObject({
      usedBy: [linetype(m, 'DGN_RAIL')],
      parts: [by.get('DGN_RAIL_STROKE')!.handle, by.get('DGN_RAIL_POINTS')!.handle],
    });
    expect(by.get('DGN_OLD_SYMBOL')!.symbolBlocks).toEqual([block(m, '*U2')]);
    expect(names(orphanedData(m))).toEqual(OLD);
    // Nothing else of the file refers to them.
    expect(components(m).some((c) => m.purgePinned.has(c.handle))).toBe(false);
  });

  it('saves without what PURGE removed, and with everything else', () => {
    const m = open();
    const ring = block(m, '*U2')!;
    purgeOrphaned(m);
    expect(m.tables.blockRecords.has(ring)).toBe(false);
    const written = save(m);
    writeAuditSave(AUDIT_PATH, 'orphaned-data', () => written);
    const back = open(written);
    expect(names(components(back))).toEqual(names(components(m)));
    expect(names(orphanedData(back))).toEqual([]);
    expect(block(back, '*U2')).toBeUndefined();
    expect(block(back, '*U1')).toBeDefined();
    // The links of what stays are as they were.
    const before = new Map(components(open()).map((c) => [c.handle, c]));
    for (const c of components(back)) expect(c).toEqual(before.get(c.handle));
  });

  it('a purged linetype leaves what only it used orphaned', () => {
    const m = open();
    const b = new ChangeSetBuilder(m);
    const items = purgeClosure(m, [linetype(m, 'DGN_UNUSED')], false);
    expect(items.map((i) => i.name)).toEqual(['DGN_UNUSED']);
    purgeInto(b, m, items);
    m.apply(b.build());
    expect(names(orphanedData(m))).toEqual([...OLD, 'DGN_UNUSED_STROKE'].sort());
    purgeOrphaned(m);
    const back = open(save(m));
    expect(names(components(back))).toEqual([
      'DGN_DASH_STROKE',
      'DGN_RAIL_COMPOUND',
      'DGN_RAIL_POINTS',
      'DGN_RAIL_STROKE',
      'DGN_RAIL_TIE',
    ]);
  });

  it('the dictionary goes with the last component', () => {
    const m = open();
    // Nothing uses the DGN linetypes once their lines go.
    const b = new ChangeSetBuilder(m);
    for (const e of [...m.entities()]) if (e.type === 'LINE') b.removeEntity(e.id);
    m.apply(b.build());
    const dgn = purgeState(m).purgeable.filter((i) => i.name.startsWith('DGN_'));
    expect(dgn.map((i) => i.name)).toEqual(['DGN_DASH', 'DGN_RAIL', 'DGN_UNUSED']);
    const p = new ChangeSetBuilder(m);
    purgeInto(
      p,
      m,
      purgeClosure(
        m,
        dgn.map((i) => i.handle),
        false,
      ),
    );
    m.apply(p.build());
    purgeOrphaned(m);
    expect(components(m)).toEqual([]);
    const written = save(m);
    writeAuditSave(AUDIT_PATH, 'orphaned-data-all', () => written);
    expect(components(open(written))).toEqual([]);
    const doc = readCadDocument(written);
    expect(doc.rootDictionary!.entryNames).not.toContain('ACAD_DGNLINESTYLECOMP');
    expect(block(open(written), '*U1')).toBeUndefined();
  });

  it('refuses to remove a component a linetype still uses', () => {
    const m = open();
    const stroke = components(m).find((c) => c.name === 'DGN_RAIL_STROKE')!;
    const b = new ChangeSetBuilder(m);
    b.removeObject(stroke.handle);
    m.apply(b.build());
    expect(() => save(m)).toThrow(
      /DGN_RAIL_STROKE .*: DGN_RAIL_(COMPOUND|POINTS) .* still uses it/,
    );
  });

  it('keeps what the file refers to otherwise', () => {
    const doc = readCadDocument(bytes);
    const old = [...doc.rootDictionary!].find(
      (o) => o instanceof CadDictionary && o.entryNames.includes('DGN_OLD_STROKE'),
    ) as CadDictionary;
    // An application's record pointing at a component.
    const x = new XRecord();
    x.handle = 0x500;
    x.createEntry(340, old.getEntry('DGN_OLD_STROKE')!.handle);
    doc.rootDictionary!.addByKey('MYAPP_LINKS', x);
    const m = DocumentModel.create(documentInit(doc));
    expect(names(orphanedData(m))).toEqual([
      'DGN_OLD_COMPOUND',
      'DGN_OLD_INTERNAL',
      'DGN_OLD_SYMBOL',
    ]);
  });
});
