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
//   - Fence takes what a run of lines crosses, WPolygon what lies wholly inside a polygon and
//     CPolygon what it holds or crosses (M3-04): the points are asked for one by one, Undo takes
//     back the last, Enter ends it; a polygon "cannot cross or touch itself", the fence can;
//   - Group takes a named (or `*A3` unnamed) group's members; Multiple collects picks without
//     highlighting them and takes them all at Enter, each pick an object the others did not.
//   - a press that finds nothing and is dragged draws a lasso (M3-04 part 2, "To Select
//     Objects": "click, drag, and release"): released, it takes what a window, crossing or fence
//     of its path takes, as the canvas chose by the drag's direction and Spacebar.
//   - a pick over overlapping objects with selection cycling on (SELECTIONCYCLING 2) shows the
//     Selection list of them and takes the one chosen (M3-04 part 3, "To Select Overlapping or
//     Close Objects"); with it off the nearest is taken.
//   - with group selection on (PICKSTYLE bit 1, M3-08; "About Groups": "selecting any member of
//     a group selects all the objects in that group") a pick, window, path or Last that takes a
//     member of a selectable group takes (or removes) the group's other members in the space as
//     well, but not those on frozen or locked layers; "Selecting an object that belongs to
//     multiple groups selects all groups to which that object belongs".
// The same loop, without a prompt of its own, is the pre-selection made at `Command:` (PICKFIRST).
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Group, NonGraphicalObject } from '../model/types';
import { selectableMembers } from '../edit/groups';
import {
  matchKeyword,
  type Prompt,
  type SelectionTake,
  type SelectionWindow,
} from '../commands/prompt';
import type { ViewReply, ViewRequest } from '../commands/view/host';
import { typeLabel } from '../properties/sheet';
import { inSpace, onLockedLayers, selectAll, selectLast } from './rules';

/**
 * SELECTIONCYCLING (AutoCAD 2024 Help): 0 off, 1 a badge where objects overlap, 2 the badge and
 * the Selection list when one of them is picked; negative, off keeping what Ctrl+W turns back on.
 */
export const SELECTIONCYCLING = 'SELECTIONCYCLING';
const CYCLING_LIST = 2;

/**
 * PICKSTYLE (AutoCAD 2024 Help): bit 1 group selection, bit 2 associative hatch selection;
 * AutoCAD keeps it per user, initially 1. Ctrl+Shift+A turns group selection on and off.
 */
export const PICKSTYLE = 'PICKSTYLE';
export const DEFAULT_PICKSTYLE = 1;
const GROUP_SELECTION = 1;

/** The modes typed at "Select objects", in AutoCAD's display form. */
export const SELECTION_MODES = [
  'Window',
  'Last',
  'Crossing',
  'BOX',
  'ALL',
  'Fence',
  'WPolygon',
  'CPolygon',
  'Group',
  'Add',
  'Remove',
  'Multiple',
  'Previous',
  'Undo',
  'AUto',
  'SIngle',
] as const;

const INVALID = '*Invalid selection*';
/** What AutoCAD says to a polygon point that would make the polygon cross or touch itself. */
export const POLYGON_CROSSES = 'Invalid point, polygon segments cannot intersect.';
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
  /** What Enter does, shown as `<…>` (DIMANGULAR's `<specify vertex>`, M2-11). */
  readonly defaultLabel?: string;
  /** Objects on locked layers are refused (a command that edits). */
  readonly editable?: boolean;
  /** The pre-selection at `Command:`, which shows no prompt but its window's corner. */
  readonly atCommand?: boolean;
  /** Ends at the first step that takes objects, as SIngle does (M2-08). */
  readonly single?: boolean;
  /**
   * False: a member of a group is taken alone, whatever PICKSTYLE says (UNGROUP's and
   * GROUPEDIT's objects, M3-08).
   */
  readonly groups?: false;
}

/**
 * A fence or a selection polygon being drawn (M3-04): `window` is WPolygon, `crossing`
 * CPolygon, as the canvas's `selectPath` request names them.
 */
export interface SelectionPath {
  readonly kind: 'fence' | 'window' | 'crossing';
  readonly points: readonly Vec2[];
}

/** A lasso dragged from a window's first corner (M3-04 part 2): its kind and its path. */
export interface Lasso {
  readonly kind: SelectionPath['kind'];
  readonly points: readonly Vec2[];
}

