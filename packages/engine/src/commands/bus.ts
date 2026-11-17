// The PromptBus (M2-01, ARCHITECTURE.md §5.1): runs the commands of one document and is the one
// way into them. Front-ends (the command line, Dynamic Input, the Ctrl+K palette, tests) send
// typed text (`submit`), direct answers such as picked points (`answer`) and Esc (`cancel`), and
// listen for prompts, command-line lines, previews and each finished command's change sets.
//
// The bus owns what AutoCAD does around every command: Enter repeats the last command, Esc
// cancels, defaults, transparent commands (`'ZOOM`), the point modifiers FROM, M2P and `.X`
// filters, direct distance entry, two-point distances and angles, and the history (F2).
//
// It owns selection too (M2-03): a command's "Select objects" prompt is built pick by pick here
// (`SelectionLoop`), picks and windows made at `Command:` are the pre-selection (PICKFIRST) the
// next command that selects takes, and the set it last selected is the Previous set.
import type { DeferredPick } from '../geom/deferred';
import type { Vec2 } from '../geom/types';
import { OSNAP, type DeferredModes } from '../input/osnap';
import { orthoPoint } from '../input/constrain';
import { toUcs, toWorld, ucsOf, type PlanUcs } from '../input/ucs';
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import {
  DEFAULT_GROUPDISPLAYMODE,
  DEFAULT_PICKADD,
  DEFAULT_PICKAUTO,
  DEFAULT_PICKSTYLE,
  GROUP_SELECTION,
  PICKADD,
  PICKAUTO,
  PICKSTYLE,
  type PickVariable,
  SelectionLoop,
  type Lasso,
  type StepResult,
} from '../selection/loop';
import { onLockedLayers } from '../selection/rules';
import type { Entity, EntityGeometry } from '../model/types';
import { hasEditableAttributes } from './modify/attributes';
import { editContents, textEdited } from './draw/text';
import {
  prompts,
  type Clock,
  type CommandContext,
  type CommandDef,
  type CommandGenerator,
  type CommandRegistry,
  type ResolvedCommand,
} from './command';
import { blocklessDimensionBlocks, regenerateRestyled } from './modify/dimensions';
import { followAssociations } from './modify/array';
import { applyProperty } from './modify/property-edit';
import {
  DEFAULT_ANGLES,
  parseAngle,
  parseCoordinate,
  parseDistance,
  parseNumber,
  parseOsnapOverride,
  parsePointModifier,
  type AngleConvention,
  type CoordinateContext,
  type PointModifier,
} from './parse';
import {
  answerFits,
  formatAnswer,
  formatPrompt,
  matchKeyword,
  type PointPrompt,
  type Prompt,
  type PromptAnswer,
  type SelectionTake,
  type SelectionWindow,
} from './prompt';
import { NO_VIEW, waitsOnApp, type ViewHost, type ViewReply, type ViewRequest } from './view/host';
import { drawingUnits, type DrawingUnits } from './units';
import { GRIP_OBJECT_LIMIT, gripCommand } from './modify/grips';
import { gripMenuAt } from './modify/grip-functions';
import { gripsOf } from '../edit/grips';
import { tableCellCommand, tableCellUnder } from './draw/table-cell-menu';
import { variableCommand } from './setvar';
import { systemVariable } from './sysvars';
import { gripInfoOf } from '../edit/array-grips';
import type { DimensionRegenerator } from '../edit/dimension-block';
import type { HatchLinesOf } from '../edit/explode';
import type { SpellService } from '../edit/spelling';
import { distance } from '../geom/vec';
import { wholeGroups } from '../edit/groups';
import type { DragPreview } from './drag';
import type { CommandPreview, PreviewQuery } from './command-preview';
import { UndoStack, type UndoAction, type UndoState } from './undo';
import type { PropertyEdit } from '../properties/edit';
import { filtered } from '../properties/sheet';
import { textOf } from '../properties/multileader';
import type { EntityType } from '../model/types';

/**
 * What a double click on an object of each type runs (AutoCAD's DBLCLKEDIT; its CUI's
 * "Double Click Actions"). Types not listed open nothing yet.
 */
export const DOUBLE_CLICK: Readonly<Record<string, string>> = {
  TEXT: 'TEXTEDIT',
  MTEXT: 'TEXTEDIT',
  ATTDEF: 'TEXTEDIT',
  INSERT: 'EATTEDIT',
  // A multileader's text opens in the In-Place Text Editor (M2-25).
  MULTILEADER: 'TEXTEDIT',
  // A dimension's text opens in the MTEXT editor (AutoCAD 2024's DBLCLKEDIT; M2-11).
  DIMENSION: 'TEXTEDIT',
  ARC_DIMENSION: 'TEXTEDIT',
  LARGE_RADIAL_DIMENSION: 'TEXTEDIT',
  // A table opens the cell double-clicked in the In-Place Text Editor (M4-05 part 2).
  ACAD_TABLE: 'TABLEDIT',
  // A hatch opens HATCHEDIT's Hatch Edit dialog (M4-07 part 5), as AutoCAD's does without the
  // ribbon.
  HATCH: 'HATCHEDIT',
  // A feature control frame opens the Geometric Tolerance dialog (M4-11; AutoCAD 2024 Help,
  // "TEXTEDIT (Command)").
  TOLERANCE: 'TEXTEDIT',
};

/**
 * The command a double click on `e` runs: `DOUBLE_CLICK`'s for its type, except that only a
 * block reference with attributes to edit opens EATTEDIT (one without opens the Block Editor in
 * AutoCAD, which Triya does not have: nothing opens).
 */
export function doubleClickCommand(e: Entity | undefined): string | undefined {
  if (!e) return undefined;
  if (e.geom.kind === 'INSERT' && !hasEditableAttributes(e)) return undefined;
  // Only a multileader of text: a block one's attributes are not edited in place yet.
  if (e.geom.kind === 'MULTILEADER' && !textEdited(e)) return undefined;
  return DOUBLE_CLICK[e.geom.kind];
}

/** One command's edits, in order: what the undo stack (M2-05) keeps as one step. */
/** A grip's hover menu (M3-05 part 2): the grip under the cursor and its functions, if many. */
export interface GripMenu {
  readonly grip: Vec2;
  readonly items: readonly string[];
}

export interface CommandRecord {
  readonly command: string;
  readonly changes: readonly ChangeSet[];
}

export type BusEvent =
  /**
   * The bus waits at this prompt; `text` is the line the command line shows (`>>` when nested).
   * `units` and `angles` are the drawing's as the prompt is asked (M2-35 part 20): Dynamic Input
   * shows the cursor's values in them, as the command line words its defaults.
   */
  | {
      readonly type: 'prompt';
      readonly prompt: Prompt;
      readonly text: string;
      readonly units: DrawingUnits;
      readonly angles: AngleConvention;
      /**
       * The current UCS (M3-06 part 7), whose X axis `angles.base` already counts from:
       * Dynamic Input's X and Y fields show the cursor in it.
       */
      readonly ucs: PlanUcs;
    }
  /** No command runs: the `Command:` prompt. */
  | { readonly type: 'idle' }
  /**
   * The running command waits on the app (M2-41): a dialog it opened, such as PLOT's, or the
   * preview. No prompt shows until it asks for one again or ends, as AutoCAD's command line
   * shows none while its dialog is up; the prompt it last asked was answered.
   */
  | { readonly type: 'waiting'; readonly command: string }
  /** A finished line of command history. */
  | { readonly type: 'log'; readonly line: string }
  | { readonly type: 'preview'; readonly geometry: readonly EntityGeometry[] }
  | { readonly type: 'start'; readonly command: string; readonly transparent: boolean }
  | { readonly type: 'end'; readonly command: string; readonly cancelled: boolean }
  /**
   * The objects to show selected changed (M2-03): the pre-selection at `Command:`, or the set a
   * "Select objects" prompt is building.
   */
  | { readonly type: 'selection'; readonly ids: readonly EntityId[] }
  /** A command (with any transparent commands run inside it) ended having edited the drawing. */
  | { readonly type: 'commit'; readonly record: CommandRecord }
  /** The undo history changed (a step added, undone or redone, a mark, a group, Control). */
  | {
      readonly type: 'undo';
      readonly state: UndoState;
      /** What an undo or a redo did (M2-23's toast); absent for any other change. */
      readonly action?: UndoAction;
    }
  /**
   * The objects to show grips on (M2-06): the selection at `Command:` (up to GRIPOBJLIMIT
   * objects), with the hot grip while grip editing; none while another command runs.
   */
  | {
      readonly type: 'grips';
      readonly ids: readonly EntityId[];
      readonly hot?: Vec2;
      /**
       * The groups selected whole that show one grip at their centre (GROUPDISPLAYMODE 1 or 2,
       * M3-13), with their members, which show none of their own; `box`, their bounding box
       * too (2). The canvas, which knows the objects' extents, places the grip.
       */
      readonly groups?: readonly GroupGrip[];
    };

/** A selected group's one grip (M3-13): at the centre of its members' extents. */
export interface GroupGrip {
  readonly ids: readonly EntityId[];
  readonly box?: true;
}

