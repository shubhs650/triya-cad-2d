// M4-05 part 4: the Table Cell menu's formatting prompts driven directly, for the answers the
// bus never sends them (a prompt with a default turns Enter into it) and a table without a
// table style.
import { describe, expect, it } from 'vitest';
import {
  prompts,
  type CommandContext,
  type PromptAnswer,
  type TableGeometry,
} from '../../src/index';
import { formattedTable } from '../../src/commands/draw/table-cell-format';

const ctx = { prompt: prompts, message: () => {} } as unknown as CommandContext;

const table: TableGeometry = {
  kind: 'ACAD_TABLE',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [1],
  columnWidths: [1],
  cells: [[{ type: 'text', text: 'x', rowSpan: 1, columnSpan: 1, merged: false, rotation: 0 }]],
};
const R = { r0: 0, c0: 0, r1: 0, c1: 0 };

/** The prompts `option` asks, answered in turn by `answers`, and what it returns. */
async function drive(
  option: 'BAckground' | 'ALignment' | 'BOrders' | 'Height',
  answers: PromptAnswer[],
) {
  const gen = formattedTable(ctx, table, undefined, R, option);
  const asked: string[] = [];
  let step = await gen.next();
  for (const a of answers) {
    if (step.done) break;
    asked.push(step.value.message);
    step = await gen.next(a);
  }
  return { asked, done: step.done, result: step.done ? step.value : undefined };
}

const ESC: PromptAnswer = { kind: 'escape' };

describe('formattedTable', () => {
  it('ends without a table at an answer it does not take', async () => {
    for (const [option, answers] of [
      ['ALignment', [ESC]],
      ['Height', [ESC]],
      ['BAckground', [{ kind: 'enter' }]],
      ['BOrders', [ESC]],
      ['BOrders', [{ kind: 'keyword', keyword: 'All' }, ESC]],
      ['BOrders', [{ kind: 'keyword', keyword: 'All' }, { kind: 'string', value: 'red' }, ESC]],
    ] as const) {
      const r = await drive(option, [...answers]);
      expect(r).toMatchObject({ done: true, result: undefined });
    }
  });

  it('takes a styleless table’s defaults: top left, 0.18 high', async () => {
    const gen = formattedTable(ctx, table, undefined, R, 'ALignment');
    expect((await gen.next()).value).toMatchObject({
      default: { kind: 'keyword', keyword: 'TL' },
    });
    const h = formattedTable(ctx, table, undefined, R, 'Height');
    expect((await h.next()).value).toMatchObject({ default: { kind: 'distance', value: 0.18 } });
  });
});
