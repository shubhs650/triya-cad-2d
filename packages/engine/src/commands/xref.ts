// XREF, -XREF, EXTERNALREFERENCES and EXTERNALREFERENCESCLOSE (M5-04 part 1; COMMANDS.md
// "Blocks and references"), with AutoCAD 2024's prompts (AutoCAD Help, "XREF (Command)",
// "-XREF (Command)", "EXTERNALREFERENCES (Command)"):
//
//   - XREF (XR) and EXTERNALREFERENCES (ER) open the External References palette, which is
//     Triya's References palette; EXTERNALREFERENCESCLOSE closes it.
//   - -XREF: "Enter an option [?/Detach/Unload/Reload]". `?` lists the xrefs whose names match
//     "Enter xref(s) to list <*>", each with its saved path, then "Total Xref(s): N". Detach,
//     Unload and Reload ask "Enter xref name(s) to detach" (to unload, to reload), names or
//     wildcard patterns separated by commas.
//
// Detach is one undo step (`detachXrefs`). Unload and Reload change what the drawing shows, not
// the drawing, and reloading reads a file, so the app does both (the `xref` view request), as
// the palette's buttons do. Only xrefs the drawing attaches itself are detached or unloaded
// (AutoCAD: "nested xrefs cannot be detached"); a nested one is reloaded with its own file.
// Left for later parts of M5-04: Bind, Path, Overlay and Attach (AutoCAD's default option).
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { BlockTableRecord } from '../model/types';
import { isXrefRecord, xrefBringing } from '../model/xref';
import { detachXrefs } from '../edit/xrefs';
import { wcmatch } from './modify/attributes';
import { viewRequest } from './view/zoom';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The drawing's xrefs, in block table order. */
function xrefsOf(ctx: CommandContext): BlockTableRecord[] {
  return [...ctx.model.tables.blockRecords.values()].filter((r) => isXrefRecord(r));
}

/** `?`: the xrefs whose names match, with their saved paths. */
async function* listXrefs(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter xref(s) to list',
    default: { kind: 'string', value: '*' },
  });
  if (a.kind !== 'string') return;
  const named = xrefsOf(ctx).filter((r) => wcmatch(r.name, a.value.trim() || '*'));
  if (named.length === 0) {
    ctx.message('No matching xref names found.');
    return;
  }
  const width = Math.max(20, ...named.map((r) => r.name.length + 2));
  ctx.message(`${'Xref Name'.padEnd(width)}Path`);
  ctx.message(`${'-'.repeat(width - 2).padEnd(width)}${'-'.repeat(19)}`);
  for (const r of named) {
    const def = ctx.model.blocks.get(r.handle);
    const kind = (r.flags ?? 0) & 8 ? '  (Overlay)' : '';
    ctx.message(`${r.name.padEnd(width)}${def?.xrefPath ?? ''}${kind}`);
  }
  ctx.message(`Total Xref(s): ${named.length}`);
}

/** "Enter xref name(s) to <verb>": the xrefs the patterns name, or undefined at Esc. */
async function* xrefNames(ctx: CommandContext, verb: string): Sub<BlockTableRecord[] | undefined> {
  const a = yield ctx.prompt.string({ message: `Enter xref name(s) to ${verb}` });
  if (a.kind !== 'string' || a.value.trim() === '') return undefined;
  const named = xrefsOf(ctx).filter((r) => wcmatch(r.name, a.value.trim()));
  if (named.length === 0) ctx.message('No matching xref names found.');
  return named;
}

/** Those of `named` the drawing attaches itself; each nested one is named and left out. */
function topLevel(ctx: CommandContext, named: readonly BlockTableRecord[], verb: string) {
  return named.filter((r) => {
    const parent = xrefBringing(ctx.model, r.handle);
    if (parent)
      ctx.message(`Xref "${r.name}" is nested in "${parent.name}" and cannot be ${verb}.`);
    return !parent;
  });
}

async function* dashXref(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter an option',
    options: ['?', 'Detach', 'Unload', 'Reload'],
  });
  if (a.kind !== 'keyword') return;
  if (a.keyword === '?') {
    yield* listXrefs(ctx);
    return;
  }
  const verb = a.keyword.toLowerCase();
  const named = yield* xrefNames(ctx, verb);
  if (!named || named.length === 0) return;
  if (a.keyword === 'Detach') {
    const going = topLevel(ctx, named, 'detached');
    if (going.length === 0) return;
    ctx.edit((b) =>
      detachXrefs(
        b,
        ctx.model,
        going.map((r) => r.handle),
      ),
    );
    for (const r of going) ctx.message(`Detaching Xref "${r.name}".`);
    return;
  }
  const blocks = (a.keyword === 'Unload' ? topLevel(ctx, named, 'unloaded') : named).map(
    (r) => r.handle,
  );
  if (blocks.length === 0) return;
  const reply = await viewRequest(ctx, {
    op: 'xref',
    action: a.keyword === 'Unload' ? 'unload' : 'reload',
    blocks,
  });
  if (!reply.ok) ctx.message(reply.message);
  else for (const m of reply.messages ?? []) ctx.message(m);
}

/** XREF (and -XREF), with AutoCAD's alias XR. */
export function xrefCommand(): CommandDef {
  return {
    name: 'XREF',
    dashVariant: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      if (ctx.dash) {
        yield* dashXref(ctx);
        return;
      }
      await viewRequest(ctx, { op: 'palette', palette: 'references', open: true });
    },
  };
}

function referencesPalette(name: string, open: boolean): CommandDef {
  return {
    name,
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host opens or closes the palette
    async *run(ctx) {
      await viewRequest(ctx, { op: 'palette', palette: 'references', open });
    },
  };
}

export const XREF_COMMANDS: readonly (() => CommandDef)[] = [
  xrefCommand,
  () => referencesPalette('EXTERNALREFERENCES', true),
  () => referencesPalette('EXTERNALREFERENCESCLOSE', false),
];