export interface PromptBusOptions {
  readonly model: DocumentModel;
  readonly registry: CommandRegistry;
  /** Applies an edit; by default to `model`. The engine worker also sends it to the renderers. */
  readonly apply?: (change: ChangeSet) => void;
  /** The space commands draw in (the layout shown); by default model space. */
  readonly space?: () => Handle;
  /** The canvas the view commands act on; by default none (they say so). */
  readonly view?: ViewHost;
  /**
   * PICKFIRST: objects picked at `Command:` are selected and a command that selects takes them
   * (noun-verb). AutoCAD's default, 1; false ignores picks at `Command:`.
   */
  readonly pickfirst?: boolean;
  /** PICKADD and PICKAUTO (M3-04 part 4): AutoCAD's 2 and 5 by default. */
  readonly pickadd?: number;
  readonly pickauto?: number;
  /** The undo history's memory bound (ARCHITECTURE.md §4.2; 256 MB by default). */
  readonly undoLimitBytes?: number | undefined;
  /** The dimension engine edited dimensions are regenerated by (M2-10 part 3); none by default. */
  readonly dimensions?: DimensionRegenerator | undefined;
  /** A pattern hatch's lines, for EXPLODE (M3-12 part 3); none by default. */
  readonly hatchLines?: HatchLinesOf | undefined;
  /** The spelling dictionary SPELL checks with (M4-09 part 4); none by default. */
  readonly spelling?: SpellService | undefined;
  /** The time DATE and CDATE tell (M2-59); the system's local time by default. */
  readonly clock?: Clock;
}

/** The system's local time. */
const SYSTEM_CLOCK: Clock = { now: () => new Date() };

interface Frame {
  readonly def: CommandDef;
  readonly label: string;
  readonly ctx: CommandContext;
  readonly gen: CommandGenerator;
  readonly transparent: boolean;
  prompt: Prompt | undefined;
  /** It waits on the app (`waitsOnApp`): no prompt shows (M2-41). */
  waiting?: boolean;
  /** The selection its "Select objects" prompt is building (M2-03). */
  select?: SelectionLoop | undefined;
  /** The point the command it runs inside was collecting (`'ZOOM` typed at FROM's base point). */
  readonly outerCollectors: Collector[];
}

/** A step of a point the bus collects itself before the command sees it (FROM, M2P, filters). */
interface Collector {
  readonly text: string;
  /** What `@` is relative to here (FROM's offset is relative to its base point). */
  readonly relativeTo?: Vec2;
  /** A typed object snap override's modes (M2-04): the point it asks for snaps with these. */
  readonly osnap?: number;
  /** The rubber band the prompt it was typed at had, kept while the override asks "of". */
  readonly band?: Vec2;
  /** The deferred snaps the prompt it was typed at takes, kept for the override (M3-01). */
  readonly deferred?: DeferredModes;
  /** What the prompt it was typed at dragged, still dragged while the override asks (M3-01). */
  readonly drag?: DragPreview;
  /**
   * The point goes orthogonally from `band` (TK's next tracking point, M3-06 part 4): the
   * front-end constrains the cursor so, and a number typed goes that far along it.
   */
  readonly ortho?: true;
  /** What Enter gives, where it ends the collector (TK: the last tracking point). */
  readonly enter?: () => Vec2;
  accept(p: Vec2): Vec2 | Collector | { readonly answer: PromptAnswer };
}

/**
 * TRACKING (TK; AutoCAD 2024 Help, "To Locate a Point Using Tracking"): a first tracking point,
 * then each next one orthogonal to the one before (horizontally or vertically, whichever way it
 * goes further), until Enter gives the last as the point. A snap off the axis keeps its X or Y,
 * so `TK`, the midpoint of a rectangle's top, then of its side, finds its centre.
 */
function trackingPoints(axes: number): Collector {
  const next = (last: Vec2): Collector => ({
    text: 'Next point (Press ENTER to end tracking):',
    band: last,
    relativeTo: last,
    ortho: true,
    enter: () => last,
    accept: (p) => next(orthoPoint(last, p, axes)),
  });
  return { text: 'First tracking point:', accept: (p) => next(p) };
}

/**
 * `d` from `base` along the horizontal or vertical (of the UCS, `axes` its X axis's angle)
 * towards `cursor`; undefined without one.
 */
function orthoDistance(
  base: Vec2,
  cursor: Vec2 | undefined,
  d: number,
  axes: number,
): Vec2 | undefined {
  if (!cursor) return undefined;
  const to = orthoPoint(base, cursor, axes);
  const len = Math.hypot(to.x - base.x, to.y - base.y);
  if (len === 0) return undefined;
  return { x: base.x + ((to.x - base.x) / len) * d, y: base.y + ((to.y - base.y) / len) * d };
}

const isCollector = (r: ReturnType<Collector['accept']>): r is Collector => 'accept' in r;
const isAnswer = (r: ReturnType<Collector['accept']>): r is { readonly answer: PromptAnswer } =>
  'answer' in r;

/** AutoCAD's messages for input a prompt cannot take. */
const INVALID: { readonly [K in Prompt['kind']]: string } = {
  point: 'Point or option keyword required.',
  distance: 'Requires numeric distance or two points.',
  angle: 'Requires valid numeric angle or second point.',
  keyword: 'Invalid option keyword.',
  string: 'Invalid input.',
  integer: 'Requires an integer value.',
  real: 'Requires numeric value.',
  selection: '*Invalid selection*',
  dialog: 'Invalid input.',
};

/** The pre-selection's steps, for the objects a command may take of it (unlocked ones). */
const kept = (takes: readonly SelectionTake[], ids: readonly EntityId[]): SelectionTake[] => {
  const keep = new Set(ids);
  return takes
    .map((t) => ({ ...t, ids: t.ids.filter((id) => keep.has(id)) }))
    .filter((t) => t.ids.length > 0);
};

const takesPoints = (p: Prompt): boolean =>
  p.kind === 'point' || p.kind === 'distance' || p.kind === 'angle';

export class PromptBus {
  readonly #model: DocumentModel;
  readonly #registry: CommandRegistry;
  readonly #apply: (change: ChangeSet) => void;
  readonly #space: () => Handle;
  readonly #view: ViewHost;
  readonly #dimensions: DimensionRegenerator | undefined;
  readonly #hatchLines: HatchLinesOf | undefined;
  readonly #spelling: SpellService | undefined;
  readonly #listeners = new Set<(e: BusEvent) => void>();
  readonly #stack: Frame[] = [];
  #collectors: Collector[] = [];
  #changes: ChangeSet[] = [];
  #last: { readonly def: CommandDef; readonly dash: boolean } | undefined;
  /** The outermost command running, whose record `#close` makes. */
  #current: CommandDef | undefined;
  #lastPoint: Vec2 | undefined;
  /** What `@` is relative to in the input being read, when the front-end said (`submit`). */
  #relativeTo: Vec2 | undefined;
  #cursor: Vec2 | undefined;
  #previewing = false;
  #queue: Promise<void> = Promise.resolve();
  readonly #history: string[] = [];
  readonly #recent: string[] = [];
  #pickfirstOn: boolean;
  #pickadd: number;
  #pickauto: number;
  /** PICKSTYLE and GROUPDISPLAYMODE as the app last set them: how grips show on groups (M3-13). */
  #pickstyle = DEFAULT_PICKSTYLE;
  #groupDisplay = DEFAULT_GROUPDISPLAYMODE;
  /** The pre-selection made at `Command:` (PICKFIRST). */
  readonly #idle: SelectionLoop;
  /** The pre-selection the running command takes at its first "Select objects" prompt. */
  #pickfirst: readonly EntityId[] | undefined;
  /** The window the pre-selection was last made with (STRETCH's, M2-06). */
  #pickfirstWindow: SelectionWindow | undefined;
  /** Where the pre-selection's last pick was made (EATTEDIT's attribute, M2-27). */
  #pickfirstPick: Vec2 | undefined;
  #pickfirstTakes: readonly SelectionTake[] = [];
  /** The hot grip while grip editing runs (M2-06). */
  #hot: Vec2 | undefined;
  /** The grips last shown, as a key, so only a change is sent. */
  #gripsShown = '';
  /** The Previous selection set. */
  #previous: readonly EntityId[] = [];
  /** The selection last shown (the `selection` event). */
  #shown: readonly EntityId[] = [];
  readonly #undo: UndoStack;
  readonly #clock: Clock;