const LASSO_NAMES = { window: 'Window', crossing: 'Crossing', fence: 'Fence' } as const;

/** What the command line says while a lasso is dragged, AutoCAD's words. */
export function lassoPrompt(kind: Lasso['kind']): string {
  return `${LASSO_NAMES[kind]} Lasso  Press Spacebar to cycle options`;
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
  #pick: Vec2 | undefined;
  /** The steps that took objects, how each took them (M2-27); with `#undo`'s sets. */
  #takes: SelectionTake[] = [];
  readonly #undoTakes: SelectionTake[][] = [];
  /** Fence, WPolygon or CPolygon typed: its points so far. */
  #path: { kind: SelectionPath['kind']; points: Vec2[]; remove: boolean } | undefined;
  /** Group typed: its name is asked for. */
  #group = false;
  /** Multiple typed: the picks made so far, taken at Enter. */
  #multiple: Vec2[] | undefined;

  constructor(host: SelectionLoopHost, o: SelectionLoopOptions) {
    this.#host = host;
    this.#o = o;
    this.#single = o.single === true;
  }

  get ids(): readonly EntityId[] {
    return this.#ids;
  }

  /** The last window or crossing window that added objects, if any. */
  /** Where the last pick that took an object was made (DIMLINEAR's object, M2-11). */
  get pick(): Vec2 | undefined {
    return this.#pick;
  }

  get window(): SelectionWindow | undefined {
    return this.#window;
  }

  /** How the objects in the set were taken, step by step (-ATTEDIT's attributes, M2-27). */
  get takes(): readonly SelectionTake[] {
    return this.#takes;
  }

  /** A corner is asked for: the next point completes a window rather than picking. */
  get wantsPoint(): boolean {
    return this.#first !== undefined || this.#corner !== undefined || this.#path !== undefined;
  }

  /** A fence or polygon is being drawn: Enter ends it and Undo takes back its last point. */
  get drawingPath(): boolean {
    return this.#path !== undefined;
  }

  /** Group's name is asked for. */
  get wantsName(): boolean {
    return this.#group;
  }

  /** The prompt shown now; at `Command:` only while a window's corner is asked for. */
  get prompt(): Prompt | undefined {
    if (this.#first) return { kind: 'point', message: 'Specify first corner' };
    if (this.#path) return pathPrompt(this.#path.kind, this.#path.points);
    if (this.#group) return { kind: 'string', message: 'Enter group name' };
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
      ...(!this.#remove &&
        this.#o.defaultLabel !== undefined && {
          defaultLabel: this.#o.defaultLabel,
        }),
    };
  }

  /**
   * Replaces the set (the pre-selection carried into a command, Ctrl+A at `Command:`), `pick`
   * where it was picked (a double click, M2-27).
   */
  set(ids: readonly EntityId[], pick?: Vec2): void {
    this.#ids = [...new Set(ids)];
    this.#pick = pick;
    this.#takes = pick && this.#ids.length > 0 ? [{ ids: this.#ids, pick }] : [];
  }

  /** Esc at `Command:`: the window and the pre-selection go. */
  clear(): void {
    this.#ids = [];
    this.#undo.length = this.#undoTakes.length = 0;
    this.#takes = [];
    this.#window = this.#pick = undefined;
    this.cancelWindow();
  }

  /** A window waiting for a corner is dropped (a command typed at `Command:` instead). */
  cancelWindow(): void {
    this.#first = this.#corner = this.#path = this.#multiple = undefined;
    this.#group = false;
  }

  /** Drops objects that no longer exist (erased). Returns whether any went. */
  forget(gone: ReadonlySet<EntityId>): boolean {
    const kept = this.#ids.filter((id) => !gone.has(id));
    if (kept.length === this.#ids.length) return false;
    this.#ids = kept;
    this.#takes = without(this.#takes, gone);
    return true;
  }

  /**
   * A point: a corner when one is asked for, otherwise a pick, which starts a window where it
   * finds nothing. `release` is the end of a drag: it only ever completes a window, or the
   * `lasso` dragged from its first corner.
   */
  async point(
    p: Vec2,
    o: { readonly shift?: boolean; readonly release?: boolean; readonly lasso?: Lasso } = {},
  ): Promise<StepResult> {
    if (this.#first) {
      this.#corner = { from: p, kind: this.#first, remove: this.#remove };
      this.#first = undefined;
      return 'more';
    }
    const c = this.#corner;
    const lasso = o.release ? o.lasso : undefined;
    // A path that cannot hold anything ends as the window it started (a straight drag).
    if (c && lasso && lasso.points.length >= (lasso.kind === 'fence' ? 2 : 3)) {
      this.#corner = undefined;
      const r = await this.#host.request({
        op: 'selectPath',
        kind: lasso.kind,
        points: lasso.points,
      });
      return await this.#take(r, c.remove, `${lassoPrompt(lasso.kind)}:`, {});
    }
    if (c) {
      this.#corner = undefined;
      const crossing = c.kind === 'auto' ? p.x < c.from.x : c.kind === 'crossing';
      const r = await this.#host.request({ op: 'select', a: c.from, b: p, crossing });
      const window = { a: c.from, b: p };
      if (!c.remove && r.ok) this.#window = window;
      return await this.#take(r, c.remove, 'Specify opposite corner:', { window, crossing });
    }
    if (o.release) return 'more';
    const path = this.#path;
    if (path) {
      if (path.kind !== 'fence' && polygonCrosses(path.points, p)) {
        this.#say(POLYGON_CROSSES);
        return 'more';
      }
      path.points.push(p);
      return 'more';
    }
    if (this.#group) return 'more';
    if (this.#multiple) {
      this.#multiple.push(p);
      return 'more';
    }
    const remove = this.#remove || !!o.shift;
    const r = await this.#host.request({ op: 'pick', point: p });
    const hits = r.ok ? (r.ids ?? []).filter((id) => this.#host.model.entity(id)) : [];
    if (hits.length === 0) {
      if (!r.ok) this.#say(r.message);
      this.#corner = { from: p, kind: 'auto', remove };
      return 'more';
    }
    const hit = hits.length > 1 ? await this.#cycle(p, hits) : hits[0];
    // The Selection list dismissed: nothing taken, and no window either.
    if (hit === undefined) return 'more';
    if (!remove) this.#pick = p;
    const { ids, groups } = await this.#grouped([hit]);
    return this.#apply(ids, remove, this.#label(), { pick: p }, groups);
  }

  /**
   * Overlapping objects under a pick (M3-04 part 3): with SELECTIONCYCLING 2 the drafter chooses
   * one from the Selection list; otherwise, as with cycling off, the nearest is taken.
   */
  async #cycle(p: Vec2, hits: readonly EntityId[]): Promise<EntityId | undefined> {
    const mode = await this.#host.request({ op: 'sysvar', name: SELECTIONCYCLING });
    if (!(mode.ok && mode.value === CYCLING_LIST)) return hits[0];
    const model = this.#host.model;
    const r = await this.#host.request({
      op: 'cycle',
      point: p,
      candidates: hits.map((id) => ({ id, label: typeLabel(model.entity(id)!.type) })),
    });
    // A canvas that cannot show the list takes the nearest, as cycling off would.
    if (!r.ok) return hits[0];
    return (r.ids ?? []).find((id) => hits.includes(id));
  }

  /** A mode typed at the prompt; undefined when the text names none. */
  async keyword(text: string): Promise<StepResult | undefined> {
    const mode = matchKeyword(text, SELECTION_MODES);
    if (!mode) return undefined;
    // A mode typed after Multiple's picks takes them first, as Enter would.
    if (this.#multiple) {
      const step = await this.#endMultiple();
      if (step === 'done') return step;
    }
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
      case 'Fence':
      case 'WPolygon':
      case 'CPolygon':
        this.#path = {
          kind: mode === 'Fence' ? 'fence' : mode === 'WPolygon' ? 'window' : 'crossing',
          points: [],
          remove: this.#remove,
        };
        this.#say(label);
        return 'more';
      case 'Group':
        this.#group = true;
        this.#say(label);
        return 'more';
      case 'Multiple':
        this.#multiple = [];
        this.#say(label);
        return 'more';
      case 'ALL':
        return this.#apply(selectAll(model, space), this.#remove, label);
      case 'Last': {
        const last = selectLast(model, space);
        const { ids, groups } = await this.#grouped(last === undefined ? [] : [last]);
        return this.#apply(ids, this.#remove, label, {}, groups);
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
        const takes = this.#undoTakes.pop();
        if (before) {
          this.#ids = before;
          this.#takes = takes ?? [];
        } else this.#say('All selection steps have been undone.');
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

  /**
   * Enter at a step of its own: it ends a fence or polygon (taking what it selects), Multiple's
   * picks, or the group name asked for. Undefined when Enter ends the selection instead.
   */
  async enter(): Promise<StepResult | undefined> {
    if (this.#path) return this.#endPath();
    if (this.#multiple) return this.#endMultiple();
    if (this.#group) {
      this.#group = false;
      return 'more';
    }
    return undefined;
  }

  /** Undo while a fence or polygon is drawn: its last point goes (all gone, the first is asked). */
  undoPoint(text: string): void {
    const path = this.#path;
    if (!path) return;
    this.#say(`${formatPathPrompt(path.kind, path.points)} ${text.trim()}`);
    path.points.pop();
  }

  /** The group named at "Enter group name": its members in the space are taken. */
  name(text: string): StepResult {
    this.#group = false;
    const name = text.trim();
    const label = `Enter group name: ${name}`;
    const model = this.#host.model;
    const key = name.toUpperCase();
    let group: Group | undefined;
    for (const o of model.objects.values()) {
      if (o.type === 'GROUP' && (o as Group).name.toUpperCase() === key) group = o as Group;
    }
    if (!group) {
      this.#say(label);
      this.#say(`Group "${name}" has not been defined.`);
      return 'more';
    }
    const space = this.#host.space();
    const ids = group.entities.flatMap((h) => {
      const e = model.entityByHandle(h);
      return e && e.owner === space ? [e.id] : [];
    });
    return this.#apply(ids, this.#remove, label);
  }

  async #endPath(): Promise<StepResult> {
    const path = this.#path!;
    this.#path = undefined;
    const label = formatPathPrompt(path.kind, path.points);
    if (path.points.length === 0) return 'more';
    const r = await this.#host.request({
      op: 'selectPath',
      kind: path.kind,
      points: path.points,
    });
    return await this.#take(r, path.remove, label, {});
  }

  /** Multiple's picks: each takes the nearest object under it that no other pick took. */
  async #endMultiple(): Promise<StepResult> {
    const picks = this.#multiple!;
    this.#multiple = undefined;
    if (picks.length === 0) return 'more';
    const found: EntityId[] = [];
    for (const p of picks) {
      const r = await this.#host.request({ op: 'pick', point: p });
      const hit = r.ok
        ? (r.ids ?? []).find((id) => this.#host.model.entity(id) && !found.includes(id))
        : undefined;
      if (hit !== undefined) found.push(hit);
    }
    const { ids, groups } = await this.#grouped(found);
    return this.#apply(ids, this.#remove, this.#label(), {}, groups);
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

  async #take(
    r: ViewReply,
    remove: boolean,
    label: string,
    how: Omit<SelectionTake, 'ids'>,
  ): Promise<StepResult> {
    if (!r.ok) {
      this.#say(`${label} ${r.message}`);
      return 'more';
    }
    const { ids, groups } = await this.#grouped(
      (r.ids ?? []).filter((id) => this.#host.model.entity(id)),
    );
    return this.#apply(ids, remove, label, how, groups);
  }

  /**
   * `found` with the other members of the selectable groups it takes, while group selection is
   * on (PICKSTYLE), and how many groups that is. PICKSTYLE is only asked for when `found` holds
   * a member of one.
   */
  async #grouped(found: readonly EntityId[]): Promise<{ ids: EntityId[]; groups: number }> {
    const ids = [...found];
    const model = this.#host.model;
    if (this.#o.groups === false || ids.length === 0) return { ids, groups: 0 };
    const handles = new Set(ids.map((id) => model.ids.handleOf(id)));
    const hit = [...model.objects.values()].filter(
      (o: NonGraphicalObject): o is Group =>
        o.type === 'GROUP' &&
        (o as Group).selectable &&
        (o as Group).entities.some((h) => handles.has(h)),
    );
    if (hit.length === 0) return { ids, groups: 0 };
    const style = await this.#host.request({ op: 'sysvar', name: PICKSTYLE });
    const mode = style.ok && typeof style.value === 'number' ? style.value : DEFAULT_PICKSTYLE;
    if ((mode & GROUP_SELECTION) === 0) return { ids, groups: 0 };
    const space = this.#host.space();
    const seen = new Set(ids);
    for (const g of hit) {
      for (const id of selectableMembers(model, g, space)) {
        if (!seen.has(id)) ids.push(id);
        seen.add(id);
      }
    }
    return { ids, groups: hit.length };
  }

  /** Adds or removes `found`, saying what happened as AutoCAD does. */
  #apply(
    found: readonly EntityId[],
    remove: boolean,
    label: string,
    how: Omit<SelectionTake, 'ids'> = {},
    groups = 0,
  ): StepResult {
    const model = this.#host.model;
    const unique = [...new Set(found)];
    const locked = this.#o.editable ? onLockedLayers(model, unique) : new Set<EntityId>();
    const taken = unique.filter((id) => !locked.has(id));
    const before = this.#ids;
    const had = new Set(before);
    this.#undoTakes.push(this.#takes);
    let line: string;
    // "3 found, 1 group": AutoCAD names the groups a step took after the objects it found.
    const took = `${unique.length} found${groups > 0 ? `, ${groups} group${groups === 1 ? '' : 's'}` : ''}`;
    if (remove) {
      const out = new Set(taken.filter((id) => had.has(id)));
      this.#ids = before.filter((id) => !out.has(id));
      this.#takes = without(this.#takes, out);
      line = `${out.size} removed, ${this.#ids.length} total`;
    } else {
      const dup = taken.filter((id) => had.has(id)).length;
      this.#ids = [...before, ...taken.filter((id) => !had.has(id))];
      if (taken.length > 0) this.#takes = [...this.#takes, { ids: taken, ...how }];
      line =
        before.length === 0 && dup === 0
          ? took
          : `${took}${dup > 0 ? ` (${dup} duplicate)` : ''}, ${this.#ids.length} total`;
    }
    this.#undo.push(before);
    this.#say(`${label} ${line}`);
    if (locked.size > 0) {
      this.#say(`${locked.size} ${locked.size === 1 ? 'was' : 'were'} on a locked layer.`);
    }
    return this.#single && !remove && taken.length > 0 ? 'done' : 'more';
  }
}

