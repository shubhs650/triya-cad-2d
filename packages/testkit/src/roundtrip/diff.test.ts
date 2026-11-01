import type { CadDictionary } from '@node-projects/acad-ts';
import { ExtendedDataString, Line, XRecord, XYZ, type Circle } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { structuralDiff, summarizeDiff } from './diff.ts';
import { ACadVersion, entityOfType, twinDocuments } from './fixtures.ts';

const hex = (n: number): string => n.toString(16).toUpperCase();

describe('structuralDiff', () => {
  it('reports nothing for two reads of the same file', () => {
    const [a, b] = twinDocuments();
    const report = structuralDiff(a, b);
    expect(report.differences).toEqual([]);
    expect(report.objectsA).toBeGreaterThan(10);
    expect(report.objectsA).toBe(report.objectsB);
  });

  it('reports a changed geometric property by handle, type and path', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    line.endPoint = new XYZ(100, 51, 0);
    expect(structuralDiff(a, b).differences).toEqual([
      expect.objectContaining({
        handle: hex(line.handle),
        objectName: 'LINE',
        kind: 'value',
        path: expect.stringMatching(/endPoint\.y$/),
        a: '50',
        b: '51',
      }),
    ]);
  });

  it('reports objects missing from or added to the reopened document', () => {
    const [a, b] = twinDocuments();
    const circle = entityOfType<Circle>(b, 'CIRCLE');
    const handle = circle.handle;
    b.entities?.remove(circle);
    const extra = new Line(new XYZ(1, 1, 0), new XYZ(2, 2, 0));
    b.entities?.add(extra);
    const diffs = structuralDiff(a, b).differences;
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: 'missing', handle: hex(handle), objectName: 'CIRCLE' }),
    );
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: 'added', handle: hex(extra.handle), objectName: 'LINE' }),
    );
  });

  it('compares references to other objects by handle, not by deep content', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    line.layer = b.layers!.tryGetValue('0')!;
    const diffs = structuralDiff(a, b).differences.filter((d) => d.handle === hex(line.handle));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.path).toMatch(/layer/i);
    expect(diffs[0]!.b).toMatch(/^LAYER#/);
  });

  it('treats an empty string and a missing string as equal (the file cannot tell them apart)', () => {
    const [a, b] = twinDocuments();
    const layer = b.layers!.tryGetValue('M0-05')!;
    const original = a.layers!.tryGetValue('M0-05')!;
    (original as unknown as Record<string, unknown>)['plotStyleName'] = '';
    (layer as unknown as Record<string, unknown>)['plotStyleName'] = null;
    expect(structuralDiff(a, b).differences).toEqual([]);
  });

  it('reports xdata changes', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    line.extendedData.getByName('ACAD').records.push(new ExtendedDataString('extra'));
    const diffs = structuralDiff(a, b).differences;
    expect(diffs).toContainEqual(
      expect.objectContaining({
        handle: hex(line.handle),
        path: expect.stringContaining('extendedData'),
      }),
    );
  });

  it('reports reactor and owner changes', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    const circle = entityOfType<Circle>(b, 'CIRCLE');
    line.addReactor(circle);
    const diffs = structuralDiff(a, b).differences;
    expect(diffs).toContainEqual(
      expect.objectContaining({
        handle: hex(line.handle),
        path: expect.stringContaining('reactors'),
      }),
    );
  });

  it('reports a change inside an extension dictionary', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    const dict: CadDictionary = line.createExtendedDictionary();
    dict.addByKey('TRIYA_TEST', new XRecord());
    const diffs = structuralDiff(a, b).differences;
    expect(diffs.some((d) => d.handle === hex(line.handle) && /xdictionary/i.test(d.path))).toBe(
      true,
    );
    expect(diffs.some((d) => d.kind === 'added' && d.objectName === 'DICTIONARY')).toBe(true);
  });

  it('ignores the ordering of entries within a dictionary', () => {
    const [a, b] = twinDocuments();
    // Reverse the root dictionary's entry order in place; names, handles and owners stay.
    const entries = (b.rootDictionary as unknown as { _entries: Map<string, unknown> })._entries;
    const reversed = [...entries].reverse();
    entries.clear();
    for (const [key, value] of reversed) entries.set(key, value);
    expect(structuralDiff(a, b).differences).toEqual([]);
  });

  it('reports a change in entity order within a block', () => {
    const [a, b] = twinDocuments();
    // Reverse model space's entity order in place: same members, same handles.
    const set = (b.entities as unknown as { _entries: Set<unknown> })._entries;
    const reversed = [...set].reverse();
    set.clear();
    for (const e of reversed) set.add(e);
    const diffs = structuralDiff(a, b).differences;
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: 'order', objectName: 'BLOCK_RECORD' }),
    );
  });

  it('skips handles the caller lists as touched', () => {
    const [a, b] = twinDocuments();
    const line = entityOfType<Line>(b, 'LINE');
    line.endPoint = new XYZ(0, 0, 0);
    expect(structuralDiff(a, b, { ignoreHandles: new Set([line.handle]) }).differences).toEqual([]);
  });
});

