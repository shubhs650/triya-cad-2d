// The ribbon's Text Editor tab (M7-02 part 5; AutoCAD 2024 Help, "Text Editor Ribbon Contextual
// Tab"): it shows while MTEXT's in-place editor is open, and its buttons are the editor's Text
// Formatting toolbar's. The editor attaches its actions here as it opens and detaches as it
// closes; the ribbon shows the tab while one is attached and runs its buttons through it. The
// editor keeps its own selection, so a ribbon click formats the text the drafter selected.

/** The editor's actions the tab's buttons run. */
export const TEXT_EDITOR_ACTIONS = [
  'bold',
  'italic',
  'underline',
  'overline',
  'strike',
  'stack',
  'paragraph',
  'columns',
  'field',
  'spell',
  'close',
] as const;
export type TextEditorAction = (typeof TEXT_EDITOR_ACTIONS)[number];

export interface TextEditorState {
  /** The toggles on at the caret or across the selection, and the spell check. */
  readonly pressed: Partial<Record<TextEditorAction, boolean>>;
  /** Bold and italic need a TrueType font; Insert Field needs the editor to offer fields. */
  readonly disabled: Partial<Record<TextEditorAction, boolean>>;
}

interface Attached {
  readonly run: (action: TextEditorAction) => void;
  state: TextEditorState;
}

const EMPTY: TextEditorState = { pressed: {}, disabled: {} };
let attached: Attached | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export const textEditorBridge = {
  /** The editor opened: its actions, until `detach` with the same handle. */
  attach(run: (action: TextEditorAction) => void): object {
    const a: Attached = { run, state: EMPTY };
    attached = a;
    notify();
    return a;
  },
  detach(handle: object): void {
    if (attached !== handle) return;
    attached = undefined;
    notify();
  },
  /** The editor's toggles changed. */
  update(handle: object, state: TextEditorState): void {
    const a = attached;
    if (a === undefined || a !== handle) return;
    a.state = state;
    notify();
  },
  /** The open editor's state, or undefined with none open. */
  get(): TextEditorState | undefined {
    return attached?.state;
  },
  run(action: TextEditorAction): void {
    attached?.run(action);
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const textEditorActionOf = (action: string): TextEditorAction | undefined => {
  const a = action.startsWith('text:') ? action.slice('text:'.length) : undefined;
  return (TEXT_EDITOR_ACTIONS as readonly string[]).includes(a ?? '')
    ? (a as TextEditorAction)
    : undefined;
};
