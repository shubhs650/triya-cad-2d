// M6-02 part 21: the status bar's annotation scale menu lists the drawing's scale list as its
// edits left it (SCALELISTEDIT adds, renames, reorders and deletes scales; undo takes them back).
import { describe, expect, it } from 'vitest';
import type { ChangeSet, DrawingScale } from '@triya/engine';
import { editedScaleList } from '../src/AnnotationScale';

const scale = (handle: string, key: string, name: string, drawingUnits: number): DrawingScale => ({
  type: 'SCALE',
  handle,
  owner: 'B6',
  key,
  name,
  paperUnits: 1,
  drawingUnits,
  unitScale: false,
});

const ONE = scale('B7', 'A0', '1:1', 1);
const FIFTY = scale('B8', 'A1', '1:50', 50);
const MOVED: DrawingScale = { ...FIFTY, key: 'A3', name: '1:25', drawingUnits: 25 };

describe('the annotation scale menu’s list', () => {
  it('is the scales the drawing opened with, in key order', () => {
    expect(editedScaleList([FIFTY, ONE], []).map((s) => s.name)).toEqual(['1:1', '1:50']);
  });

  it('follows each change: added, renamed and moved, deleted', () => {
    const changes: ChangeSet[] = [
      { objects: { added: [scale('C1', 'A2', 'Site', 500)] } },
      {
        objects: {
          updated: [{ before: FIFTY, after: MOVED }],
        },
      },
      { objects: { removed: [ONE] } },
    ];
    expect(editedScaleList([ONE, FIFTY], changes)).toEqual([
      { name: 'Site', value: 1 / 500, handle: 'C1' },
      { name: '1:25', value: 1 / 25, handle: 'B8' },
    ]);
  });
});