/** The prompt for a fence's or polygon's next point, AutoCAD's words. */
function pathPrompt(kind: SelectionPath['kind'], points: readonly Vec2[]): Prompt {
  const last = points.at(-1);
  if (!last) {
    return {
      kind: 'point',
      message: kind === 'fence' ? 'Specify first fence point' : 'First polygon point',
    };
  }
  return {
    kind: 'point',
    message: kind === 'fence' ? 'Specify next fence point or' : 'Specify endpoint of line or',
    options: ['Undo'],
    rubberBand: {
      from: last,
      selection: kind === 'window' ? 'window' : 'crossing',
      path: { points, ...(kind === 'fence' && { open: true as const }) },
    },
  };
}

function formatPathPrompt(kind: SelectionPath['kind'], points: readonly Vec2[]): string {
  const p = pathPrompt(kind, points);
  return `${p.message}${p.options ? ` [${p.options.join('/')}]` : ''}:`;
}

/**
 * Whether a polygon's next point `p` would make it cross or touch itself: its new side (from the
 * last point) or the closing side (back to the first) meeting a side they do not join.
 */
export function polygonCrosses(points: readonly Vec2[], p: Vec2): boolean {
  const n = points.length;
  if (n === 0) return false;
  const last = points[n - 1]!;
  const first = points[0]!;
  if (samePoint(p, last)) return true;
  for (let i = 0; i + 1 < n; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    // The new side meets the side before it at the last point, and the first side at the first.
    if (i + 1 < n - 1 && segmentsMeet(last, p, a, b)) return true;
    if (n >= 2 && i > 0 && segmentsMeet(p, first, a, b)) return true;
  }
  return false;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Whether two closed segments share a point. */
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const on = (o: Vec2, p: Vec2, q: Vec2) =>
    Math.min(o.x, p.x) <= q.x &&
    q.x <= Math.max(o.x, p.x) &&
    Math.min(o.y, p.y) <= q.y &&
    q.y <= Math.max(o.y, p.y);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && on(c, d, a)) ||
    (d2 === 0 && on(c, d, b)) ||
    (d3 === 0 && on(a, b, c)) ||
    (d4 === 0 && on(a, b, d))
  );
}

/** `takes` without the objects `gone` (removed from the set, or erased). */
function without(takes: readonly SelectionTake[], gone: ReadonlySet<EntityId>): SelectionTake[] {
  return takes
    .map((t) => ({ ...t, ids: t.ids.filter((id) => !gone.has(id)) }))
    .filter((t) => t.ids.length > 0);
}
