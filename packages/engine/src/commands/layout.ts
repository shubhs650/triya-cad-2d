// LAYOUT (M6-01 part 1), with AutoCAD 2024's prompts (AutoCAD 2024 Help, "LAYOUT (Command)"):
//   Enter layout option [Copy/Delete/New/Template/Rename/SAveas/Set/?] <set>:
//   Enter name of new layout <Layout2>:                 (New: after the last tab)
//   Enter name of layout to delete <Layout1>:           (Delete: "The most current layout is
//                                                         the default")
//   Enter layout to rename <Layout1>:                   (Rename: "The last current layout is
//   Enter new layout name <Layout1>:                      used as the default")
//   Enter layout to make current <Layout1>:             (Set)
//   Enter name of layout to copy <Layout1>:             (Copy, part 2: "If you do not provide a
//   Enter layout name for copy <Layout1 (2)>:             name, the new layout assumes the name
//                                                         of the copied layout with an
//                                                         incremental number in parentheses. The
//                                                         new tab is inserted before the copied
//                                                         layout tab.")
// The layout tab's shortcut menu (New Layout, Delete) runs the same options. What making,
// deleting and naming a layout does is edit/layouts.ts's; each is one LAYOUT undo step.
//
// Ambiguities, settled for the common drafter expectation (Help gives the options, not the
// prompts or messages): "current" is the layout shown, or on the Model tab the drawing's current
// layout (the one on *Paper_Space); a name the drawing lacks says `No layout named "X".` and asks
// again; an invalid or taken name says why and asks again; deleting the layout shown shows the
// Model tab; ? lists the layout shown and every layout in tab order. Copy copies the layout shown
// by default (as Delete) and says what it copied; objects it cannot copy are listed as COPY lists
// them (`copyLayout`).
//
// Template and SAveas (M6-01 part 4, edit/layout-templates.ts) ask at the command line, as AutoCAD
// asks with FILEDIA 0 (Triya has no FILEDIA; the browser opens no path by itself):
//   Enter name of template file <~>:        Enter or ~: the Select Template From File and
//                                            Insert Layout(s) dialogs (the app's)
//   Enter layout name(s) or [?] <first>:    a file named: its layouts, by name (commas between
//                                            names, * all of them), found as -INSERT finds a file
//   Enter layout to save to template <layout shown>:
//   Enter template file name <layout.dxf>:  written as WBLOCK writes its new drawing (DXF, DEC-047)
// The layouts inserted go after the last tab, in one LAYOUT undo step, and are not shown.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Layout } from '../model/types';
import type { Clipboard } from '../edit/clipboard';
import {
  insertLayoutTemplate,
  layoutTemplate,
  templateLayoutName,
  templateMessages,
  type LayoutTemplateCopy,
} from '../edit/layout-templates';
import { insUnitsOf } from '../model/units';
import { carriedHeader } from './wblock';
import {
  addNewLayout,
  copyLayout,
  copyLayoutName,
  copyMessages,
  currentSheetLayout,
  deleteLayout,
  deleteLayoutProblem,
  isModelLayout,
  LAYOUT_MAX,
  layoutNamed,
  layoutNameProblem,
  nextLayoutName,
  paperLayouts,
} from '../edit/layouts';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const OPTIONS = ['Copy', 'Delete', 'New', 'Template', 'Rename', 'SAveas', 'Set', '?'];

const typed = (a: PromptAnswer): string => (a.kind === 'string' ? a.value.trim() : '');

/** The layout shown, else the drawing's current layout, else the first. */
function currentLayout(ctx: CommandContext): Layout | undefined {
  const sheets = paperLayouts(ctx.model);
  return (
    sheets.find((l) => l.blockRecord === ctx.space) ?? currentSheetLayout(ctx.model) ?? sheets[0]
  );
}

const modelLayout = (ctx: CommandContext) =>
  ctx.model.layouts.find((l) => isModelLayout(ctx.model, l));

/** A layout asked for by name (Model too when `model`), `fallback` on Enter; undefined on none. */
async function* layoutAsked(
  ctx: CommandContext,
  message: string,
  fallback: Layout | undefined,
  model = false,
): Sub<Layout | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message,
      spaces: true,
      ...(fallback && { default: { kind: 'string', value: fallback.name } }),
    });
    const name = typed(a);
    if (name === '') return fallback;
    const l = layoutNamed(ctx.model, name);
    if (l && (model || !isModelLayout(ctx.model, l))) return l;
    ctx.message(l ? 'The Model tab cannot be chosen here.' : `No layout named "${name}".`);
  }
}

