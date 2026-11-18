// New drawings from templates (M5-10, DEC-024, UI_SPEC.md §9): the bundled Triya ISO (mm) and
// Triya ANSI (inch) templates (assets/templates, written by scripts/templates/build-templates.py)
// and the names new drawings get.
//
// AutoCAD 2024 Help, "NEW": the Select Template dialog box lists the templates and opens a new
// drawing from the one chosen; "QNEW" starts one from the default template (Options > Files >
// Template Settings > Default Template File Name for QNEW), or opens Select Template when none is
// set. A new drawing is "Drawing1.dwg", "Drawing2.dwg", …, untitled (DWGTITLED 0) until it is
// saved, so its first Save is a Save As. Triya's is a .dxf (DEC-047). Each template is a chunk of
// its own, loaded the first time it is used and cached with the app for offline use.

/** A template a new drawing can start from. */
export interface DrawingTemplate {
  /** The id the default-template setting keeps. */
  readonly id: string;
  /** As the Select Template dialog lists it. */
  readonly name: string;
  /** The template's file name. */
  readonly file: string;
  /** What it sets up, one line. */
  readonly description: string;
  /** The template's bytes, an AC1032 DXF. */
  load(): Promise<Uint8Array>;
}

const encoded = (m: { default: string }) => new TextEncoder().encode(m.default);

export const BUNDLED_TEMPLATES: readonly DrawingTemplate[] = [
  {
    id: 'triya-iso',
    name: 'Triya ISO (mm)',
    file: 'triya-iso.dxf',
    description:
      'Millimetres: ISO-25 dimension styles, drafting layers and text styles, A4 to A0 sheets with a title block and revision table.',
    load: () => import('../../../assets/templates/triya-iso.dxf?raw').then(encoded),
  },
  {
    id: 'triya-ansi',
    name: 'Triya ANSI (inch)',
    file: 'triya-ansi.dxf',
    description:
      'Inches: decimal-inch dimension styles, drafting layers and text styles, ANSI A to E sheets with a title block and revision table.',
    load: () => import('../../../assets/templates/triya-ansi.dxf?raw').then(encoded),
  },
];

/** The template QNEW and the start screen's New drawing use until the user picks another. */
export const DEFAULT_TEMPLATE_ID = 'triya-iso';

/** The template with `id`, if there is one. */
export function templateById(id: string): DrawingTemplate | undefined {
  return BUNDLED_TEMPLATES.find((t) => t.id === id);
}

/**
 * The name of the next new drawing: `Drawing<n>.dxf` for the lowest n no open drawing has, as
 * AutoCAD numbers them, matched whatever the case.
 */
export function newDrawingName(open: readonly string[]): string {
  const taken = new Set(open.map((n) => n.toUpperCase()));
  let n = 1;
  while (taken.has(`DRAWING${n}.DXF`)) n++;
  return `Drawing${n}.dxf`;
}

/**
 * The Select Template dialog while it is open, and what NEW waits for: the template chosen, or
 * undefined on Cancel.
 */
export const selectTemplate = (() => {
  let open = false;
  let done: ((t: DrawingTemplate | undefined) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (t: DrawingTemplate | undefined) => {
    const d = done;
    done = undefined;
    d?.(t);
  };
  return {
    isOpen: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(): Promise<DrawingTemplate | undefined> {
      finish(undefined);
      set(true);
      return new Promise((resolve) => (done = resolve));
    },
    close(chosen?: DrawingTemplate) {
      set(false);
      finish(chosen);
    },
  };
})();