describe('structuralDiff header rules (TESTING.md §3)', () => {
  it('reports an ordinary header variable by its $NAME', () => {
    const [a, b] = twinDocuments();
    b.header!.setValue('$LTSCALE', 2);
    expect(structuralDiff(a, b).differences).toEqual([
      expect.objectContaining({
        handle: '0',
        objectName: 'HEADER',
        path: '$LTSCALE',
        a: '1',
        b: '2',
      }),
    ]);
  });

  it('allows only the listed timestamps, GUIDs and a growing $HANDSEED', () => {
    const [a, b] = twinDocuments();
    const h = b.header!;
    h.updateDateTime = new Date(Date.UTC(2030, 0, 1));
    h.universalUpdateDateTime = new Date(Date.UTC(2030, 0, 1));
    h.totalEditingTime += 1000;
    h.userElapsedTimeSpan += 1000;
    h.versionGuid = '{00000000-0000-0000-0000-000000000001}';
    h.fingerPrintGuid = '{00000000-0000-0000-0000-000000000002}';
    h.handleSeed += 10;
    expect(structuralDiff(a, b).differences).toEqual([]);
  });

  it("allows the saving application's $LASTSAVEDBY and $ACADMAINTVER (DEC-041)", () => {
    const [a, b] = twinDocuments();
    b.header!.lastSavedBy = 'someone else';
    b.header!.maintenanceVersion += 1;
    expect(structuralDiff(a, b).differences).toEqual([]);
  });

  it('still reports a changed creation date', () => {
    const [a, b] = twinDocuments();
    b.header!.createDateTime = new Date(Date.UTC(2030, 0, 1));
    expect(structuralDiff(a, b).differences).toContainEqual(
      expect.objectContaining({ path: '$TDCREATE' }),
    );
  });

  it('reports a $HANDSEED that went down', () => {
    const [a, b] = twinDocuments();
    b.header!.handleSeed -= 1;
    expect(structuralDiff(a, b).differences).toContainEqual(
      expect.objectContaining({ path: '$HANDSEED' }),
    );
  });

  it('allows a $DWGCODEPAGE change only when the written version is Unicode (R2007+)', () => {
    const [a15, b15] = twinDocuments(ACadVersion.AC1015);
    b15.header!.codePage = 'ANSI_1251';
    expect(structuralDiff(a15, b15).differences).toContainEqual(
      expect.objectContaining({ path: '$DWGCODEPAGE' }),
    );

    const [a32, b32] = twinDocuments(ACadVersion.AC1032);
    b32.header!.codePage = 'ANSI_1251';
    expect(structuralDiff(a32, b32).differences).toEqual([]);
  });
});

describe('summarizeDiff', () => {
  it('groups differences by object type and property path, largest first', () => {
    const [a, b] = twinDocuments();
    entityOfType<Line>(b, 'LINE').endPoint = new XYZ(1, 2, 3);
    b.header!.setValue('$LTSCALE', 2);
    const summary = summarizeDiff(structuralDiff(a, b));
    expect(summary.total).toBe(4);
    expect(summary.byKind).toEqual({ value: 4 });
    expect(summary.byPath).toContainEqual({ key: 'HEADER $LTSCALE', count: 1 });
    expect(summary.byPath).toContainEqual({ key: 'LINE endPoint.x', count: 1 });
  });

  it('folds list indices so repeated failures group together', () => {
    const summary = summarizeDiff({
      objectsA: 2,
      objectsB: 2,
      truncated: false,
      differences: [
        { handle: '1', objectName: 'LWPOLYLINE', path: 'vertices[0].bulge', kind: 'value' },
        { handle: '1', objectName: 'LWPOLYLINE', path: 'vertices[7].bulge', kind: 'value' },
        { handle: '2', objectName: 'LINE', path: '', kind: 'missing' },
      ],
    });
    expect(summary.byPath).toEqual([
      { key: 'LWPOLYLINE vertices[].bulge', count: 2 },
      { key: 'LINE <missing>', count: 1 },
    ]);
  });
});
