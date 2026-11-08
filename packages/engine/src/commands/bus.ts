// The PromptBus (M2-01, ARCHITECTURE.md §5.1): runs the commands of one document and is the one
// way into them. Front-ends (the command line, Dynamic Input, the Ctrl+K palette, tests) send
// typed text (`submit`), direct answers such as picked points (`answer`) and Esc (`cancel`), and
// listen for prompts, command-line lines, previews and each finished command's change sets.
//
// The bus owns what AutoCAD does around every command: Enter repeats the last command, Esc
// cancels, defaults, transparent commands (`'ZOOM`), the point modifiers FROM, M2P and `.X`
// filters, direct distance entry, two-point distances and angles, and the history (F2).
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityGeometry } from '../model/types';
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
} from './prompt';

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
  /** A command (with any transparent commands run inside it) ended having edited the drawing. */
  | { readonly type: 'commit'; readonly record: CommandRecord };

export interface PromptBusOptions {
  readonly model: DocumentModel;
  readonly registry: CommandRegistry;
  /** Applies an edit; by default to `model`. The engine worker also sends it to the renderers. */
  readonly apply?: (change: ChangeSet) => void;
}

interface Frame {
  readonly def: CommandDef;
  readonly label: string;
  readonly gen: CommandGenerator;
  readonly transparent: boolean;
  prompt: Prompt | undefined;
  /** The point the command it runs inside was collecting (`'ZOOM` typed at FROM's base point). */
  readonly outerCollectors: Collector[];
}

/** A step of a point the bus collects itself before the command sees it (FROM, M2P, filters). */
interface Collector {
  readonly text: string;
  /** What `@` is relative to here (FROM's offset is relative to its base point). */
  readonly relativeTo?: Vec2;
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
};

const takesPoints = (p: Prompt): boolean =>
  p.kind === 'point' || p.kind === 'distance' || p.kind === 'angle';

export class PromptBus {
  readonly #model: DocumentModel;
  readonly #registry: CommandRegistry;
  readonly #apply: (change: ChangeSet) => void;
  readonly #listeners = new Set<(e: BusEvent) => void>();
  readonly #stack: Frame[] = [];
  #collectors: Collector[] = [];
  #changes: ChangeSet[] = [];
  #last: { readonly def: CommandDef; readonly dash: boolean } | undefined;
  #lastPoint: Vec2 | undefined;
  #cursor: Vec2 | undefined;
  #previewing = false;
  #queue: Promise<void> = Promise.resolve();
  readonly #history: string[] = [];
  readonly #recent: string[] = [];

  constructor(options: PromptBusOptions) {
    this.#model = options.model;
    this.#registry = options.registry;
    this.#apply = options.apply ?? ((cs) => this.#model.apply(cs));
  }

  /** Listens for bus events; returns the unsubscribe. */
  on(listener: (e: BusEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The prompt the bus waits at, or undefined at `Command:`. */
  get prompt(): Prompt | undefined {
    const c = this.#collectors.at(-1);
    if (c) return prompts.point({ message: c.text.replace(/:$/, '') });
    return this.#stack.at(-1)?.prompt;
  }

  /** The command line's prompt text. */
  get promptText(): string {
    const c = this.#collectors.at(-1);
    if (c) return this.#nested(c.text);
    const frame = this.#stack.at(-1);
    return frame?.prompt ? this.#nested(formatPrompt(frame.prompt, this.#precision())) : 'Command:';
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

  /** Esc: cancels the running command, and any it was running inside. */
  cancel(): Promise<void> {
    return this.#enqueue(() => this.#cancel());
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
    if (!frame) return this.#commandLine(text);
    const t = text.trim();
    if (t.length > 1 && t.startsWith("'")) return this.#transparent(t);
    if (this.#collectors.length > 0) return this.#collectorInput(t);
    return this.#typed(frame.prompt!, text);
  }

  async #direct(answer: PromptAnswer): Promise<void> {
    const frame = this.#stack.at(-1);
    if (!frame) {
      if (answer.kind === 'enter') await this.#commandLine('');
      return;
    }
    const echo = formatAnswer(answer, this.#precision());
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
      this.#last = { def, dash };
      this.#changes = [];
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
      get lastPoint() {
        return bus.#lastPoint;
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
    this.#showPrompt();
  }

  /** A command ended: close its record, or resume the one it ran inside. */
  #end(frame: Frame, cancelled: boolean): void {
    this.#stack.pop();
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
    if (this.#previewing) {
      this.#previewing = false;
      this.#emit({ type: 'preview', geometry: [] });
    }
    if (this.#changes.length === 0) return;
    const record: CommandRecord = { command: this.#last!.def.name, changes: this.#changes };
    this.#changes = [];
    this.#emit({ type: 'commit', record });
  }

  async #cancel(): Promise<void> {
    this.#log(`${this.promptText} *Cancel*`);
    this.#collectors = [];
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
        const p = parseCoordinate(t, { lastPoint: this.#lastPoint, angles });
        if (p !== undefined && p !== 'invalid') return this.#pointFor(p, t);
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

  async #collectorInput(t: string): Promise<void> {
    const c = this.#collectors.at(-1)!;
    const modifier = parsePointModifier(t);
    if (modifier) return this.#modifier(modifier, t);
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
    const prompt = this.#stack.at(-1)!.prompt!;
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
    if (log) this.#log(`${this.promptText} ${echo}`.trimEnd());
    if (given.kind === 'point') this.#lastPoint = given.point;
    frame.prompt = undefined;
    await this.#advance(frame, given);
  }
}