/** A name for a layout (other than `self`): `fallback` on Enter, asked again while refused. */
async function* nameAsked(
  ctx: CommandContext,
  message: string,
  fallback: string,
  self?: Layout,
): Sub<string> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message,
      spaces: true,
      default: { kind: 'string', value: fallback },
    });
    const name = typed(a) || fallback;
    if (self && name === self.name) return name;
    const problem = layoutNameProblem(ctx.model, name, self);
    if (!problem) return name;
    ctx.message(problem);
  }
}

async function* newLayout(ctx: CommandContext): Sub<void> {
  if (paperLayouts(ctx.model).length >= LAYOUT_MAX) {
    ctx.message(`A drawing can have ${LAYOUT_MAX} layouts at most.`);
    return;
  }
  const name = yield* nameAsked(ctx, 'Enter name of new layout', nextLayoutName(ctx.model));
  ctx.edit((b) => addNewLayout(b, ctx.model, name));
}

async function* copyAsked(ctx: CommandContext): Sub<void> {
  if (paperLayouts(ctx.model).length >= LAYOUT_MAX) {
    ctx.message(`A drawing can have ${LAYOUT_MAX} layouts at most.`);
    return;
  }
  const source = yield* layoutAsked(ctx, 'Enter name of layout to copy', currentLayout(ctx));
  if (!source) return;
  const name = yield* nameAsked(
    ctx,
    'Enter layout name for copy',
    copyLayoutName(ctx.model, source),
  );
  let lines: string[] = [];
  ctx.edit((b) => {
    lines = copyMessages(copyLayout(b, ctx.model, source, name));
  });
  for (const line of lines) ctx.message(line);
  ctx.message(`Layout "${source.name}" copied to "${name}".`);
}

async function* deleteAsked(ctx: CommandContext): Sub<void> {
  const layout = yield* layoutAsked(ctx, 'Enter name of layout to delete', currentLayout(ctx));
  if (!layout) return;
  const problem = deleteLayoutProblem(ctx.model, layout);
  if (problem) {
    ctx.message(problem);
    return;
  }
  const shown = layout.blockRecord === ctx.space;
  const only = paperLayouts(ctx.model).length === 1;
  // The layout shown goes: the Model tab shows first (the only layout stays, emptied).
  if (shown && !only) await showTab(ctx, modelLayout(ctx)?.name ?? 'Model');
  ctx.edit((b) => deleteLayout(b, ctx.model, layout));
  ctx.message(`Layout "${layout.name}" deleted.`);
}

async function* rename(ctx: CommandContext): Sub<void> {
  const layout = yield* layoutAsked(ctx, 'Enter layout to rename', currentLayout(ctx));
  if (!layout) return;
  const name = yield* nameAsked(ctx, 'Enter new layout name', layout.name, layout);
  if (name === layout.name) return;
  ctx.edit((b) => b.updateLayout(layout.handle, { name }));
  ctx.message(`Layout "${layout.name}" renamed to "${name}".`);
}

/** Shows the tab of the layout named `name` (the app's), saying why not when it cannot. */
async function showTab(ctx: CommandContext, name: string): Promise<void> {
  const r = await ctx.view.request({ op: 'tab', name });
  if (!r.ok) ctx.message(r.message);
}

async function* setLayout(ctx: CommandContext): Sub<void> {
  const shown = ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
  const layout = yield* layoutAsked(ctx, 'Enter layout to make current', shown, true);
  if (!layout || layout === shown) return;
  await showTab(ctx, layout.name);
}

function list(ctx: CommandContext): void {
  const shown = ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
  if (shown) ctx.message(`Active Layout: ${shown.name}`);
  for (const l of ctx.model.layouts) ctx.message(l.name);
}

/** A file name as typed: without the quotes that keep its spaces. */
const unquoted = (s: string): string =>
  s
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();

/** The layouts of the file the drafter picks or names, and the file's name; none: cancelled. */
async function* templateFile(
  ctx: CommandContext,
): Sub<{ name: string; layouts: readonly LayoutTemplateCopy[]; picked: boolean } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter name of template file',
      defaultLabel: '~',
      spaces: true,
    });
    if (a.kind !== 'string' && a.kind !== 'enter') return undefined;
    const file = a.kind === 'string' ? unquoted(a.value) : '';
    const dialog = file === '' || file === '~';
    const r = await ctx.view.request(dialog ? { op: 'layoutFile' } : { op: 'layoutFile', file });
    if (!r.ok) {
      ctx.message(r.message);
      return undefined;
    }
    if (r.layoutFile) return { ...r.layoutFile, picked: dialog };
    if (dialog) return undefined;
    ctx.message(`Cannot find the file "${file}".`);
  }
}

