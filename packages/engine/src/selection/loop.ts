// "Select objects" (M2-03): the selection a command asks for, built pick by pick on the PromptBus
// as AutoCAD's object selection builds it (AutoCAD 2024 Help, "SELECT (Command)", "To Select
// Objects", PICKADD, PICKAUTO):
//   - a pick takes the nearest object under the pickbox; where it finds none, a window starts
//     (implied windowing): dragged or clicked left to right it takes the objects wholly inside,
//     right to left (a crossing window) whatever it crosses as well;
//   - Shift with a pick or a window removes (PICKADD 2); Remove and Add switch the mode;
//   - Window, Crossing and BOX ask for the corners; ALL, Last and Previous take those sets;
//     Undo takes back the last step; AUto is the default behaviour; SIngle ends at the first
//     selection;
//   - each step says "n found, m total" as AutoCAD words it.
// The same loop, without a prompt of its own, is the pre-selection made at `Command:` (PICKFIRST).
// Fence, WPolygon, CPolygon, Group and Multiple are not taken yet; they say so like AutoCAD does
// for any word it does not know.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { matchKeyword, type Prompt, type SelectionWindow } from '../commands/prompt';
import type { ViewReply, ViewRequest } from '../commands/view/host';
import { inSpace, onLockedLayers, selectAll, selectLast } from './rules';

/** The modes typed at "Select objects", in AutoCAD's display form. */
export const SELECTION_MODES = [
  'Window',
  'Last',
  'Crossing',
  'BOX',
  'ALL',
  'Add',
  'Remove',
  'Previous',
  'Undo',
  'AUto',
  'SIngle',
] as const;

const INVALID = '*Invalid selection*';
const EXPECTS = `Expects a point or ${SELECTION_MODES.join('/')}`;

export interface SelectionLoopHost {
  readonly model: DocumentModel;
  /** The space objects are selected in. */
  space(): Handle;
  /** Asks the canvas what a pick or a window takes (`pick`, `select` view requests). */
  request(r: ViewRequest): Promise<ViewReply>;
  log(line: string): void;
  /** The Previous selection set. */
  previous(): readonly EntityId[];
}

export interface SelectionLoopOptions {
  /** The prompt's own message and options ("Select objects"). */
  readonly message: string;
  readonly options?: readonly string[];
  /** Objects on locked layers are refused (a command that edits). */
  readonly editable?: boolean;
  /** The pre-selection at `Command:`, which shows no prompt but its window's corner. */
  readonly atCommand?: boolean;
  /** Ends at the first step that takes objects, as SIngle does (M2-08). */
  readonly single?: boolean;
}

/** What a step did: the selection is complete (SIngle), or the loop goes on. */
export type StepResult = 'done' | 'more';

interface Corner {
  readonly from: Vec2;
  /** `auto` takes its kind from the direction (implied windowing and BOX). */
  readonly kind: 'auto' | 'window' | 'crossing';
  readonly remove: boolean;
}

export class SelectionLoop {
  readonly #host: SelectionLoopHost;
  readonly #o: SelectionLoopOptions;
  #ids: EntityId[] = [];
  readonly #undo: EntityId[][] = [];
  #remove = false;
  #single = false;
  /** W or C typed: waiting for the first corner. */
  #first: 'window' | 'crossing' | 'auto' | undefined;
  #corner: Corner | undefined;
  /** The last window that added objects (STRETCH's window, M2-06). */
  #window: SelectionWindow | undefined;

  constructor(host: SelectionLoopHost, o: SelectionLoopOptions) {
    this.#host = host;
    this.#o = o;
    this.#single = o.single === true;
  }

  get ids(): readonly EntityId[] {
    return this.#ids;
  }

  /** The last window or crossing window that added objects, if any. */
  get window(): SelectionWindow | undefined {
    return this.#window;
  }

  /** A corner is asked for: the next point completes a window rather than picking. */
  get wantsPoint(): boolean {
    return this.#first !== undefined || this.#corner !== undefined;
  }