  constructor(options: PromptBusOptions) {
    this.#model = options.model;
    this.#registry = options.registry;
    const apply = options.apply ?? ((cs: ChangeSet) => this.#model.apply(cs));
    this.#apply = (cs) => {
      apply(cs);
      this.#forget(cs);
    };
    this.#space = options.space ?? (() => modelSpaceOf(this.#model));
    this.#view = options.view ?? NO_VIEW;
    this.#dimensions = options.dimensions;
    this.#hatchLines = options.hatchLines;
    this.#spelling = options.spelling;
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#pickfirstOn = options.pickfirst ?? true;
    this.#pickadd = options.pickadd ?? DEFAULT_PICKADD;
    this.#pickauto = options.pickauto ?? DEFAULT_PICKAUTO;
    this.#idle = this.#selectionLoop({ message: 'Command', atCommand: true });
    this.#undo = new UndoStack({
      apply: (cs) => this.#apply(cs),
      ...(options.undoLimitBytes !== undefined ? { maxBytes: options.undoLimitBytes } : {}),
      onChange: (state, action) =>
        this.#emit(action ? { type: 'undo', state, action } : { type: 'undo', state }),
      onMessage: (line) => this.#log(line),
      // A view step undone or redone (M2-47 part 4): the canvas shows the view kept and answers
      // with the one it replaced. Not waited on: U is done once the drawing is.
      swapView: async (viewport, view) => {
        const reply = await this.#view.request({ op: 'swap', viewport, view });
        return reply.ok && reply.view
          ? { center: reply.view.center, height: reply.view.height }
          : undefined;
      },
    });
  }

  /** The drawing's undo history: each command that edited is one step (M2-05). */
  get undo(): UndoStack {
    return this.#undo;
  }

  /** Listens for bus events; returns the unsubscribe. */
  on(listener: (e: BusEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The prompt the bus waits at, or undefined at `Command:`. */
  get prompt(): Prompt | undefined {
    if (this.#stack.at(-1)?.waiting) return undefined;
    const c = this.#collectors.at(-1);
    if (c) {
      return prompts.point({
        message: c.text.replace(/:$/, ''),
        ...(c.band && { rubberBand: { from: c.band } }),
        ...(c.osnap !== undefined && { osnap: c.osnap }),
        ...(c.deferred && { deferred: c.deferred }),
        ...(c.drag && { drag: c.drag }),
        ...(c.ortho && { ortho: true }),
      });
    }
    const frame = this.#stack.at(-1);
    if (!frame) return this.#idle.prompt;
    return frame.select?.prompt ?? frame.prompt;
  }

  /** The command line's prompt text. */
  get promptText(): string {
    // Empty while a dialog is up (M2-41): neither a prompt nor `Command:`.
    if (this.#stack.at(-1)?.waiting) return '';
    const c = this.#collectors.at(-1);
    if (c) return this.#nested(c.text);
    const prompt = this.prompt;
    return prompt ? this.#nested(formatPrompt(prompt, this.#units())) : 'Command:';
  }

  /** The objects shown selected: the set being built at "Select objects", or the pre-selection. */
  get selection(): readonly EntityId[] {
    for (let i = this.#stack.length - 1; i >= 0; i--) {
      const loop = this.#stack[i]!.select;
      if (loop) return loop.ids;
    }
    return this.#idle.ids;
  }

  /** The running command (the innermost, when one runs transparently), or undefined. */
  get command(): string | undefined {
    return this.#stack.at(-1)?.def.name;
  }

  /** The command history, line by line, as AutoCAD's text window (F2) shows it. */
  get history(): readonly string[] {
    return this.#history;
  }

  /** The commands typed at `Command:`, oldest first, for Up/Down recall. */
  get recent(): readonly string[] {
    return this.#recent;
  }

  get lastPoint(): Vec2 | undefined {
    return this.#lastPoint;
  }

  /** The cursor's world point, which a direct distance entry measures towards. */
  pointer(p: Vec2 | undefined): void {
    this.#cursor = p;
  }

  /**
   * Typed input, ended by Enter: a command at `Command:`, an answer otherwise. `relativeTo` is
   * what a relative point (`@`) in it counts from, where not the last point: Dynamic Input's X
   * and Y at a rubber band are measured from its base (M2-71), which COPY's second points share
   * while the last point moves on with each copy.
   */
  submit(text: string, o: { readonly relativeTo?: Vec2 | undefined } = {}): Promise<void> {
    return this.#enqueue(async () => {
      this.#relativeTo = o.relativeTo;
      try {
        await this.#input(text);
      } finally {
        this.#relativeTo = undefined;
      }
    });
  }

  /** What `@` counts from: the base the input came with, else LASTPOINT. */
  #relativeBase(): Vec2 | undefined {
    return this.#relativeTo ?? this.#lastPoint;
  }

  /** A direct answer from a front-end: a picked point, a Dynamic Input value, a selection. */
  answer(answer: PromptAnswer): Promise<void> {
    return this.#enqueue(() => this.#direct(answer));
  }

  /**
   * Esc: cancels the running command, and any it was running inside; a prompt that takes Esc
   * (`escape`) has it as its answer instead.
   */
  cancel(): Promise<void> {
    return this.#enqueue(() => {
      const frame = this.#stack.at(-1);
      const prompt = frame?.prompt;
      if (!prompt?.escape) return this.#cancel();
      this.#log(`${this.promptText} *Cancel*`);
      this.#collectors = [];
      // A selection prompt that takes Esc (TABLESTYLE's "Select a table", M4-16) drops what
      // was being selected.
      if (frame!.select) {
        frame!.select = undefined;
        this.#showSelection();
      }
      return this.#deliver({ kind: 'escape' }, '', false);
    });
  }

  /**
   * Starts a command as a ribbon button or the palette does: a command already running is
   * cancelled first (AutoCAD's ^C^C), unless the new one can run transparently inside it.
   */
  invoke(name: string): Promise<void> {
    return this.#enqueue(async () => {
      const found = this.#registry.resolve(name);
      if (!found) return this.#log(`Unknown command "${name.toUpperCase()}".  Press F1 for help.`);
      if (this.#stack.length === 1 && found.def.transparent) return this.#transparent(`'${name}`);
      if (this.#stack.length > 0) await this.#cancel();
      this.#log(`Command: ${found.dash ? '-' : ''}${found.def.name}`);
      await this.#start(found.def, found.dash, false);
    });
  }

  /**
   * A click on the canvas (M2-03). At "Select objects" or at `Command:` it picks, or starts or
   * ends a selection window, removing with `shift`; at a prompt for a point it is the point.
   * `release` ends a dragged window, or the `lasso` dragged from its first corner (M3-04 part
   * 2), and does nothing when no window is open. `missed` says the
   * prompt's object snap override found nothing at the point, which refuses it (M2-04). `ctrl`:
   * Ctrl was held, which a prompt that switches an arc's direction takes (M3-01 part 6).
   * `dragged`: the press made at `point` has been dragged (M3-04 part 6): with PICKAUTO 2, one
   * that picked an object at `Command:` becomes a window's first corner.
   */
  pick(
    point: Vec2,
    o: {
      readonly shift?: boolean;
      readonly release?: boolean;
      readonly lasso?: Lasso;
      readonly grip?: number;
      readonly missed?: boolean;
      readonly deferred?: DeferredPick;
      readonly ctrl?: boolean;
      readonly gripFunction?: string;
      readonly dragged?: boolean;
      /** With `release`: the path a press was dragged along (M3-12 part 6, `freehand`). */
      readonly freehand?: readonly Vec2[];
    } = {},
  ): Promise<void> {
    return this.#enqueue(async () => {
      if (o.dragged) {
        if (this.#stack.length === 0 && this.#pickfirstOn && this.#idle.dragged(point)) {
          this.#step(undefined, 'more');
        }
        return;
      }
      this.#cursor = point;
      // AutoCAD refuses a pick an override found no object at with "Invalid point." and asks
      // again; its help does not say what follows, so the override stays for the next pick.
      if (o.missed && this.#collectors.at(-1)?.osnap) return this.#reject('Invalid point.');
      const frame = this.#stack.at(-1);
      // A click on a grip of the selection at `Command:` starts grip editing (M2-06): `grip` is
      // how near, in drawing units, the canvas counts as on a grip. `gripFunction`: the function
      // picked from the grip's hover menu (M3-05 part 2), the one the grip starts in.
      if (!frame && o.grip !== undefined && !o.shift && !o.release && !this.#idle.wantsPoint) {
        const ids = this.#gripIds();
        const { loose, groups } = this.#gripShapes(ids);
        let hot = loose.length > 0 ? nearestGrip(this.#model, loose, point, o.grip) : undefined;
        // A selected group's one grip, at its members' centre as the canvas bounds them (M3-13).
        let reach = hot ? distance(hot, point) : o.grip;
        let group = false;
        for (const g of groups) {
          const r = await this.#view.request({ op: 'bounds', ids: g.ids });
          if (!r.ok || !r.box) continue;
          const c = { x: (r.box.minX + r.box.maxX) / 2, y: (r.box.minY + r.box.maxY) / 2 };
          if (distance(c, point) > reach) continue;
          hot = c;
          reach = distance(c, point);
          group = true;
        }
        if (hot) {
          this.#hot = hot;
          return this.#start(
            gripCommand(ids, hot, group ? undefined : o.gripFunction, group),
            false,
            false,
          );
        }
      }
      // A click inside a table cell, clear of its lines, selects the cell (TABLECELL, M4-05
      // part 3); a click on a table's lines still selects the table.
      if (!frame && this.#pickfirstOn && !o.shift && !o.release && !this.#idle.wantsPoint) {
        const cell = tableCellUnder(this.#model, this.#space(), point, o.grip ?? 0);
        if (cell) {
          this.#idle.clear();
          return this.#start(tableCellCommand(cell), false, false);
        }
      }
      if (frame?.select && this.#collectors.length === 0) {
        return this.#step(frame, await frame.select.point(point, o));
      }
      if (frame) {
        if (o.release) {
          const p = this.prompt;
          // A drag across table cells ends where it is let go (TABLECELL, M4-05 part 4).
          if (p?.kind === 'point' && p.releaseExtends) {
            return this.#direct({ kind: 'point', point, shift: true });
          }
          // TRIM's freehand fence (M3-12 part 6): the path, at a prompt that takes one.
          if (!o.freehand || p?.kind !== 'point' || !p.rubberBand?.freehand) return undefined;
          return this.#direct({ kind: 'point', point, freehand: o.freehand });
        }
        return this.#direct({
          kind: 'point',
          point,
          ...(o.shift && { shift: true as const }),
          ...(o.deferred && { deferred: o.deferred }),
          ...(o.ctrl && { ctrl: true as const }),
        });
      }
      if (!this.#pickfirstOn) return;
      this.#step(undefined, await this.#idle.point(point, o));
    });
  }

  /**
   * COMMANDPREVIEW (M3-12 part 6, `command-preview.ts`): what a pick (point) at `q` would do at
   * the prompt the command waits at, when it shows a preview. It edits nothing and does not
   * wait behind input still being worked on: a prompt gone meanwhile gives none.
   */
  async commandPreview(q: PreviewQuery): Promise<CommandPreview | undefined> {
    const at = this.prompt?.commandPreview?.at;
    if (!at) return undefined;
    try {
      return await at(q);
    } catch {
      // A preview is never worth an error: the pick itself says what is wrong.
      return undefined;
    }
  }

  /**
   * A double click on the canvas (M2-07 part 2): at `Command:`, the object under it is edited
   * with the command `DOUBLE_CLICK` names for its type (AutoCAD's DBLCLKEDIT), with that object
   * alone as the pre-selection. Grip editing the double click's own clicks started is dropped;
   * inside any other command it does nothing, nor on an object no command edits this way.
   */
  doubleClick(point: Vec2): Promise<void> {
    return this.#enqueue(async () => {
      const top = this.#stack.at(-1);
      if (top && !top.def.keepsSelection && !top.def.yieldsToDoubleClick) return;
      const r = await this.#view.request({ op: 'pick', point });
      const ids = r.ok ? (r.ids ?? []) : [];
      // Inside an empty table cell nothing drawn is under the cursor: the cell's table is.
      const id =
        ids.find((i) => doubleClickCommand(this.#model.entity(i)) !== undefined) ??
        tableCellUnder(this.#model, this.#space(), point, 0)?.id;
      if (id === undefined) return;
      const found = this.#registry.resolve(doubleClickCommand(this.#model.entity(id))!);
      if (!found) return;
      if (top) await this.#cancel();
      this.#idle.clear();
      this.#idle.set([id], point);
      this.#log(`Command: ${found.def.name}`);
      await this.#start(found.def, false, false);
    });
  }

  /** Ctrl+A: everything ALL takes, at `Command:` (replacing the pre-selection) or "Select objects". */
  selectAll(): Promise<void> {
    return this.#enqueue(async () => {
      const frame = this.#stack.at(-1);
      if (frame?.select) {
        const step = await frame.select.keyword('ALL');
        return this.#step(frame, step ?? 'more');
      }
      if (frame || !this.#pickfirstOn) return;
      this.#idle.clear();
      await this.#idle.keyword('ALL');
      this.#step(undefined, 'more');
    });
  }

  /** PICKFIRST: picks at `Command:` select, and a command that selects takes them. */
  get pickfirst(): boolean {
    return this.#pickfirstOn;
  }

  /**
   * PICKFIRST set while the drawing is open (SETVAR, M2-59): it holds from the next pick, and
   * turned off it deselects what was picked at `Command:`, which no command could take now.
   */
  setPickfirst(on: boolean): Promise<void> {
    if (on === this.#pickfirstOn) return Promise.resolve();
    this.#pickfirstOn = on;
    return on ? Promise.resolve() : this.clearSelection();
  }

  /**
   * PICKADD or PICKAUTO set while the drawing is open (M3-04 part 4): from the next step;
   * PICKSTYLE or GROUPDISPLAYMODE (M3-13): the grips shown change at once.
   */
  setPickVariable(name: PickVariable, value: number): void {
    if (name === PICKADD) this.#pickadd = value;
    else if (name === PICKAUTO) this.#pickauto = value;
    else {
      if (name === PICKSTYLE) this.#pickstyle = value;
      else this.#groupDisplay = value;
      if (!this.#stack.at(-1)) this.#showGrips();
    }
  }

  get pickadd(): number {
    return this.#pickadd;
  }

  /** Deselects what was picked at `Command:` (another space shown, M2-03). */
  clearSelection(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#idle.ids.length === 0 && !this.#idle.wantsPoint) return;
      const corner = this.#idle.wantsPoint;
      this.#idle.clear();
      this.#showSelection();
      if (corner && this.#stack.length === 0) this.#showPrompt();
    });
  }

  /**
   * A Properties palette edit (M2-21): `edit` set on the objects the palette shows (of the type
   * `filter`, when the palette shows one type); with nothing selected, the drawing's current
   * setting new objects take (M2-35, `applyCurrentEdit`). One undo step, which the command line
   * does not echo, as AutoCAD's palette edits; the objects stay selected.
   *
   * At `Command:` the palette shows the pre-selection. While a command's "Select objects" prompt
   * runs it shows what that prompt has selected so far (`selection`), and the edit changes those
   * objects inside the command (M2-35 part 30): the command goes on prompting with its selection,
   * and the edit is part of the command's undo step. Any other prompt is cancelled first, as a
   * palette or ribbon button cancels it (^C^C); grip editing keeps its selection, so the edit
   * applies to it.
   */
  setProperty(edit: PropertyEdit, filter?: EntityType): Promise<void> {
    return this.#enqueue(async () => {
      const loop = this.#selecting();
      if (loop) return this.#propertyInside([...loop.ids], edit, filter);
      if (this.#stack.length > 0) await this.#cancel();
      const ids = [...this.#idle.ids];
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the command's body runs on the bus
      const bus = this;
      const def: CommandDef = {
        name: 'PROPERTIES',
        usesSelection: 'none',
        keepsSelection: true,
        // eslint-disable-next-line require-yield -- the palette gave the value
        async *run(ctx) {
          await bus.#applyProperty(ctx, ids, edit, filter);
        },
      };
      await this.#start(def, false, false);
    });
  }

  /** The selection a running command's "Select objects" prompt is building, if one is open. */
  #selecting(): SelectionLoop | undefined {
    for (let i = this.#stack.length - 1; i >= 0; i--) {
      const loop = this.#stack[i]!.select;
      if (loop) return loop;
    }
    return undefined;
  }

  /**
   * A palette edit while a command selects (M2-35 part 30). It joins the undo step the command
   * is building, as a transparent command's edits do (AutoCAD groups what is done while a
   * command runs into its undo group), so U takes them back in the order they were made; a
   * command cancelled afterwards keeps it, as it keeps its own edits. The command's prompt is
   * shown again after any message the edit gave.
   */
  async #propertyInside(ids: EntityId[], edit: PropertyEdit, filter?: EntityType): Promise<void> {
    const from = this.#changes.length;
    const logged = this.#history.length;
    try {
      const ctx = this.#context(false, true);
      await this.#applyProperty(ctx, ids, edit, filter);
      // Restyled dimensions are redrawn now: a command cancelled later redraws nothing.
      const made = this.#changes.slice(from);
      if (made.length > 0) {
        followAssociations(ctx, made);
        await regenerateRestyled(ctx, made);
      }
    } catch (err) {
      this.#log(`; error: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.#showSelection();
    if (this.#history.length > logged) this.#showPrompt();
  }

  /** The body of a palette edit: `applyProperty`, on this bus's drawing. */
  async #applyProperty(
    ctx: CommandContext,
    ids: readonly EntityId[],
    edit: PropertyEdit,
    filter: EntityType | undefined,
  ): Promise<void> {
    await applyProperty(ctx, ids, edit, filter);
  }

  /**
   * The Properties palette's `...` on an MTEXT's Contents (M2-35 part 9, AutoCAD 2024's
   * "Properties Palette — Text") or a text multileader's (part 11): the In-Place Text Editor on
   * the one object the palette shows (of the type `filter`), as TEXTEDIT opens it. Like the palette's other edits it is one undo step
   * the command line does not echo, and the MTEXT stays selected; a running command is cancelled
   * first, the editor being a command of its own (one at "Select objects" too, M2-35 part 30). With anything but one such object shown it does nothing (the row offers no button
   * then).
   */
  editContents(filter?: EntityType): Promise<void> {
    return this.#enqueue(async () => {
      // What the palette shows: a running command's selection so far, too (M2-35 part 30).
      const shown = filtered(this.#model, this.selection, filter);
      const one = shown.length === 1 ? shown[0] : undefined;
      // An MTEXT (part 9), or a multileader whose content is text (part 11).
      const entity =
        one?.geom.kind === 'MTEXT' || (one?.geom.kind === 'MULTILEADER' && textOf(one.geom))
          ? one
          : undefined;
      if (!entity) return;
      const selected = this.#selecting() ? [...this.selection] : undefined;
      if (this.#stack.length > 0) await this.#cancel();
      // The command's selection stays selected, as the palette showed it, while the editor runs.
      if (selected) {
        this.#idle.set(selected);
        this.#showSelection();
      }
      const def: CommandDef = {
        name: 'PROPERTIES',
        usesSelection: 'none',
        keepsSelection: true,
        async *run(ctx) {
          yield* editContents(ctx, entity);
        },
      };
      await this.#start(def, false, false);
    });
  }

  /**
   * The blocks a save gives the dimensions that have none (M2-30 part 2,
   * `blocklessDimensionBlocks`): a change set for the saved file only, not applied to the
   * drawing. Not queued: QSAVE, which holds the queue while the app saves, asks for it.
   */
  blocklessDimensionBlocks(): Promise<ChangeSet | undefined> {
    return blocklessDimensionBlocks(this.#model, this.#dimensions, this.#view);
  }

  /** Runs each line as typed input, in order (scripts and tests). */
  async script(lines: readonly string[]): Promise<void> {
    for (const line of lines) await this.submit(line);
  }

  #enqueue(task: () => Promise<void> | void): Promise<void> {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #emit(e: BusEvent): void {
    for (const l of this.#listeners) l(e);
  }

  #log(line: string): void {
    this.#history.push(line);
    this.#emit({ type: 'log', line });
  }

  #nested(text: string): string {
    return this.#stack.length > 1 ? `>>${text}` : text;
  }

  /** LUNITS, LUPREC, AUNITS, AUPREC and UNITMODE: how prompts show lengths and angles. */
  #units(): DrawingUnits {
    return drawingUnits(this.#model.header);
  }

  /** LUNITS, which says how typed lengths read: feet and inches, fractions (`parseDistance`). */
  #lunits(): number {
    const v = this.#model.header.get('$LUNITS');
    return typeof v === 'number' ? v : 2;
  }

  /**
   * ANGBASE (radians, as acad-ts carries the header) and ANGDIR, for typed angles, which count
   * from the current UCS's X axis (M3-06 part 7; AutoCAD 2024 Help, "ANGBASE": "Sets the base
   * angle to 0 with respect to the current UCS"). `turn` leaves the UCS out, for an angle that
   * is an amount of turning (an included angle, a rotation), not a direction.
   */
  #angles(turn = false): AngleConvention {
    const base = this.#model.header.get('$ANGBASE');
    const dir = this.#model.header.get('$ANGDIR');
    const angbase = typeof base === 'number' ? base : DEFAULT_ANGLES.base;
    const ucs = this.#ucs().angle;
    return {
      base: turn ? angbase : angbase + ucs,
      clockwise: dir === 1 || dir === true,
      ...(!turn && ucs !== 0 && { ucs }),
    };
  }

  /** The current UCS of the space the commands draw in (M3-06 part 7). */
  #ucs(): PlanUcs {
    return ucsOf(this.#model.header, this.#space() !== modelSpaceOf(this.#model));
  }

  /** How text typed for a point reads: from `lastPoint`, in the drawing's units and UCS. */
  #coordinates(lastPoint: Vec2 | undefined): CoordinateContext {
    return { lastPoint, angles: this.#angles(), lunits: this.#lunits(), ucs: this.#ucs() };
  }

  #showPrompt(): void {
    const prompt = this.prompt;
    if (prompt) {
      const units = this.#units();
      const turn = prompt.kind === 'angle' && prompt.turn === true;
      this.#emit({
        type: 'prompt',
        prompt,
        text: this.promptText,
        units,
        angles: this.#angles(turn),
        ucs: this.#ucs(),
      });
    } else this.#emit({ type: 'idle' });
  }

  #reject(message: string): void {
    this.#log(message);
    this.#showPrompt();
  }

  async #input(text: string): Promise<void> {
    const frame = this.#stack.at(-1);
    if (!frame) {
      // A point typed while a window opened at `Command:` waits for its corner ends it.
      if (this.#idle.wantsPoint) {
        const p = parseCoordinate(text.trim(), this.#coordinates(this.#relativeBase()));
        if (p !== undefined && p !== 'invalid') {
          this.#log(`${this.promptText} ${text.trim()}`);
          return this.#step(undefined, await this.#idle.point(p));
        }
        this.#idle.cancelWindow();
      }
      return this.#commandLine(text);
    }
    const t = text.trim();
    if (this.#collectors.length > 0) {
      return t.length > 1 && t.startsWith("'") ? this.#transparent(t) : this.#collectorInput(t);
    }
    if (frame.select && !(t.length > 1 && t.startsWith("'"))) {
      return this.#selectionInput(frame, frame.select, t);
    }
    // At a text prompt an apostrophe is text ('Note' as a TEXT string), not a transparent command.
    if (t.length > 1 && t.startsWith("'") && frame.prompt!.kind !== 'string') {
      return this.#transparent(t);
    }
    return this.#typed(frame.prompt!, text);
  }

  async #direct(answer: PromptAnswer): Promise<void> {
    const frame = this.#stack.at(-1);
    if (!frame) {
      if (answer.kind === 'enter') await this.#commandLine('');
      return;
    }
    const echo = formatAnswer(answer, this.#units());
    const loop = frame.select;
    if (loop && this.#collectors.length === 0 && answer.kind !== 'selection') {
      if (answer.kind === 'point') {
        if (!loop.wantsPoint) this.#log(`${this.promptText} ${echo}`);
        return this.#step(frame, await loop.point(answer.point));
      }
      if (answer.kind === 'enter') return this.#selectionInput(frame, loop, '');
      if (answer.kind === 'keyword') return this.#selectionInput(frame, loop, answer.keyword);
      return this.#reject(INVALID.selection);
    }
    if (loop) frame.select = undefined;
    if (this.#collectors.length > 0) {
      if (answer.kind === 'enter' && this.#collectors.at(-1)!.enter) {
        this.#log(this.promptText);
        return this.#endCollector();
      }
      if (answer.kind !== 'point') return this.#reject('Invalid point.');
      this.#log(`${this.promptText} ${echo}`.trimEnd());
      return this.#feedPoint(answer.point, answer.deferred);
    }
    if (answer.kind === 'point' && frame.prompt!.kind !== 'point' && takesPoints(frame.prompt!)) {
      return this.#pointFor(answer.point, echo, true, undefined, answer.ctrl);
    }
    return this.#deliver(answer, echo);
  }

  async #commandLine(text: string): Promise<void> {
    const t = text.trim().replace(/^'/, '');
    if (t === '') {
      // Enter at `Command:` repeats the last command, as AutoCAD does.
      this.#log('Command:');
      if (!this.#last) return this.#showPrompt();
      this.#log(this.#last.dash ? `-${this.#last.def.name}` : this.#last.def.name);
      return this.#start(this.#last.def, this.#last.dash, false);
    }
    this.#log(`Command: ${t}`);
    this.#recent.push(t);
    const found = this.#registry.resolve(t) ?? this.#variable(t);
    if (!found) return this.#reject(`Unknown command "${t.toUpperCase()}".  Press F1 for help.`);
    return this.#start(found.def, found.dash, false);
  }

  /**
   * A system variable's name where a command's was expected (M2-42): its value, as SETVAR asks
   * it, as AutoCAD takes a variable's name at `Command:`. Commands come first (DIMSTYLE).
   */
  #variable(name: string): ResolvedCommand | undefined {
    const v = systemVariable(this.#model, name);
    return v && { def: variableCommand(v), dash: false };
  }

  async #transparent(text: string): Promise<void> {
    const name = text.slice(1);
    this.#log(`${this.promptText} ${text}`);
    const found = this.#registry.resolve(name) ?? this.#variable(name);
    if (!found) return this.#reject(`Unknown command "${name.toUpperCase()}".  Press F1 for help.`);
    if (!found.def.transparent) {
      return this.#reject('** That command may not be invoked transparently **');
    }
    if (this.#stack.length > 1) return this.#reject('** Cannot nest transparent commands **');
    return this.#start(found.def, found.dash, true);
  }

  async #start(def: CommandDef, dash: boolean, transparent: boolean): Promise<void> {
    if (!transparent) {
      // Enter at `Command:` repeats the last command typed or picked, never grip editing.
      if (!def.keepsSelection) this.#last = { def, dash };
      this.#current = def;
      this.#changes = [];
      // Noun-verb: a command that selects takes the pre-selection at its first "Select objects"
      // prompt. One that does not clears it, as AutoCAD deselects when LINE starts; a view
      // command (one that may run transparently) leaves it selected, and ZOOM Object takes it.
      const selects = def.usesSelection === 'during' || def.usesSelection === 'before';
      this.#idle.cancelWindow();
      this.#pickfirst =
        (selects || def.transparent) && this.#idle.ids.length > 0 ? [...this.#idle.ids] : undefined;
      this.#pickfirstWindow = this.#pickfirst ? this.#idle.window : undefined;
      this.#pickfirstPick = this.#pickfirst ? this.#idle.pick : undefined;
      this.#pickfirstTakes = this.#pickfirst ? this.#idle.takes : [];
      if (!def.transparent && !def.keepsSelection) this.#idle.clear();
      this.#showSelection();
    }
    const ctx = this.#context(dash, transparent);
    const frame: Frame = {
      def,
      label: `${dash ? '-' : ''}${def.name}`,
      ctx,
      gen: def.run(ctx),
      transparent,
      prompt: undefined,
      outerCollectors: this.#collectors,
    };
    this.#stack.push(frame);
    this.#showGrips();
    this.#collectors = [];
    this.#emit({ type: 'start', command: def.name, transparent });
    await this.#advance(frame, undefined);
  }

  #context(dash: boolean, transparent: boolean): CommandContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- a getter's `this` is the context
    const bus = this;
    return {
      model: this.#model,
      dash,
      transparent,
      prompt: prompts,
      undo: this.#undo,
      get lastPoint() {
        return bus.#lastPoint;
      },
      get preselected() {
        return transparent ? [] : (bus.#pickfirst ?? []);
      },
      get space() {
        return bus.#space();
      },
      select: (ids) => {
        this.#idle.clear();
        this.#idle.set(ids);
        this.#showSelection();
      },
      addSelected: (ids) => {
        const outer = transparent ? this.#stack.at(-2)?.select : undefined;
        if (!outer) return false;
        outer.add(ids);
        this.#showSelection();
        return true;
      },
      setPrevious: (ids) => {
        if (ids.length > 0) this.#previous = [...ids];
      },
      edit: (build) => {
        const b = new ChangeSetBuilder(this.#model);
        build(b);
        const change = b.build();
        this.#apply(change);
        this.#changes.push(change);
        return change;
      },
      preview: (geometry) => {
        this.#previewing = geometry.length > 0;
        this.#emit({ type: 'preview', geometry });
      },
      message: (text) => this.#log(text),
      view: { request: (r) => this.#hostRequest(r) },
      dimensions: this.#dimensions,
      hatchLines: this.#hatchLines,
      spelling: this.#spelling,
      clock: this.#clock,
    };
  }

  /**
   * A command's request of the host. One the app answers through the drafter (a dialog, the
   * preview: `waitsOnApp`) hides the prompt the command last asked until it asks again (M2-41);
   * the requests the canvas answers at once (ZOOM, a text's outline) leave it, so the prompt line
   * does not flicker. Only the innermost command runs, so it is the one asking.
   */
  async #hostRequest(r: ViewRequest): Promise<ViewReply> {
    const frame = this.#stack.at(-1);
    if (!frame || !waitsOnApp(r)) return this.#view.request(r);
    frame.waiting = true;
    this.#emit({ type: 'waiting', command: frame.def.name });
    try {
      return await this.#view.request(r);
    } finally {
      frame.waiting = false;
    }
  }

  /** Resumes the innermost command with an answer (undefined to start it). */
  async #advance(frame: Frame, answer: PromptAnswer | undefined): Promise<void> {
    let step: IteratorResult<Prompt, void>;
    try {
      step = answer === undefined ? await frame.gen.next() : await frame.gen.next(answer);
    } catch (err) {
      this.#log(`; error: ${err instanceof Error ? err.message : String(err)}`);
      return this.#end(frame, true);
    }
    if (step.done) {
      // The dimensions the command restyled are redrawn as it ends, in its undo step (M2-30
      // part 2): a transparent command's edits wait for the command it ran inside.
      if (!frame.transparent && this.#changes.length > 0) {
        try {
          // An array's item being edited and path arrays follow what the command changed
          // (M3-11 part 2), before the dimensions it restyled are redrawn.
          followAssociations(frame.ctx, [...this.#changes]);
          await regenerateRestyled(frame.ctx, this.#changes);
        } catch (err) {
          this.#log(`; error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return this.#end(frame, false);
    }
    frame.prompt = step.value;
    if (step.value.kind === 'selection') return this.#beginSelection(frame, step.value);
    this.#showPrompt();
  }

  /** A "Select objects" prompt: answered by the pre-selection, or built pick by pick. */
  async #beginSelection(frame: Frame, prompt: Extract<Prompt, { kind: 'selection' }>) {
    const pre =
      frame.transparent || prompt.pickfirst === false || (prompt.single && !prompt.pickfirst)
        ? undefined
        : this.#pickfirst;
    const preWindow = this.#pickfirstWindow;
    const prePick = this.#pickfirstPick;
    const preTakes = this.#pickfirstTakes;
    this.#pickfirst = this.#pickfirstWindow = this.#pickfirstPick = undefined;
    this.#pickfirstTakes = [];
    if (pre) {
      this.#idle.clear();
      let ids = pre;
      if (prompt.editable) {
        const locked = onLockedLayers(this.#model, pre);
        ids = pre.filter((id) => !locked.has(id));
        if (locked.size > 0) {
          this.#log(`${locked.size} ${locked.size === 1 ? 'was' : 'were'} on a locked layer.`);
        }
      }
      if (ids.length > 0) this.#previous = ids;
      this.#showSelection();
      frame.prompt = undefined;
      return this.#advance(frame, {
        kind: 'selection',
        ids,
        ...(preWindow && { window: preWindow }),
        ...(prePick && { pick: prePick }),
        ...(preTakes.length > 0 && { takes: kept(preTakes, ids) }),
      });
    }
    frame.select = this.#selectionLoop({
      message: prompt.message,
      ...(prompt.options && { options: prompt.options }),
      ...(prompt.editable && { editable: true }),
      ...(prompt.single && { single: true }),
      ...(prompt.ungrouped && { groups: false as const }),
      ...(prompt.defaultLabel !== undefined && { defaultLabel: prompt.defaultLabel }),
      ...(prompt.cursor && { cursor: prompt.cursor }),
    });
    this.#showSelection();
    this.#showPrompt();
  }

  #selectionLoop(o: ConstructorParameters<typeof SelectionLoop>[1]): SelectionLoop {
    return new SelectionLoop(
      {
        model: this.#model,
        space: () => this.#space(),
        request: (r) => this.#view.request(r),
        log: (line) => this.#log(line),
        previous: () => this.#previous,
        pickadd: () => this.#pickadd,
        pickauto: () => this.#pickauto,
      },
      o,
    );
  }

  /** Text at "Select objects": Enter ends it, then a command option, a mode or a point. */
  async #selectionInput(frame: Frame, loop: SelectionLoop, t: string): Promise<void> {
    if (t === '') {
      const ended = await loop.enter();
      if (ended) return this.#step(frame, ended);
      if (loop.wantsPoint) return this.#reject('Invalid window specification.');
      return this.#finishSelection(frame, loop);
    }
    if (loop.wantsName) return this.#step(frame, loop.name(t));
    if (loop.drawingPath && matchKeyword(t, ['Undo'])) {
      loop.undoPoint(t);
      return this.#step(frame, 'more');
    }
    const parsePoint = () => {
      const p = parseCoordinate(t, this.#coordinates(this.#relativeBase()));
      return p === 'invalid' ? undefined : p;
    };
    if (loop.wantsPoint) {
      const p = parsePoint();
      if (!p) return this.#reject('Invalid point.');
      this.#log(`${this.promptText} ${t}`);
      this.#lastPoint = p;
      return this.#step(frame, await loop.point(p));
    }
    const option = matchKeyword(t, frame.prompt?.options ?? []);
    if (option) {
      frame.select = undefined;
      this.#showSelection();
      return this.#deliver({ kind: 'keyword', keyword: option }, t);
    }
    const mode = await loop.keyword(t);
    if (mode) return this.#step(frame, mode);
    const p = parsePoint();
    if (p) {
      this.#log(`${this.promptText} ${t}`);
      this.#lastPoint = p;
      return this.#step(frame, await loop.point(p));
    }
    loop.invalid(t);
    this.#showPrompt();
  }

  /** After a selection step: the set is shown, and complete (SIngle) or prompted for again. */
  async #step(frame: Frame | undefined, result: StepResult): Promise<void> {
    if (frame?.select && result === 'done') return this.#finishSelection(frame, frame.select);
    this.#showSelection();
    this.#showPrompt();
  }

  /** "Select objects" ended: the command gets the set, which becomes the Previous set. */
  async #finishSelection(frame: Frame, loop: SelectionLoop): Promise<void> {
    const ids = [...loop.ids];
    this.#log(this.promptText);
    frame.select = undefined;
    if (ids.length > 0) this.#previous = ids;
    this.#showSelection();
    const window = loop.window;
    const pick = loop.pick;
    const takes = loop.takes;
    return this.#deliver(
      {
        kind: 'selection',
        ids,
        ...(window && { window }),
        ...(pick && { pick }),
        ...(takes.length > 0 && { takes }),
      },
      '',
      false,
    );
  }

  /**
   * The grip of the selection at `Command:` within `within` of `point` and the functions its
   * hover menu offers (M3-05 part 2; AutoCAD's GRIPMULTIFUNCTIONAL 3): none for a grip with one
   * function, which still takes the hover colour. Undefined with no grip there, or while a
   * command runs.
   */
  gripMenu(point: Vec2, within: number): GripMenu | undefined {
    if (this.#stack.length > 0 || this.#idle.wantsPoint) return undefined;
    const ids = this.#gripIds();
    const grip = ids.length > 0 ? nearestGrip(this.#model, ids, point, within) : undefined;
    if (!grip) return undefined;
    const items = gripMenuAt(this.#model, ids, grip);
    return { grip: { x: grip.x, y: grip.y }, items: items.length > 1 ? [...items] : [] };
  }

  /** The selection at `Command:` grips show on: none past GRIPOBJLIMIT. */
  #gripIds(): readonly EntityId[] {
    const ids = this.#idle.ids;
    return ids.length <= GRIP_OBJECT_LIMIT ? ids : [];
  }

  #showGrips(): void {
    const top = this.#stack.at(-1);
    const all = !top || (top.def.keepsSelection && this.#hot) ? this.#gripIds() : [];
    const hot = top ? this.#hot : undefined;
    const { loose, groups } = this.#gripShapes(all);
    const key = JSON.stringify([loose, groups, hot]);
    if (key === this.#gripsShown) return;
    this.#gripsShown = key;
    this.#emit({
      type: 'grips',
      ids: [...loose],
      ...(hot && all.length > 0 && { hot }),
      ...(groups.length > 0 && { groups }),
    });
  }

  /**
   * The grips `ids` show (M3-13; AutoCAD Help, "GROUPDISPLAYMODE"): with group selection on and
   * GROUPDISPLAYMODE 1 or 2, a group selected whole shows one grip for its members, which show
   * none of their own; the other objects (`loose`) show theirs.
   */
  #gripShapes(ids: readonly EntityId[]): { loose: readonly EntityId[]; groups: GroupGrip[] } {
    if (ids.length === 0 || (this.#pickstyle & GROUP_SELECTION) === 0 || this.#groupDisplay === 0) {
      return { loose: ids, groups: [] };
    }
    const whole = wholeGroups(this.#model, ids, this.#space());
    if (whole.length === 0) return { loose: ids, groups: [] };
    const grouped = new Set(whole.flatMap((g) => g.ids));
    return {
      loose: ids.filter((id) => !grouped.has(id)),
      groups: whole.map((g) => ({
        ids: g.ids,
        ...(this.#groupDisplay === 2 && { box: true as const }),
      })),
    };
  }

  #showSelection(): void {
    this.#showGrips();
    const ids = this.selection;
    const shown = this.#shown;
    if (ids.length === shown.length && ids.every((id, i) => id === shown[i])) return;
    this.#shown = [...ids];
    this.#emit({ type: 'selection', ids: this.#shown });
  }

  /** Erased objects leave every selection, the Previous set included. */
  #forget(cs: ChangeSet): void {
    const removed = cs.entities?.removed;
    if (!removed?.length) return;
    const gone = new Set(removed.map((r) => r.entity.id));
    this.#idle.forget(gone);
    for (const f of this.#stack) f.select?.forget(gone);
    // AutoCAD: "The Previous selection set is cleared by operations that delete objects".
    this.#previous = this.#previous.filter((id) => !gone.has(id));
    if (this.#pickfirst) this.#pickfirst = this.#pickfirst.filter((id) => !gone.has(id));
    this.#showSelection();
  }

  /** A command ended: close its record, or resume the one it ran inside. */
  #end(frame: Frame, cancelled: boolean): void {
    this.#stack.pop();
    if (frame.def.keepsSelection) this.#hot = undefined;
    this.#showGrips();
    this.#collectors = frame.outerCollectors;
    this.#emit({ type: 'end', command: frame.def.name, cancelled });
    const outer = this.#stack.at(-1);
    if (outer) {
      this.#log(`Resuming ${outer.label} command.`);
      return this.#showPrompt();
    }
    this.#close();
    this.#showPrompt();
  }

  #close(): void {
    this.#pickfirst = undefined;
    this.#showSelection();
    if (this.#previewing) {
      this.#previewing = false;
      this.#emit({ type: 'preview', geometry: [] });
    }
    if (this.#changes.length === 0) return;
    const def = this.#current!;
    const record: CommandRecord = { command: def.name, changes: this.#changes };
    this.#changes = [];
    this.#undo.push(record, { erases: def.erases === true });
    this.#emit({ type: 'commit', record });
  }

  async #cancel(): Promise<void> {
    this.#log(`${this.promptText} *Cancel*`);
    this.#collectors = [];
    // Esc at `Command:` deselects, as in AutoCAD.
    if (this.#stack.length === 0) this.#idle.clear();
    while (this.#stack.length > 0) {
      const frame = this.#stack.pop()!;
      try {
        await frame.gen.return(undefined);
      } catch (err) {
        this.#log(`; error: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.#emit({ type: 'end', command: frame.def.name, cancelled: true });
    }
    this.#close();
    this.#showPrompt();
  }

  /** Typed text at the innermost command's prompt. */
  async #typed(prompt: Prompt, text: string): Promise<void> {
    const t = text.trim();
    if (t === '') return this.#deliver(prompt.default ?? { kind: 'enter' }, '');
    const keyword = matchKeyword(t, [...(prompt.options ?? []), ...(prompt.hiddenOptions ?? [])]);
    if (keyword) return this.#deliver({ kind: 'keyword', keyword }, t);
    const angles = this.#angles();
    switch (prompt.kind) {
      case 'point':
      case 'distance':
      case 'angle': {
        const modifier = parsePointModifier(t);
        if (modifier) return this.#modifier(modifier, t);
        const override = parseOsnapOverride(t);
        if (override !== undefined) return this.#override(override, t);
        const lunits = this.#lunits();
        // A prompt may say what `@` counts from (BREAK's second point: the first, M3-02 part 4).
        const from = this.#relativeTo ?? (prompt.kind === 'point' ? prompt.lastPoint : undefined);
        const lastPoint = from ?? this.#relativeBase();
        const p = parseCoordinate(t, this.#coordinates(lastPoint));
        if (p !== undefined && p !== 'invalid') return this.#pointFor(p, t);
        const arbitrary = prompt.kind !== 'angle' && prompt.arbitrary;
        if (arbitrary && (prompt.kind === 'point' || parseDistance(t, lunits) === undefined)) {
          return this.#deliver({ kind: 'string', value: t }, t);
        }
        if (prompt.kind === 'distance') {
          const d = parseDistance(t, lunits);
          if (d !== undefined) return this.#deliver({ kind: 'distance', value: d }, t);
        } else if (prompt.kind === 'angle') {
          const zero = prompt.zero;
          const from =
            zero !== undefined
              ? { ...angles, base: zero }
              : prompt.turn
                ? this.#angles(true)
                : angles;
          const a = parseAngle(t, prompt.counterClockwise ? { ...from, clockwise: false } : from);
          if (a !== undefined) return this.#deliver({ kind: 'angle', value: a }, t);
        } else {
          const d = parseDistance(t, lunits);
          if (d !== undefined && prompt.rubberBand) return this.#directDistance(prompt, d, t);
          if (p === 'invalid' || d !== undefined) return this.#reject('Invalid point.');
        }
        return this.#reject(INVALID[prompt.kind]);
      }
      case 'string':
        return this.#deliver({ kind: 'string', value: text }, text);
      case 'integer':
      case 'real': {
        const n = parseNumber(t);
        if (n === undefined || (prompt.kind === 'integer' && !Number.isInteger(n))) {
          return this.#reject(INVALID[prompt.kind]);
        }
        return this.#deliver({ kind: 'number', value: n }, t);
      }
      default:
        return this.#reject(INVALID[prompt.kind]);
    }
  }

  /** A number at a rubber-band point prompt: that far from the base towards the cursor. */
  async #directDistance(prompt: PointPrompt, d: number, echo: string): Promise<void> {
    const from = prompt.rubberBand!.from;
    const to = this.#cursor;
    const len = to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    if (!to || len === 0) return this.#reject('Invalid point.');
    const point = {
      x: from.x + ((to.x - from.x) / len) * d,
      y: from.y + ((to.y - from.y) / len) * d,
    };
    return this.#deliver({ kind: 'point', point }, echo);
  }

  #modifier(m: PointModifier, echo: string): void {
    this.#log(`${this.promptText} ${echo}`);
    if (m.kind === 'from') {
      this.#collectors.push({
        text: 'Base point:',
        accept: (base) => ({ text: '<Offset>:', relativeTo: base, accept: (p) => p }),
      });
    } else if (m.kind === 'tracking') {
      this.#collectors.push(trackingPoints(this.#ucs().angle));
    } else if (m.kind === 'm2p') {
      this.#collectors.push({
        text: 'First point of mid:',
        accept: (a) => ({
          text: 'Second point of mid:',
          accept: (b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        }),
      });
    } else if (m.take === 'xy') {
      this.#collectors.push({ text: '.XY of', accept: (p) => p });
    } else {
      const need = m.take === 'x' ? 'Y' : m.take === 'y' ? 'X' : 'XY';
      // The coordinates are the current UCS's (M3-06 part 7): `.X` takes the first point's X
      // along the UCS's X axis.
      const u = this.#ucs();
      this.#collectors.push({
        text: `.${m.take === '' ? 'Z' : m.take.toUpperCase()} of`,
        accept: (a) => ({
          text: `(need ${need}):`,
          accept: (b) => {
            const [ua, ub] = [toUcs(u, a), toUcs(u, b)];
            return toWorld(u, { x: m.take === 'x' ? ua.x : ub.x, y: m.take === 'y' ? ua.y : ub.y });
          },
        }),
      });
    }
    this.#showPrompt();
  }

  /**
   * A one-shot object snap override typed at a point prompt (M2-04): AutoCAD asks "of" for the
   * point, which the front-end snaps with the override's modes; a typed point is taken as typed.
   */
  #override(modes: number, echo: string): void {
    const shown = this.prompt;
    const band =
      shown?.kind === 'point'
        ? shown.rubberBand && !shown.rubberBand.box && !shown.rubberBand.selection
          ? shown.rubberBand.from
          : undefined
        : shown && 'base' in shown
          ? shown.base
          : undefined;
    const deferred = shown?.kind === 'point' ? shown.deferred : undefined;
    const drag = shown?.drag;
    // At TK's next tracking point the snap goes on orthogonally from it (M3-06 part 4).
    const ortho = shown?.kind === 'point' && shown.ortho === true && band !== undefined;
    this.#log(`${this.promptText} ${echo}`);
    this.#collectors.push({
      text: overrideAsks(modes),
      osnap: modes,
      ...(band && { band }),
      ...(deferred && { deferred }),
      ...(drag && { drag }),
      ...(ortho && { ortho: true as const }),
      accept: (p) => p,
    });
    this.#showPrompt();
  }

  async #collectorInput(t: string): Promise<void> {
    const c = this.#collectors.at(-1)!;
    const modifier = parsePointModifier(t);
    if (modifier) return this.#modifier(modifier, t);
    const override = parseOsnapOverride(t);
    if (override !== undefined) return this.#override(override, t);
    if (t === '' && c.enter) {
      this.#log(this.promptText);
      return this.#endCollector();
    }
    const lastPoint = c.relativeTo ?? this.#relativeBase();
    const lunits = this.#lunits();
    let p = parseCoordinate(t, this.#coordinates(lastPoint));
    // A number at an orthogonal collector: that far from its base towards the cursor (TK).
    const d = c.ortho && c.band && p === undefined ? parseDistance(t, lunits) : undefined;
    if (d !== undefined && c.band) p = orthoDistance(c.band, this.#cursor, d, this.#ucs().angle);
    if (p === undefined || p === 'invalid') return this.#reject('Invalid point.');
    this.#log(`${this.promptText} ${t}`);
    return this.#feedPoint(p);
  }

  /** Enter at a collector that ends with it: its point goes on as a point given there would. */
  async #endCollector(): Promise<void> {
    const p = this.#collectors.pop()!.enter!();
    if (this.#collectors.length > 0) return this.#feedPoint(p);
    return this.#pointFor(p, '', false);
  }

  /** A point for the innermost collector; `deferred` goes on with it through an override's. */
  async #feedPoint(p: Vec2, deferred?: DeferredPick): Promise<void> {
    const c = this.#collectors.pop()!;
    const r = c.accept(p);
    if (isCollector(r)) {
      this.#collectors.push(r);
      return this.#showPrompt();
    }
    if (isAnswer(r)) return this.#deliver(r.answer, '', false);
    // An override's "of" hands the point on as it came; any other collector made a new one.
    const kept = r === p ? deferred : undefined;
    if (this.#collectors.length > 0) return this.#feedPoint(r, kept);
    return this.#pointFor(r, '', false, kept);
  }

  /** A point given at the command's prompt: the point itself, or a distance or angle from it. */
  async #pointFor(
    p: Vec2,
    echo: string,
    log = true,
    deferred?: DeferredPick,
    ctrl?: true,
  ): Promise<void> {
    const frame = this.#stack.at(-1)!;
    // A point made with FROM or a filter at "Select objects" picks there.
    if (frame.select) return this.#step(frame, await frame.select.point(p));
    const prompt = frame.prompt!;
    if (prompt.kind === 'point') {
      return this.#deliver({ kind: 'point', point: p, ...(deferred && { deferred }) }, echo, log);
    }
    if (prompt.kind !== 'distance' && prompt.kind !== 'angle') {
      return this.#reject(INVALID[prompt.kind]);
    }
    if (log) this.#log(`${this.promptText} ${echo}`.trimEnd());
    this.#lastPoint = p;
    // A turn picked counts from the UCS's X axis, as a direction picked counts from the world's
    // (M3-06 part 8): ROTATE by a point along the UCS's X axis turns nothing.
    const turn = prompt.kind === 'angle' && prompt.turn ? this.#ucs().angle : 0;
    const measure = (a: Vec2, b: Vec2, c?: true): PromptAnswer =>
      prompt.kind === 'distance'
        ? {
            kind: 'distance',
            value: Math.hypot(b.x - a.x, b.y - a.y),
            to: b,
            ...(c && { ctrl: c }),
          }
        : { kind: 'angle', value: Math.atan2(b.y - a.y, b.x - a.x) - turn, ...(c && { ctrl: c }) };
    if (prompt.base) return this.#deliver(measure(prompt.base, p, ctrl), '', false);
    this.#collectors.push({
      text: 'Specify second point:',
      accept: (q) => ({ answer: measure(p, q) }),
    });
    this.#showPrompt();
  }

  /** Hands an answer to the innermost command, unless its prompt cannot take it. */
  async #deliver(answer: PromptAnswer, echo: string, log = true): Promise<void> {
    const frame = this.#stack.at(-1)!;
    const prompt = frame.prompt!;
    let given = answer.kind === 'enter' && prompt.default ? prompt.default : answer;
    // A deferred snap reaches only a prompt that solves it; anywhere else it is its point.
    if (given.kind === 'point' && given.deferred && !takesDeferred(prompt, given.deferred)) {
      const { deferred: _, ...plain } = given;
      given = plain;
    }
    // Ctrl reaches only a prompt that switches an arc's direction with it (M3-01 part 6), makes
    // a copy with it (M3-05 part 2) or sizes a table with it (M4-05 part 6).
    if (
      'ctrl' in given &&
      given.ctrl &&
      !prompt.switchDirection &&
      !prompt.ctrlCopies &&
      !prompt.ctrlSizesTable
    ) {
      const { ctrl: _, ...plain } = given;
      given = plain;
    }
    if (!answerFits(prompt, given)) {
      if (log) this.#log(`${this.promptText} ${echo}`.trimEnd());
      return this.#reject(INVALID[prompt.kind]);
    }
    // A dialog's answer is not a line of command history, as AutoCAD logs nothing for it.
    if (log && prompt.kind !== 'dialog') this.#log(`${this.promptText} ${echo}`.trimEnd());
    if (given.kind === 'point') this.#lastPoint = given.point;
    frame.prompt = undefined;
    await this.#advance(frame, given);
  }
}

