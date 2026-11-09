// UNDO, U, REDO and OOPS (M2-05, COMMANDS.md "Modify"), on the bus's undo history. Prompts and
// messages are AutoCAD 2024's; where its help is silent the choice is in DEC-049.
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import type { UndoResult } from './undo';

const DISABLED = '** U command disabled. Use UNDO command to turn it on **';

/** Echoes an undo as AutoCAD does: the commands undone, newest first, on one line. */
function report(ctx: CommandContext, r: UndoResult): void {
  if (r.labels.length === 0 && !r.mark) {
    ctx.message(r.exhausted ? 'Nothing to undo' : 'Everything has been undone');
    return;
  }
  if (r.labels.length > 0) ctx.message(r.labels.join(' '));
  if (r.mark) ctx.message('Mark encountered');
  else if (r.exhausted) ctx.message('Everything has been undone');
}

const yesNo = (value: boolean) => ({
  options: ['Yes', 'No'],
  default: { kind: 'keyword' as const, keyword: value ? 'Yes' : 'No' },
});

async function* control(ctx: CommandContext): CommandGenerator {
  const a = yield ctx.prompt.keyword({
    message: 'Enter an UNDO control option',
    options: ['All', 'None', 'One', 'Combine', 'Layer'],
    default: { kind: 'keyword', keyword: 'All' },
  });
  if (a.kind !== 'keyword') return;
  const u = ctx.undo;
  if (a.keyword === 'All' || a.keyword === 'None' || a.keyword === 'One') {
    u.setControl(a.keyword === 'All' ? 'all' : a.keyword === 'None' ? 'none' : 'one');
    return;
  }
  const combine = a.keyword === 'Combine';
  const b = yield ctx.prompt.keyword({
    message: combine ? 'Combine zoom and pan operations?' : 'Combine layer control operations?',
    ...yesNo(combine ? u.settings.combineZoomPan : u.settings.combineLayer),
  });
  if (b.kind !== 'keyword') return;
  u.setSettings(
    combine ? { combineZoomPan: b.keyword === 'Yes' } : { combineLayer: b.keyword === 'Yes' },
  );
}

export const UNDO: CommandDef = {
  name: 'UNDO',
  async *run(ctx) {
    const u = ctx.undo;
    // With undo off, only its control options are left to choose.
    if (u.control === 'none') return yield* control(ctx);
    for (;;) {
      const one = u.control === 'one';
      const a = yield ctx.prompt.integer({
        message: 'Enter the number of operations to undo or',
        options: one ? ['Control'] : ['Auto', 'Control', 'BEgin', 'End', 'Mark', 'Back'],
        default: { kind: 'number', value: 1 },
      });
      if (a.kind === 'number') {
        if (a.value < 1) {
          ctx.message('Value must be positive and nonzero.');
          continue;
        }
        return report(ctx, u.undo(one ? 1 : a.value));
      }
      if (a.kind !== 'keyword') return;
      switch (a.keyword) {
        case 'Auto': {
          const b = yield ctx.prompt.keyword({
            message: 'Enter UNDO Auto mode',
            options: ['ON', 'OFF'],
            default: { kind: 'keyword', keyword: u.settings.auto ? 'ON' : 'OFF' },
          });
          if (b.kind === 'keyword') u.setSettings({ auto: b.keyword === 'ON' });
          return;
        }
        case 'Control':
          return yield* control(ctx);
        case 'BEgin':
          return u.begin();
        case 'End':
          return u.end();
        case 'Mark':
          return u.mark();
        default: {
          // Back
          if (!u.hasMark) {
            const b = yield ctx.prompt.keyword({
              message: 'This will undo everything. OK?',
              ...yesNo(true),
            });
            if (b.kind !== 'keyword' || b.keyword !== 'Yes') return;
          }
          return report(ctx, u.back());
        }
      }
    }
  },
};

/** U: UNDO 1, without a prompt. */
export const U: CommandDef = {
  name: 'U',
  // eslint-disable-next-line require-yield -- a command that never prompts
  async *run(ctx) {
    if (ctx.undo.control === 'none') return ctx.message(DISABLED);
    report(ctx, ctx.undo.undo(1));
  },
};

/** REDO: reverses the last U or UNDO; each REDO in a row reverses one more. */
export const REDO: CommandDef = {
  name: 'REDO',
  // eslint-disable-next-line require-yield -- a command that never prompts
  async *run(ctx) {
    const labels = ctx.undo.redo();
    ctx.message(labels ? labels.join(' ') : 'Previous command did not undo things');
  },
};

/**
 * OOPS: puts back what the last erasing command removed (ERASE, BLOCK, WBLOCK), whatever ran
 * since, as one new step; what is already back (after U, or a second OOPS) is skipped.
 */
export const OOPS: CommandDef = {
  name: 'OOPS',
  // eslint-disable-next-line require-yield -- a command that never prompts
  async *run(ctx) {
    const back = ctx.undo.erased.filter(
      (e) => ctx.model.entity(e.id) === undefined && ctx.model.hasBlock(e.owner),
    );
    if (back.length === 0) return ctx.message('Nothing to restore.');
    ctx.edit((b) => back.forEach((e) => b.restoreEntity(e)));
  },
};

/** The undo commands, for a document's `CommandRegistry`. */
export const UNDO_COMMANDS: readonly CommandDef[] = [UNDO, U, REDO, OOPS];