  /** The prompt shown now; at `Command:` only while a window's corner is asked for. */
  get prompt(): Prompt | undefined {
    if (this.#first) return { kind: 'point', message: 'Specify first corner' };
    const c = this.#corner;
    if (c) {
      return {
        kind: 'point',
        message: 'Specify opposite corner',
        rubberBand: { from: c.from, box: true, selection: c.kind },
      };
    }
    if (this.#o.atCommand) return undefined;
    return {
      kind: 'selection',
      message: this.#remove ? 'Remove objects' : this.#o.message,
      ...(this.#o.options && { options: this.#o.options }),
    };
  }

  /** Replaces the set (the pre-selection carried into a command, Ctrl+A at `Command:`). */
  set(ids: readonly EntityId[]): void {
    this.#ids = [...new Set(ids)];
  }

  /** Esc at `Command:`: the window and the pre-selection go. */
  clear(): void {
    this.#ids = [];
    this.#undo.length = 0;
    this.#window = undefined;
    this.cancelWindow();
  }

  /** A window waiting for a corner is dropped (a command typed at `Command:` instead). */
  cancelWindow(): void {
    this.#first = this.#corner = undefined;
  }

  /** Drops objects that no longer exist (erased). Returns whether any went. */
  forget(gone: ReadonlySet<EntityId>): boolean {
    const kept = this.#ids.filter((id) => !gone.has(id));
    if (kept.length === this.#ids.length) return false;
    this.#ids = kept;
    return true;
  }

  /**
   * A point: a corner when one is asked for, otherwise a pick, which starts a window where it
   * finds nothing. `release` is the end of a drag: it only ever completes a window.
   */
  async point(
    p: Vec2,
    o: { readonly shift?: boolean; readonly release?: boolean } = {},
  ): Promise<StepResult> {
    if (this.#first) {
      this.#corner = { from: p, kind: this.#first, remove: this.#remove };
      this.#first = undefined;
      return 'more';
    }
    const c = this.#corner;
    if (c) {
      this.#corner = undefined;
      const crossing = c.kind === 'auto' ? p.x < c.from.x : c.kind === 'crossing';
      const r = await this.#host.request({ op: 'select', a: c.from, b: p, crossing });
      if (!c.remove && r.ok) this.#window = { a: c.from, b: p };
      return this.#take(r, c.remove, 'Specify opposite corner:');
    }
    if (o.release) return 'more';
    const remove = this.#remove || !!o.shift;
    const r = await this.#host.request({ op: 'pick', point: p });
    const hit = r.ok ? (r.ids ?? []).find((id) => this.#host.model.entity(id)) : undefined;
    if (hit === undefined) {
      if (!r.ok) this.#say(r.message);
      this.#corner = { from: p, kind: 'auto', remove };
      return 'more';
    }
    return this.#apply([hit], remove, this.#label());
  }

  /** A mode typed at the prompt; undefined when the text names none. */
  async keyword(text: string): Promise<StepResult | undefined> {
    const mode = matchKeyword(text, SELECTION_MODES);
    if (!mode) return undefined;
    const label = `${this.#label()} ${text.trim()}`;
    const model = this.#host.model;
    const space = this.#host.space();
    switch (mode) {
      case 'Window':
      case 'Crossing':
        this.#first = mode === 'Window' ? 'window' : 'crossing';
        this.#say(label);
        return 'more';
      case 'BOX':
        this.#first = 'auto';
        this.#say(label);
        return 'more';
      case 'ALL':
        return this.#apply(selectAll(model, space), this.#remove, label);
      case 'Last': {
        const last = selectLast(model, space);
        return this.#apply(last === undefined ? [] : [last], this.#remove, label);
      }
      case 'Previous':
        return this.#apply(inSpace(model, space, this.#host.previous()), this.#remove, label);
      case 'Add':
      case 'Remove':
        this.#remove = mode === 'Remove';
        this.#say(label);
        return 'more';
      case 'Undo': {
        this.#say(label);
        const before = this.#undo.pop();
        if (before) this.#ids = before;
        else this.#say('All selection steps have been undone.');
        return 'more';
      }
      case 'AUto':
        this.#say(label);
        return 'more';
      case 'SIngle':
        this.#single = true;
        this.#say(label);
        return 'more';
      default:
        return undefined;
    }
  }

  /** Text that is no point and no mode: AutoCAD's refusal and its list of modes. */
  invalid(text: string): void {
    this.#say(`${this.#label()} ${text.trim()}`);
    this.#say(INVALID);
    this.#say(EXPECTS);
  }

  /** A line of command history; the pre-selection at `Command:` picks silently, as AutoCAD's. */
  #say(line: string): void {
    if (!this.#o.atCommand) this.#host.log(line);
  }

  #label(): string {
    return this.#remove ? 'Remove objects:' : `${this.#o.message}:`;
  }

  #take(r: ViewReply, remove: boolean, label: string): StepResult {
    if (!r.ok) {
      this.#say(`${label} ${r.message}`);
      return 'more';
    }
    return this.#apply(
      (r.ids ?? []).filter((id) => this.#host.model.entity(id)),
      remove,
      label,
    );
  }

  /** Adds or removes `found`, saying what happened as AutoCAD does. */
  #apply(found: readonly EntityId[], remove: boolean, label: string): StepResult {
    const model = this.#host.model;
    const unique = [...new Set(found)];
    const locked = this.#o.editable ? onLockedLayers(model, unique) : new Set<EntityId>();
    const taken = unique.filter((id) => !locked.has(id));
    const before = this.#ids;
    const had = new Set(before);
    let line: string;
    if (remove) {
      const out = new Set(taken.filter((id) => had.has(id)));
      this.#ids = before.filter((id) => !out.has(id));
      line = `${out.size} removed, ${this.#ids.length} total`;
    } else {
      const dup = taken.filter((id) => had.has(id)).length;
      this.#ids = [...before, ...taken.filter((id) => !had.has(id))];
      line =
        before.length === 0 && dup === 0
          ? `${unique.length} found`
          : `${unique.length} found${dup > 0 ? ` (${dup} duplicate)` : ''}, ${this.#ids.length} total`;
    }
    this.#undo.push(before);
    this.#say(`${label} ${line}`);
    if (locked.size > 0) {
      this.#say(`${locked.size} ${locked.size === 1 ? 'was' : 'were'} on a locked layer.`);
    }
    return this.#single && !remove && taken.length > 0 ? 'done' : 'more';
  }
}