/** Model space's BLOCK_RECORD: `*Model_Space`, as AutoCAD names it whatever the file's case. */
export function modelSpaceOf(model: DocumentModel): Handle {
  for (const r of model.tables.blockRecords.values()) {
    if (r.name.toUpperCase() === '*MODEL_SPACE') return r.handle;
  }
  throw new Error('the drawing has no *Model_Space block record');
}

/** The grip of `ids` nearest `p` within `within`, or undefined (M2-06). */
function nearestGrip(
  model: DocumentModel,
  ids: readonly EntityId[],
  p: Vec2,
  within: number,
): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestD = within;
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    for (const g of gripsOf(e.geom, gripInfoOf(model, e))) {
      const d = distance(g.point, p);
      if (d <= bestD) {
        best = g.point;
        bestD = d;
      }
    }
  }
  return best;
}

/** Whether a prompt solves this deferred TAN or PER (M3-01 part 2). */
function takesDeferred(prompt: Prompt, d: DeferredPick): boolean {
  if (prompt.kind !== 'point' || !prompt.deferred) return false;
  return (prompt.deferred.modes & OSNAP[d.mode]) !== 0;
}

/**
 * What a typed object snap override asks: AutoCAD's "to" after TANgent, PERpendicular and
 * NEArest ("_tan to"), "of" after the others ("_end of").
 */
function overrideAsks(modes: number): string {
  const to = OSNAP.TAN | OSNAP.PER | OSNAP.NEA;
  return modes !== 0 && (modes & ~to) === 0 ? 'to' : 'of';
}
