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
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { SelectionLoop, type StepResult } from '../selection/loop';
import { onLockedLayers } from '../selection/rules';
import type { Entity, EntityGeometry } from '../model/types';
import { hasEditableAttributes } from './modify/attributes';
import { textEdited } from './draw/text';
import {
  prompts,
  type CommandContext,
  type CommandDef,
  type CommandGenerator,
  type CommandRegistry,
} from './command';
import {
  DEFAULT_ANGLES,
  parseAngle,
  parseCoordinate,
  parseNumber,
  parseOsnapOverride,
  parsePointModifier,
  type AngleConvention,
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
  type SelectionWindow,
} from './prompt';
import { NO_VIEW, type ViewHost } from './view/host';
import { GRIP_OBJECT_LIMIT, gripCommand } from './modify/grips';
import { gripsOf } from '../edit/grips';
import { revcloudOf } from '../edit/revcloud';
import type { DimensionRegenerator } from '../edit/dimension-block';
import { distance } from '../geom/vec';
import { UndoStack, type UndoAction, type UndoState } from './undo';
import { applyPropertyEdit, type PropertyEdit } from '../properties/edit';
import { filtered } from '../properties/sheet';
import type { EntityType } from '../model/types';
import { refusalMessages } from '../edit/edit';

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
export interface CommandRecord {
  readonly command: string;
  readonly changes: readonly ChangeSet[];
}

export type BusEvent =
  /** The bus waits at this prompt; `text` is the line the command line shows (`>>` when nested). */
  | { readonly type: 'prompt'; readonly prompt: Prompt; readonly text: string }
  /** No command runs: the `Command:` prompt. */
  | { readonly type: 'idle' }
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
  | { readonly type: 'grips'; readonly ids: readonly EntityId[]; readonly hot?: Vec2 };

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
  /** The undo history's memory bound (ARCHITECTURE.md §4.2; 256 MB by default). */
  readonly undoLimitBytes?: number | undefined;
  /** The dimension engine edited dimensions are regenerated by (M2-10 part 3); none by default. */
  readonly dimensions?: DimensionRegenerator | undefined;
}

interface Frame {
  readonly def: CommandDef;
  readonly label: string;
  readonly gen: CommandGenerator;
  readonly transparent: boolean;
  prompt: Prompt | undefined;
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
  accept(p: Vec2): Vec2 | Collector | { readonly answer: PromptAnswer };
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

const takesPoints = (p: Prompt): boolean =>
  p.kind === 'point' || p.kind === 'distance' || p.kind === 'angle';

export class PromptBus {
  readonly #model: DocumentModel;
  readonly #registry: CommandRegistry;
  readonly #apply: (change: ChangeSet) => void;
  readonly #space: () => Handle;
  readonly #view: ViewHost;
  readonly #dimensions: DimensionRegenerator | undefined;
  readonly #listeners = new Set<(e: BusEvent) => void>();
  readonly #stack: Frame[] = [];
  #collectors: Collector[] = [];
  #changes: ChangeSet[] = [];
  #last: { readonly def: CommandDef; readonly dash: boolean } | undefined;
  /** The outermost command running, whose record `#close` makes. */
  #current: CommandDef | undefined;
  #lastPoint: Vec2 | undefined;
  #cursor: Vec2 | undefined;
  #previewing = false;
  #queue: Promise<void> = Promise.resolve();
  readonly #history: string[] = [];
  readonly #recent: string[] = [];
  readonly #pickfirstOn: boolean;
  /** The pre-selection made at `Command:` (PICKFIRST). */
  readonly #idle: SelectionLoop;
  /** The pre-selection the running command takes at its first "Select objects" prompt. */
  #pickfirst: readonly EntityId[] | undefined;
  /** The window the pre-selection was last made with (STRETCH's, M2-06). */
  #pickfirstWindow: SelectionWindow | undefined;
  /** The hot grip while grip editing runs (M2-06). */
  #hot: Vec2 | undefined;
  /** The grips last shown, as a key, so only a change is sent. */
  #gripsShown = '';
  /** The Previous selection set. */
  #previous: readonly EntityId[] = [];
  /** The selection last shown (the `selection` event). */
  #shown: readonly EntityId[] = [];
  readonly #undo: UndoStack;

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
    this.#pickfirstOn = options.pickfirst ?? true;
    this.#idle = this.#selectionLoop({ message: 'Command', atCommand: true });
    this.#undo = new UndoStack({
      apply: (cs) => this.#apply(cs),
      ...(options.undoLimitBytes !== undefined ? { maxBytes: options.undoLimitBytes } : {}),
      onChange: (state, action) =>
        this.#emit(action ? { type: 'undo', state, action } : { type: 'undo', state }),
      onMessage: (line) => this.#log(line),
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
    const c = this.#collectors.at(-1);
    if (c) {
      return prompts.point({
        message: c.text.replace(/:$/, ''),
        ...(c.band && { rubberBand: { from: c.band } }),
        ...(c.osnap !== undefined && { osnap: c.osnap }),
      });
    }
    const frame = this.#stack.at(-1);
    if (!frame) return this.#idle.prompt;
    return frame.select?.prompt ?? frame.prompt;
  }

