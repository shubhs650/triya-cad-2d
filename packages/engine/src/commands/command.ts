// The command contract (M2-01, ARCHITECTURE.md §5.1): a command is an async generator that
// yields prompts and receives answers, and edits the drawing only through `ctx.edit`. It never
// reads UI state; the `PromptBus` is its only way in and out.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { EntityGeometry } from '../model/types';
import { ALIASES } from './aliases';
import type { ViewHost } from './view/host';
import type { UndoStack } from './undo';
import type {
  AnglePrompt,
  DialogPrompt,
  DistancePrompt,
  IntegerPrompt,
  KeywordPrompt,
  PointPrompt,
  Prompt,
  PromptAnswer,
  RealPrompt,
  SelectionPrompt,
  StringPrompt,
} from './prompt';

export type CommandResult = void;
export type CommandGenerator = AsyncGenerator<Prompt, CommandResult, PromptAnswer>;

type Options<P> = Omit<P, 'kind'>;

/** Prompt builders: `yield ctx.prompt.point({ message: 'Specify first point' })`. */
export const prompts = {
  point: (o: Options<PointPrompt>): PointPrompt => ({ kind: 'point', ...o }),
  distance: (o: Options<DistancePrompt>): DistancePrompt => ({ kind: 'distance', ...o }),
  angle: (o: Options<AnglePrompt>): AnglePrompt => ({ kind: 'angle', ...o }),
  keyword: (o: Options<KeywordPrompt>): KeywordPrompt => ({ kind: 'keyword', ...o }),
  string: (o: Options<StringPrompt>): StringPrompt => ({ kind: 'string', ...o }),
  integer: (o: Options<IntegerPrompt>): IntegerPrompt => ({ kind: 'integer', ...o }),
  real: (o: Options<RealPrompt>): RealPrompt => ({ kind: 'real', ...o }),
  selection: (o: Options<SelectionPrompt>): SelectionPrompt => ({ kind: 'selection', ...o }),
  dialog: (o: Options<DialogPrompt>): DialogPrompt => ({ kind: 'dialog', ...o }),
};

export interface CommandContext {
  /** The drawing, with every edit this command made so far applied. Read only: edit via `edit`. */
  readonly model: DocumentModel;
  /** Run as `-NAME` (the command-line version of a dialog command). */
  readonly dash: boolean;
  /** Run inside another command (`'ZOOM`). */
  readonly transparent: boolean;
  /**
   * The BLOCK_RECORD new objects go into: model space, or the paper space of the layout shown
   * (the space the drafter draws in, as AutoCAD's current space; M2-02).
   */
  readonly space: Handle;
  readonly prompt: typeof prompts;
  /**
   * The drawing's undo history, for UNDO, U, REDO and OOPS. Undoing goes around `edit`: it is
   * not itself a step.
   */
  readonly undo: UndoStack;
  /** LASTPOINT: the last point given at any prompt. */
  readonly lastPoint: Vec2 | undefined;
  /**
   * Builds a change set, applies it to the drawing at once (so later prompts, osnaps and the
   * screen see it) and adds it to this command's undo record, which closes when the command
   * ends, cancelled or not: Esc after three LINE segments keeps them, as in AutoCAD.
   */
  edit(build: (b: ChangeSetBuilder) => void): ChangeSet;
  /** Shows rubber-band geometry on the transient layer until the next preview or the end. */
  preview(geometry: readonly EntityGeometry[]): void;
  /** A line on the command line ("1 found", "Invalid number of sides."). */
  message(text: string): void;
  /** The canvas of the space shown, for the view commands (ZOOM, PAN, REGEN, VIEW; M2-02). */
  readonly view: ViewHost;
}

export interface CommandDef {
  /** The global name, upper case: 'LINE'. */
  readonly name: string;
  /** Aliases beyond the acad.pgp table (`ALIASES`), upper case. */
  readonly aliases?: readonly string[];
  /** Supports `-NAME`. */
  readonly dashVariant?: boolean;
  /** Can run inside another command (`'NAME`). */
  readonly transparent?: boolean;
  /**
   * The entities it removes are the set OOPS restores, as for AutoCAD's ERASE, BLOCK and
   * WBLOCK (M2-05).
   */
  readonly erases?: boolean;
  /**
   * The objects selected at `Command:` stay selected while it runs and after (grip editing,
   * M2-06), where any other command that does not select deselects them.
   */
  readonly keepsSelection?: boolean;
  /** Where its selection comes from (PICKFIRST pre-selection, M2-03). */
  readonly usesSelection?: 'before' | 'during' | 'none';
  run(ctx: CommandContext): CommandGenerator;
}

export interface ResolvedCommand {
  readonly def: CommandDef;
  readonly dash: boolean;
}

/** The commands a document can run, found by name, alias or `-NAME`. */
export class CommandRegistry {
  readonly #defs = new Map<string, CommandDef>();
  readonly #aliases = new Map<string, string>(Object.entries(ALIASES));

  constructor(defs: Iterable<CommandDef> = []) {
    for (const def of defs) this.register(def);
  }

  register(def: CommandDef): void {
    const name = def.name.toUpperCase();
    if (name !== def.name) throw new Error(`command name ${def.name} must be upper case`);
    if (this.#defs.has(name)) throw new Error(`command ${name} is registered twice`);
    this.#defs.set(name, def);
    for (const alias of def.aliases ?? []) {
      const was = this.#aliases.get(alias.toUpperCase());
      if (was !== undefined && was !== name) throw new Error(`alias ${alias} already names ${was}`);
      this.#aliases.set(alias.toUpperCase(), name);
    }
  }

  get(name: string): CommandDef | undefined {
    return this.#defs.get(name.toUpperCase());
  }

  /** The registered command names, for autocomplete. */
  names(): string[] {
    return [...this.#defs.keys()].sort();
  }

  /** The command an alias names (registered or not). */
  alias(alias: string): string | undefined {
    return this.#aliases.get(alias.toUpperCase());
  }

  /**
   * The command typed at `Command:`: a name or alias (an alias of its own, like `-CH` for
   * CHANGE, first), or `-` before a name or alias of a command with a dash variant.
   */
  resolve(input: string): ResolvedCommand | undefined {
    const t = input.trim().toUpperCase();
    if (t === '') return undefined;
    const direct = this.#defs.get(this.#aliases.get(t) ?? t);
    if (direct) return { def: direct, dash: false };
    if (!t.startsWith('-')) return undefined;
    const rest = t.slice(1);
    const def = this.#defs.get(this.#aliases.get(rest) ?? rest);
    return def?.dashVariant ? { def, dash: true } : undefined;
  }
}
