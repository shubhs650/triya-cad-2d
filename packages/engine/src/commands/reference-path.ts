// -XREF Path and Pathtype, and the References palette's Saved Path (M5-04 part 15; edits in
// edit/reference-path.ts). AutoCAD 2024 Help, "-XREF (Command)": Path "displays and edits the
// path name associated with a particular DWG reference"; Pathtype gives the xrefs named a Full,
// Relative or None path ("Edit xref name(s) to edit path type", "New path type"). The help does
// not show Path's prompts; these are AutoCAD's command line's ("Edit path for which xref(s)",
// then "Xref name:", "Old path:" and "Enter new path:" for each).
//
// Every path changed is one undo step, with the loads it brings: an xref given a new path is
// reloaded from it (the help's "the program reloads the xref"), through the app's `xref` attach
// request, whose loads join the step as XATTACH's do; U puts the old path back with what the old
// file showed. Triya finds files by name, a browser telling no folder, so Pathtype Full and
// Relative are refused with the reason, and None keeps the file name alone (REFPATHTYPE 0).
// "Pathtype" is offered as pathType, so P stays Path's shortcut and T is its own.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { BlockTableRecord } from '../model/types';
import { isXrefRecord } from '../model/xref';
import {
  referencePath,
  referencePathProblem,
  setReferencePath,
  typedPath,
  withoutFolder,
} from '../edit/reference-path';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** A reference and the saved path it is to have. */
export interface ReferencePathEdit {
  /** An xref's block record, or an image's or PDF's definition. */
  readonly handle: Handle;
  readonly path: string;
}

/**
 * Gives each reference its path, one undo step, saying why one cannot have it; then has the app
 * load each xref that now waits for its file from the new path, with what the app said of it.
 */
export async function changeReferencePaths(
  ctx: CommandContext,
  edits: readonly ReferencePathEdit[],
): Promise<void> {
  const going = edits.filter((e) => {
    const problem = referencePathProblem(ctx.model, e.handle, e.path);
    if (problem) ctx.message(problem);
    return !problem && referencePath(ctx.model, e.handle) !== e.path;
  });
  if (going.length === 0) return;
  ctx.edit((b) => {
    for (const e of going) setReferencePath(b, ctx.model, e.handle, e.path);
  });
  const blocks = going
    .map((e) => e.handle)
    .filter((h) => {
      const def = ctx.model.blocks.get(h);
      return def !== undefined && !def.xrefUnloaded && !def.xrefLoaded;
    });
  if (blocks.length === 0) return;
  const reply = await ctx.view.request({ op: 'xref', action: 'attach', blocks });
  if (!reply.ok) ctx.message(reply.message);
  else for (const m of reply.messages ?? []) ctx.message(m);
}

/** The drawing's xrefs the patterns of `text` name, in block table order. */
function xrefsNamed(ctx: CommandContext, text: string): BlockTableRecord[] {
  const named = [...ctx.model.tables.blockRecords.values()].filter(
    (r) => isXrefRecord(r) && wcmatch(r.name, text.trim()),
  );
  if (named.length === 0) ctx.message('No matching xref names found.');
  return named;
}

/** -XREF Path: for each xref named, its old path shown and a new one asked. */
export async function* dashXrefPath(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({ message: 'Edit path for which xref(s)' });
  if (a.kind !== 'string' || a.value.trim() === '') return;
  const edits: ReferencePathEdit[] = [];
  for (const r of xrefsNamed(ctx, a.value)) {
    const old = referencePath(ctx.model, r.handle) ?? '';
    ctx.message(`Xref name: ${r.name}`);
    ctx.message(`Old path: ${old}`);
    // A nested xref's path is its parent file's: said once, nothing asked.
    const problem = referencePathProblem(ctx.model, r.handle, old || r.name);
    if (problem) {
      ctx.message(problem);
      continue;
    }
    const p = yield ctx.prompt.string({ message: 'Enter new path', spaces: true });
    if (p.kind !== 'string') return;
    const path = typedPath(p.value);
    // Enter keeps the path it has.
    if (path !== '' && path !== old) edits.push({ handle: r.handle, path });
  }
  await changeReferencePaths(ctx, edits);
}

/** -XREF Pathtype: the xrefs named given a path of the type asked. */
export async function* dashXrefPathtype(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({ message: 'Edit xref name(s) to edit path type' });
  if (a.kind !== 'string' || a.value.trim() === '') return;
  const named = xrefsNamed(ctx, a.value);
  if (named.length === 0) return;
  const t = yield ctx.prompt.keyword({
    message: 'New path type',
    options: ['Full', 'Relative', 'None'],
    default: { kind: 'keyword', keyword: 'None' },
  });
  if (t.kind !== 'keyword') return;
  if (t.keyword !== 'None') {
    ctx.message(
      `Triya cannot make a ${t.keyword.toLowerCase()} path: the browser does not tell which folder a file is in.`,
    );
    return;
  }
  const edits: ReferencePathEdit[] = [];
  for (const r of named) {
    const old = referencePath(ctx.model, r.handle) ?? '';
    const problem = referencePathProblem(ctx.model, r.handle, old || r.name);
    if (problem) ctx.message(problem);
    else if (withoutFolder(old) === old) ctx.message(`Xref "${r.name}" has no path: ${old}`);
    else {
      edits.push({ handle: r.handle, path: withoutFolder(old) });
      ctx.message(`Xref "${r.name}" path changed to ${withoutFolder(old)}`);
    }
  }
  await changeReferencePaths(ctx, edits);
}

/**
 * The References palette's Saved Path, its Browse... and Remove Path (`PromptBus.referencePath`):
 * an XREF undo step the command line does not echo.
 */
export function referencePathCommand(edits: readonly ReferencePathEdit[]): CommandDef {
  return {
    name: 'XREF',
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the palette gave the paths
    async *run(ctx) {
      await changeReferencePaths(ctx, edits);
    },
  };
}