  /** The command line's prompt text. */
  get promptText(): string {
    const c = this.#collectors.at(-1);
    if (c) return this.#nested(c.text);
    const prompt = this.prompt;
    return prompt
      ? this.#nested(formatPrompt(prompt, this.#precision(), this.#anglePrecision()))
      : 'Command:';
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

  /** Typed input, ended by Enter: a command at `Command:`, an answer otherwise. */
  submit(text: string): Promise<void> {
    return this.#enqueue(() => this.#input(text));
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
      const prompt = this.#stack.at(-1)?.prompt;
      if (!prompt?.escape) return this.#cancel();
      this.#log(`${this.promptText} *Cancel*`);
      this.#collectors = [];
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
   * `release` ends a dragged window and does nothing when no window is open. `missed` says the
   * prompt's object snap override found nothing at the point, which refuses it (M2-04).
   */
  pick(
    point: Vec2,
    o: {
      readonly shift?: boolean;
      readonly release?: boolean;
      readonly grip?: number;
      readonly missed?: boolean;
    } = {},
  ): Promise<void> {
    return this.#enqueue(async () => {
      this.#cursor = point;
      // AutoCAD refuses a pick an override found no object at with "Invalid point." and asks
      // again; its help does not say what follows, so the override stays for the next pick.
      if (o.missed && this.#collectors.at(-1)?.osnap) return this.#reject('Invalid point.');
      const frame = this.#stack.at(-1);
      // A click on a grip of the selection at `Command:` starts grip editing (M2-06): `grip` is
      // how near, in drawing units, the canvas counts as on a grip.
      if (!frame && o.grip !== undefined && !o.shift && !o.release && !this.#idle.wantsPoint) {
        const ids = this.#gripIds();
        const hot = ids.length > 0 ? nearestGrip(this.#model, ids, point, o.grip) : undefined;
        if (hot) {
          this.#hot = hot;
          return this.#start(gripCommand(ids, hot), false, false);
        }
      }
      if (frame?.select && this.#collectors.length === 0) {
        return this.#step(frame, await frame.select.point(point, o));
      }
      if (frame) return o.release ? undefined : this.#direct({ kind: 'point', point });
      if (!this.#pickfirstOn) return;
      this.#step(undefined, await this.#idle.point(point, o));
    });
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
      if (top && !top.def.keepsSelection) return;
      const r = await this.#view.request({ op: 'pick', point });
      const ids = r.ok ? (r.ids ?? []) : [];
      const id = ids.find((i) => doubleClickCommand(this.#model.entity(i)) !== undefined);
      if (id === undefined) return;
      const found = this.#registry.resolve(doubleClickCommand(this.#model.entity(id))!);
      if (!found) return;
      if (top) await this.#cancel();
      this.#idle.clear();
      this.#idle.set([id]);
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
   * A Properties palette edit (M2-21): `edit` set on the objects selected at `Command:` (of the
   * type `filter`, when the palette shows one type). One undo step, which the command line does
   * not echo, as AutoCAD's palette edits; the objects stay selected. A command running is
   * cancelled first, as a palette or ribbon button does (^C^C); grip editing keeps its
   * selection, so the edit applies to it.
   */
  setProperty(edit: PropertyEdit, filter?: EntityType): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#stack.length > 0) await this.#cancel();
      const ids = [...this.#idle.ids];
      if (ids.length === 0) return;
      const model = this.#model;
      const def: CommandDef = {
        name: 'PROPERTIES',
        usesSelection: 'none',
        keepsSelection: true,
        // eslint-disable-next-line require-yield -- the palette gave the value
        async *run(ctx) {
          let report: ReturnType<typeof applyPropertyEdit> | undefined;
          ctx.edit((b) => {
            report = applyPropertyEdit(b, model, filtered(model, ids, filter), edit);
          });
          if (report!.invalid) ctx.message(`${report!.invalid}.`);
          for (const line of refusalMessages(report!.refused, 'changed')) ctx.message(line);
        },
      };
      await this.#start(def, false, false);
    });
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

  #precision(): number {
    const v = this.#model.header.get('$LUPREC');
    return typeof v === 'number' && v >= 0 && v <= 8 ? v : 4;
  }

  /** AUPREC: decimal places of angles shown in degrees (AutoCAD's default 0). */
  #anglePrecision(): number {
    const v = this.#model.header.get('$AUPREC');
    return typeof v === 'number' && v >= 0 && v <= 8 ? v : 0;
  }

  /** ANGBASE (radians, as acad-ts carries the header) and ANGDIR, for typed angles. */
  #angles(): AngleConvention {
    const base = this.#model.header.get('$ANGBASE');
    const dir = this.#model.header.get('$ANGDIR');
    return {
      base: typeof base === 'number' ? base : DEFAULT_ANGLES.base,
      clockwise: dir === 1 || dir === true,
    };
  }

  #showPrompt(): void {
    const prompt = this.prompt;
    if (prompt) this.#emit({ type: 'prompt', prompt, text: this.promptText });
    else this.#emit({ type: 'idle' });
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
        const p = parseCoordinate(text.trim(), {
          lastPoint: this.#lastPoint,
          angles: this.#angles(),
        });
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
    const echo = formatAnswer(answer, this.#precision(), this.#anglePrecision());
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
      if (answer.kind !== 'point') return this.#reject('Invalid point.');
      this.#log(`${this.promptText} ${echo}`.trimEnd());
      return this.#feedPoint(answer.point);
    }
    if (answer.kind === 'point' && frame.prompt!.kind !== 'point' && takesPoints(frame.prompt!)) {
      return this.#pointFor(answer.point, echo);
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
    const found = this.#registry.resolve(t);
    if (!found) return this.#reject(`Unknown command "${t.toUpperCase()}".  Press F1 for help.`);
    return this.#start(found.def, found.dash, false);
  }

  async #transparent(text: string): Promise<void> {
    const name = text.slice(1);
    this.#log(`${this.promptText} ${text}`);
    const found = this.#registry.resolve(name);
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
      if (!def.transparent && !def.keepsSelection) this.#idle.clear();
      this.#showSelection();
    }
    const ctx = this.#context(dash, transparent);
    const frame: Frame = {
      def,
      label: `${dash ? '-' : ''}${def.name}`,
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
      get space() {
        return bus.#space();
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
      view: this.#view,
      dimensions: this.#dimensions,
    };
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
    if (step.done) return this.#end(frame, false);
    frame.prompt = step.value;
    if (step.value.kind === 'selection') return this.#beginSelection(frame, step.value);
    this.#showPrompt();
  }

  /** A "Select objects" prompt: answered by the pre-selection, or built pick by pick. */
  async #beginSelection(frame: Frame, prompt: Extract<Prompt, { kind: 'selection' }>) {
    const pre =
      frame.transparent || (prompt.single && !prompt.pickfirst) ? undefined : this.#pickfirst;
    const preWindow = this.#pickfirstWindow;
    this.#pickfirst = this.#pickfirstWindow = undefined;
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
      });
    }
    frame.select = this.#selectionLoop({
      message: prompt.message,
      ...(prompt.options && { options: prompt.options }),
      ...(prompt.editable && { editable: true }),
      ...(prompt.single && { single: true }),
      ...(prompt.defaultLabel !== undefined && { defaultLabel: prompt.defaultLabel }),
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
      },
      o,
    );
  }

  /** Text at "Select objects": Enter ends it, then a command option, a mode or a point. */
  async #selectionInput(frame: Frame, loop: SelectionLoop, t: string): Promise<void> {
    if (t === '') {
      if (loop.wantsPoint) return this.#reject('Invalid window specification.');
      return this.#finishSelection(frame, loop);
    }
    const parsePoint = () => {
      const p = parseCoordinate(t, { lastPoint: this.#lastPoint, angles: this.#angles() });
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
    return this.#deliver(
      { kind: 'selection', ids, ...(window && { window }), ...(pick && { pick }) },
      '',
      false,
    );
  }

  /** The selection at `Command:` grips show on: none past GRIPOBJLIMIT. */
  #gripIds(): readonly EntityId[] {
    const ids = this.#idle.ids;
    return ids.length <= GRIP_OBJECT_LIMIT ? ids : [];
  }

  #showGrips(): void {
    const top = this.#stack.at(-1);
    const ids = !top || (top.def.keepsSelection && this.#hot) ? this.#gripIds() : [];
    const hot = top ? this.#hot : undefined;
    const key = `${ids.join(',')}|${hot ? `${hot.x},${hot.y}` : ''}`;
    if (key === this.#gripsShown) return;
    this.#gripsShown = key;
    this.#emit({ type: 'grips', ids: [...ids], ...(hot && ids.length > 0 && { hot }) });
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
    const keyword = matchKeyword(t, prompt.options ?? []);
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
        const p = parseCoordinate(t, { lastPoint: this.#lastPoint, angles });
        if (p !== undefined && p !== 'invalid') return this.#pointFor(p, t);
        const arbitrary = prompt.kind !== 'angle' && prompt.arbitrary;
        if (arbitrary && (prompt.kind === 'point' || parseNumber(t) === undefined)) {
          return this.#deliver({ kind: 'string', value: t }, t);
        }
        if (prompt.kind === 'distance') {
          const d = parseNumber(t);
          if (d !== undefined) return this.#deliver({ kind: 'distance', value: d }, t);
        } else if (prompt.kind === 'angle') {
          const a = parseAngle(t, angles);
          if (a !== undefined) return this.#deliver({ kind: 'angle', value: a }, t);
        } else {
          const d = parseNumber(t);
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
      this.#collectors.push({
        text: `.${m.take === '' ? 'Z' : m.take.toUpperCase()} of`,
        accept: (a) => ({
          text: `(need ${need}):`,
          accept: (b) => ({ x: m.take === 'x' ? a.x : b.x, y: m.take === 'y' ? a.y : b.y }),
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
    this.#log(`${this.promptText} ${echo}`);
    this.#collectors.push({ text: 'of', osnap: modes, ...(band && { band }), accept: (p) => p });
    this.#showPrompt();
  }

  async #collectorInput(t: string): Promise<void> {
    const c = this.#collectors.at(-1)!;
    const modifier = parsePointModifier(t);
    if (modifier) return this.#modifier(modifier, t);
    const override = parseOsnapOverride(t);
    if (override !== undefined) return this.#override(override, t);
    const lastPoint = c.relativeTo ?? this.#lastPoint;
    const p = parseCoordinate(t, { lastPoint, angles: this.#angles() });
    if (p === undefined || p === 'invalid') return this.#reject('Invalid point.');
    this.#log(`${this.promptText} ${t}`);
    return this.#feedPoint(p);
  }

  async #feedPoint(p: Vec2): Promise<void> {
    const c = this.#collectors.pop()!;
    const r = c.accept(p);
    if (isCollector(r)) {
      this.#collectors.push(r);
      return this.#showPrompt();
    }
    if (isAnswer(r)) return this.#deliver(r.answer, '', false);
    if (this.#collectors.length > 0) return this.#feedPoint(r);
    return this.#pointFor(r, '', false);
  }

  /** A point given at the command's prompt: the point itself, or a distance or angle from it. */
  async #pointFor(p: Vec2, echo: string, log = true): Promise<void> {
    const frame = this.#stack.at(-1)!;
    // A point made with FROM or a filter at "Select objects" picks there.
    if (frame.select) return this.#step(frame, await frame.select.point(p));
    const prompt = frame.prompt!;
    if (prompt.kind === 'point') return this.#deliver({ kind: 'point', point: p }, echo, log);
    if (prompt.kind !== 'distance' && prompt.kind !== 'angle') {
      return this.#reject(INVALID[prompt.kind]);
    }
    if (log) this.#log(`${this.promptText} ${echo}`.trimEnd());
    this.#lastPoint = p;
    const measure = (a: Vec2, b: Vec2): PromptAnswer =>
      prompt.kind === 'distance'
        ? { kind: 'distance', value: Math.hypot(b.x - a.x, b.y - a.y) }
        : { kind: 'angle', value: Math.atan2(b.y - a.y, b.x - a.x) };
    if (prompt.base) return this.#deliver(measure(prompt.base, p), '', false);
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
    const given = answer.kind === 'enter' && prompt.default ? prompt.default : answer;
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
    for (const g of gripsOf(e.geom, revcloudOf(model, e))) {
      const d = distance(g.point, p);
      if (d <= bestD) {
        best = g.point;
        bestD = d;
      }
    }
  }
  return best;
}
