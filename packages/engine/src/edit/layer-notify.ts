// The alert for unreconciled new layers (M5-19 part 4; AutoCAD 2024 Help, "LAYERNOTIFY":
// "Specifies when an alert displays for new layers that have not yet been reconciled", the sum of
// 1 Plot, 2 Open, 4 Load/Reload/Attach for xrefs, 8 Restore layer state, 16 Save and 32 Insert;
// "About Receiving Notification of New Layers": the status bar's Unreconciled New Layers icon and
// its notification balloon). The app raises it after each of those events: the engine says
// whether the drawing asks for it there and which layers it names.
//
// Help sets the alert under layer evaluation ("LAYEREVALCTL": 0 "Disables the evaluation and
// notification of new layers"; the Layer Settings dialog greys "Notify when new layers are
// present" while "Evaluate new layers added to drawing" is off), so nothing alerts while
// `layerEvaluation` is 0.
//
// Insert: Help names no commands. Triya takes the commands that can bring another drawing's
// layers in, those whose pastes LAYEREVAL 2 evaluates (part 3): INSERT (and -INSERT, which
// commits under it), PASTECLIP, PASTEORIG, PASTEBLOCK and DesignCenter's drops (ADCENTER).
import type { HeaderValue, LayerRecord } from '../model/types';
import { layerEvaluation } from '../model/xref';

/** What can raise the alert, as LAYERNOTIFY's bits name them. */
export type LayerNotifyEvent = 'plot' | 'open' | 'xref' | 'layer-state' | 'save' | 'insert';

/** LAYERNOTIFY's bit for each event (AutoCAD 2024 Help). */
export const LAYER_NOTIFY_BITS: Readonly<Record<LayerNotifyEvent, number>> = {
  plot: 1,
  open: 2,
  xref: 4,
  'layer-state': 8,
  save: 16,
  insert: 32,
};

const INSERT_COMMANDS: ReadonlySet<string> = new Set([
  'ADCENTER',
  'INSERT',
  'PASTEBLOCK',
  'PASTECLIP',
  'PASTEORIG',
]);

/** The event a command that edited the drawing (its undo step's name) is, if it is one. */
export function layerNotifyEventOf(command: string): LayerNotifyEvent | undefined {
  return INSERT_COMMANDS.has(command.toUpperCase()) ? 'insert' : undefined;
}

/**
 * The unreconciled layers' names, sorted, when the drawing alerts for them on `event`: its
 * LAYERNOTIFY has the event's bit and its layers are evaluated; none otherwise.
 */
export function layerNotice(
  drawing: {
    readonly header: ReadonlyMap<string, HeaderValue>;
    readonly layers: Iterable<LayerRecord>;
  },
  event: LayerNotifyEvent,
): string[] {
  const notify = Number(drawing.header.get('LAYERNOTIFY') ?? 0);
  if (!Number.isInteger(notify) || (notify & LAYER_NOTIFY_BITS[event]) === 0) return [];
  if (layerEvaluation(drawing) === 0) return [];
  return [...drawing.layers]
    .filter((l) => l.unreconciled === true)
    .map((l) => l.name)
    .sort((a, b) => a.localeCompare(b));
}
