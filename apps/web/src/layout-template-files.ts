// LAYOUT Template's files (M6-01 part 4). The browser opens no path by itself, so a template file
// named at the command line is found among what the app already holds (the drawings open, as they
// stand, and the files given for xrefs), as -INSERT finds a drawing file (block-files.ts); Enter
// opens the Insert Layout(s) dialog, where the drafter picks the file and its layouts.
import {
  fileBlockName,
  layoutTemplates,
  type DocumentModel,
  type LayoutTemplateCopy,
  type ViewReply,
} from '@triya/engine';
import type { HeldDrawing } from './block-files';

/**
 * The reply to LAYOUT Template's `layoutFile` with a file named: every layout of the drawing
 * `file` names (folders and extension aside, any case), the first held by that name; no
 * `layoutFile` when none is.
 */
export async function layoutFileReply(
  file: string,
  held: readonly HeldDrawing[],
): Promise<ViewReply> {
  const key = fileBlockName(file).toUpperCase();
  const found = held.find((h) => fileBlockName(h.name).toUpperCase() === key);
  if (!found) return { ok: true };
  try {
    const layouts = layoutTemplates(await found.model());
    return { ok: true, layoutFile: { name: found.name, layouts } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${found.name} could not be read: ${reason}` };
  }
}

/** A template file read in the Insert Layout(s) dialog: its name and layouts. */
export interface TemplateFile {
  readonly name: string;
  readonly layouts: readonly LayoutTemplateCopy[];
}

/** The template file `model` (read from `name`) as the dialog lists it. */
export const templateFile = (name: string, model: DocumentModel): TemplateFile => ({
  name,
  layouts: layoutTemplates(model),
});

/**
 * The Insert Layout(s) dialog, which LAYOUT Template opens and waits for: OK answers the file's
 * layouts picked, Cancel (or Esc) answers none.
 */
export const insertLayoutsDialog = (() => {
  let open: { readonly doc: number } | undefined;
  let done: ((reply: ViewReply) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: typeof open) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (reply: ViewReply) => {
    const d = done;
    done = undefined;
    set(undefined);
    d?.(reply);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens the dialog; resolves with OK's layouts, or `{ ok: true }` for Cancel. */
    show(doc: number): Promise<ViewReply> {
      finish({ ok: true });
      set({ doc });
      return new Promise((resolve) => (done = resolve));
    },
    /** OK: `picked` of `file`; without, Cancel. */
    close(file?: TemplateFile, picked?: readonly string[]) {
      if (!file || !picked) {
        finish({ ok: true });
        return;
      }
      const layouts = file.layouts.filter((l) => picked.includes(l.template.name));
      finish({ ok: true, layoutFile: { name: file.name, layouts } });
    },
  };
})();
