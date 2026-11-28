// The start screen's Open PDF (M7-07, PRD FR-Z2 "open PDF directly from the start screen,
// calibrate scale with two picks, mark up, print", UI_SPEC.md §10): the PDF picked opens in a new
// drawing, its first page attached by -PDFATTACH with its lower-left corner at the origin, at its
// printed size (scale 1: a page inch is an inch, or 25.4 units in a millimetre drawing,
// `underlayScaleFor`), and the drawing zoomed to it. The drawing then offers to calibrate the
// page's scale, for a PDF plotted to a scale: SCALE on the underlay about the origin, Reference,
// whose "Specify reference length" takes the two picks (PDFOSNAP snaps them to the page's lines)
// and "Specify new length" the distance they really are, as pdf-calibrate.spec.ts does it by
// hand. AutoCAD has no calibration command; this is that same SCALE Reference, typed for the
// drafter up to the picks.
//
// The answers are typed at the prompts they are meant for, matched by the prompt's message: a
// prompt that is not the one expected (the file not found, a preselection that skips "Select
// objects") stops the script, so nothing is ever typed into the wrong prompt. "Select objects"
// takes Last, which is the underlay only while nothing was drawn after it: the selection is
// checked before it is kept, and the offer goes once the drawing's objects change.
//
// M8-04 (FR-Z2's "mark up, print"): calibrated, or not (Not now), the drawing goes on to the
// markup. -LAYER makes layer REDLINE (colour 1, red) current, so whatever the drafter draws over
// the page is red and can be turned off or frozen to see the page alone, as a red-line layer is
// in a drafting office (AutoCAD has no red-line command: Markup Import works on DWFs). A
// calibrated page is then zoomed to at its new size. The card offers Revision Cloud, Text,
// Leader and Plot... (the Plot dialog plots the underlay's page with the markup, M2-16 part 5)
// until Done; the drawing's edits no longer withdraw it.
import type { CommandInput, CommandOutput, EntityGeometry, EntityId } from '@triya/engine';

/** A PDF page's size in inches (pdf.js, underlay/pages.ts). */
export interface PdfPageSize {
  readonly width: number;
  readonly height: number;
}

type Underlay = Extract<EntityGeometry, { kind: 'PDFUNDERLAY' }>;

/** What a drawing opened from a PDF is doing; undefined once there is nothing to show. */
export type RedlineState =
  | { readonly phase: 'attaching'; readonly file: string }
  | { readonly phase: 'offer'; readonly file: string; readonly note?: string }
  | { readonly phase: 'calibrating'; readonly file: string }
  /** `ready` once REDLINE is current (-LAYER has ended): the markup buttons wait for it. */
  | { readonly phase: 'markup'; readonly file: string; readonly ready: boolean }
  | { readonly phase: 'failed'; readonly file: string; readonly message: string };

/** One answer of a script: typed at the prompt whose message starts with `prompt`. */
interface Step {
  readonly prompt: string;
  readonly answer: string;
  /** Checked before answering: false cancels the command instead. */
  readonly check?: () => boolean;
}

interface Run {
  state: RedlineState;
  /** The answers still to type, in order; empty when the drafter has the prompts. */
  steps: Step[];
  underlay?: EntityId;
  /** Its geometry as attached, and its page's size: where ZOOM shows it. */
  geometry?: Underlay;
  page?: PdfPageSize;
  /** The set the running "Select objects" has built (SCALE's Last). */
  selected: readonly EntityId[];
  /** Sent when the command the steps answer ends (the ZOOM after -LAYER). */
  after?: CommandInput[];
}

const submit = (text: string): CommandInput => ({ kind: 'submit', text });

/** The layer the markup goes on, and its colour (ACI 1, red). */
export const REDLINE_LAYER = 'REDLINE';

/** -LAYER's answers: Make REDLINE (current), Color 1 on it, then Enter to end. */
const LAYER_STEPS: readonly Step[] = [
  { prompt: 'Enter an option', answer: 'M' },
  { prompt: 'Enter name for new layer', answer: REDLINE_LAYER },
  { prompt: 'Enter an option', answer: 'C' },
  { prompt: 'New color', answer: '1' },
  { prompt: 'Enter name list of layer(s) for color', answer: REDLINE_LAYER },
  { prompt: 'Enter an option', answer: '' },
];

const NOT_LAST =
  'The PDF is no longer the last object drawn: select it for SCALE and use its Reference option.';

export class Redline {
  readonly #runs = new Map<number, Run>();
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get = (doc: number): RedlineState | undefined => this.#runs.get(doc)?.state;