/** The layouts named among `layouts` (commas between names, * all), asked again while unknown. */
async function* layoutsPicked(
  ctx: CommandContext,
  file: string,
  layouts: readonly LayoutTemplateCopy[],
): Sub<LayoutTemplateCopy[] | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter layout name(s) or [?]',
      spaces: true,
      default: { kind: 'string', value: layouts[0]!.template.name },
    });
    if (a.kind !== 'string' && a.kind !== 'enter') return undefined;
    const typed = a.kind === 'string' ? a.value.trim() : '';
    if (typed === '?') {
      for (const l of layouts) ctx.message(l.template.name);
      continue;
    }
    if (typed === '*') return [...layouts];
    const names = (typed || layouts[0]!.template.name).split(',').map((n) => n.trim());
    const picked: LayoutTemplateCopy[] = [];
    const missing = names.find((n) => {
      const l = layouts.find((x) => x.template.name.toUpperCase() === n.toUpperCase());
      if (l && !picked.includes(l)) picked.push(l);
      return n !== '' && !l;
    });
    if (missing === undefined && picked.length > 0) return picked;
    ctx.message(`No layout named "${missing ?? ''}" in ${file}.`);
  }
}

async function* template(ctx: CommandContext): Sub<void> {
  const file = yield* templateFile(ctx);
  if (!file) return;
  if (file.layouts.length === 0) {
    ctx.message(`${file.name} has no layouts.`);
    return;
  }
  const picked = file.picked
    ? [...file.layouts]
    : yield* layoutsPicked(ctx, file.name, file.layouts);
  if (!picked || picked.length === 0) return;
  if (paperLayouts(ctx.model).length + picked.length > LAYOUT_MAX) {
    ctx.message(`A drawing can have ${LAYOUT_MAX} layouts at most.`);
    return;
  }
  const taken = new Set<string>();
  const names: string[] = [];
  ctx.edit((b) => {
    for (const c of picked) {
      const name = templateLayoutName(ctx.model, c.template.name, taken);
      taken.add(name.toUpperCase());
      names.push(name);
      insertLayoutTemplate(b, ctx.model, c.template, name);
    }
  });
  for (const line of templateMessages(picked, 'inserted')) ctx.message(line);
  const n = names.length;
  ctx.message(`Inserted ${n} layout${n === 1 ? '' : 's'} from ${file.name}: ${names.join(', ')}.`);
}

/** Nothing: the model space of SAveas's new drawing. */
const NOTHING: Clipboard = {
  base: { x: 0, y: 0 },
  entities: [],
  blockEntities: [],
  tables: {},
  blocks: [],
};

/** The file SAveas writes: DXF (DEC-047) whatever extension was typed. */
const templateFileName = (typed: string): string =>
  `${unquoted(typed)
    .replace(/\.(dxf|dwg|dwt)$/i, '')
    .trim()}.dxf`;

async function* saveAs(ctx: CommandContext): Sub<void> {
  const layout = yield* layoutAsked(ctx, 'Enter layout to save to template', currentLayout(ctx));
  if (!layout) return;
  const fallback = templateFileName(layout.name);
  const a = yield ctx.prompt.string({
    message: 'Enter template file name',
    spaces: true,
    default: { kind: 'string', value: fallback },
  });
  if (a.kind !== 'string' && a.kind !== 'enter') return;
  const typed = a.kind === 'string' ? unquoted(a.value) : '';
  const file = typed === '' ? fallback : templateFileName(typed);
  const copy = layoutTemplate(ctx.model, layout);
  const header = carriedHeader(ctx.model);
  header['$INSUNITS'] = insUnitsOf(ctx.model);
  const reply = await ctx.view.request({
    op: 'writeBlock',
    file,
    drawing: { content: NOTHING, header, layout: copy.template },
  });
  if (!reply.ok) {
    ctx.message(reply.message);
    return;
  }
  for (const line of templateMessages([copy], 'written')) ctx.message(line);
  ctx.message(`Wrote ${reply.file ?? file}.`);
}

export function layoutCommand(): CommandDef {
  return {
    name: 'LAYOUT',
    async *run(ctx) {
      const a = yield ctx.prompt.keyword({
        message: 'Enter layout option',
        options: OPTIONS,
        default: { kind: 'keyword', keyword: 'Set' },
      });
      const option = a.kind === 'keyword' ? a.keyword : a.kind === 'enter' ? 'Set' : undefined;
      switch (option) {
        case 'New':
          yield* newLayout(ctx);
          return;
        case 'Delete':
          yield* deleteAsked(ctx);
          return;
        case 'Rename':
          yield* rename(ctx);
          return;
        case 'Set':
          yield* setLayout(ctx);
          return;
        case '?':
          list(ctx);
          return;
        case 'Copy':
          yield* copyAsked(ctx);
          return;
        case 'Template':
          yield* template(ctx);
          return;
        case 'SAveas':
          yield* saveAs(ctx);
          return;
      }
    },
  };
}