  /** Starts attaching `file`, already supplied, in new drawing `doc`: the input to send. */
  begin(doc: number, file: string, page?: PdfPageSize): CommandInput[] {
    this.#set(doc, {
      ...(page && { page }),
      state: { phase: 'attaching', file },
      // A name in double quotes is taken whole (spaces), as -PDFATTACH reads it.
      steps: [
        { prompt: 'Path to PDF file to attach', answer: `"${file}"` },
        { prompt: 'Enter page number', answer: '' },
        { prompt: 'Specify insertion point', answer: '0,0' },
        { prompt: 'Specify scale factor', answer: '' },
        { prompt: 'Specify rotation', answer: '' },
      ],
      selected: [],
    });
    return [submit('-PDFATTACH')];
  }

  /** The offer's Calibrate scale: the input to send (none when there is no offer). */
  calibrate(doc: number): CommandInput[] {
    const run = this.#runs.get(doc);
    if (run?.state.phase !== 'offer') return [];
    const underlay = run.underlay;
    run.state = { phase: 'calibrating', file: run.state.file };
    run.selected = [];
    run.steps = [
      { prompt: 'Select objects', answer: 'L' },
      {
        prompt: 'Select objects',
        answer: '',
        check: () => run.selected.length === 1 && run.selected[0] === underlay,
      },
      { prompt: 'Specify base point', answer: '0,0' },
      { prompt: 'Specify scale factor or', answer: 'R' },
    ];
    this.#changed();
    // Esc first: with PICKFIRST a preselection would be scaled with no "Select objects".
    return [{ kind: 'cancel' }, submit('SCALE')];
  }

  /** The offer's Not now: on to the markup at the printed size (none when there is no offer). */
  skip(doc: number): CommandInput[] {
    const run = this.#runs.get(doc);
    if (run?.state.phase !== 'offer') return [];
    // Esc first: a command left running would take -LAYER as its answer.
    return [{ kind: 'cancel' }, ...this.#markup(run)];
  }

  /** The markup's Done, or the failure's Close. */
  dismiss(doc: number): void {
    if (this.#runs.delete(doc)) this.#changed();
  }

  /** Follows drawing `doc`'s command output: the input to send in reply. */
  output(doc: number, o: CommandOutput): CommandInput[] {
    const run = this.#runs.get(doc);
    if (!run) return [];
    const { state } = run;
    if (o.type === 'selection') run.selected = o.ids;
    else if (o.type === 'prompt' && run.steps.length > 0) {
      const step = run.steps[0]!;
      if (!o.prompt.message.startsWith(step.prompt)) {
        run.steps = [];
        return [];
      }
      run.steps.shift();
      if (step.check && !step.check()) {
        run.steps = [];
        this.#phase(run, { phase: 'offer', file: state.file, note: NOT_LAST });
        return [{ kind: 'cancel' }];
      }
      return [submit(step.answer)];
    } else if (o.type === 'change') {
      const added = o.change.entities?.added ?? [];
      const underlay = added.find((a) => a.entity.geom.kind === 'PDFUNDERLAY');
      if (state.phase === 'attaching' && underlay) {
        run.underlay = underlay.entity.id;
        run.geometry = underlay.entity.geom as Underlay;
      } else if (state.phase === 'calibrating') {
        // SCALE's result: where the page now is, for the ZOOM after.
        const scaled = o.change.entities?.updated?.find((u) => u.after.id === run.underlay);
        if (scaled?.after.geom.kind === 'PDFUNDERLAY') run.geometry = scaled.after.geom;
      }
      // Edited since: Last may no longer be the underlay, so the offer goes.
      else if (state.phase === 'offer' && o.change.entities) this.dismiss(doc);
    } else if (o.type === 'end') {
      if (state.phase === 'attaching') {
        run.steps = [];
        if (run.underlay === undefined) {
          this.#phase(run, {
            phase: 'failed',
            file: state.file,
            message: `${state.file} could not be attached: see the command line.`,
          });
          return [];
        }
        this.#phase(run, { phase: 'offer', file: state.file });
        return [submit('ZOOM'), ...zoomTo(run.geometry, run.page)];
      }
      if (state.phase === 'calibrating') {
        run.steps = [];
        if (o.cancelled) {
          this.#phase(run, { phase: 'offer', file: state.file });
          return [];
        }
        const markup = this.#markup(run);
        run.after = [submit('ZOOM'), ...zoomTo(run.geometry, run.page)];
        return markup;
      }
      if (state.phase === 'markup') {
        run.steps = [];
        const after = run.after ?? [];
        delete run.after;
        if (!state.ready) this.#phase(run, { ...state, ready: true });
        return after;
      }
    }
    return [];
  }

  /** On to the markup: -LAYER, with its answers to type. */
  #markup(run: Run): CommandInput[] {
    run.steps = [...LAYER_STEPS];
    this.#phase(run, { phase: 'markup', file: run.state.file, ready: false });
    return [submit('-LAYER')];
  }

  #phase(run: Run, state: RedlineState): void {
    run.state = state;
    this.#changed();
  }

  #set(doc: number, run: Run): void {
    this.#runs.set(doc, run);
    this.#changed();
  }

  #changed(): void {
    for (const l of this.#listeners) l();
  }
}

export const redline = new Redline();

/**
 * ZOOM's answers that show the page attached: Window on its frame and a twentieth of it around
 * (attached unrotated). ZOOM Extents would miss the page until pdf.js has drawn it, so it is the
 * fallback only when the page's size is not known.
 */
function zoomTo(u: Underlay | undefined, page: PdfPageSize | undefined): CommandInput[] {
  if (!u || !page) return [submit('E')];
  const w = page.width * u.scale.x;
  const h = page.height * u.scale.y;
  const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const corner = (x: number, y: number) => submit(`${n(x)},${n(y)}`);
  return [
    corner(u.position.x - w / 20, u.position.y - h / 20),
    corner(u.position.x + w * 1.05, u.position.y + h * 1.05),
  ];
}

/**
 * The new drawing's name: the PDF's, as a .dxf (its first Save is still a Save As), or
 * `fallback` (Drawing<n>.dxf) when a drawing open or opening has it.
 */
export function redlineDrawingName(
  pdf: string,
  taken: readonly string[],
  fallback: string,
): string {
  const name = `${pdf.replace(/\.pdf$/i, '')}.dxf`;
  const key = name.toLowerCase();
  return taken.some((t) => t.toLowerCase() === key) ? fallback : name;
}
