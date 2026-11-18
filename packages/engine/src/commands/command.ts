// The command contract (M2-01, ARCHITECTURE.md §5.1): a command is an async generator that
// yields prompts and receives answers, and edits the drawing only through `ctx.edit`. It never
// reads UI state; the `PromptBus` is its only way in and out.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { EntityId } from '../model/entity-ids';
import type { EntityGeometry } from '../model/types';
import type { DimensionRegenerator } from '../edit/dimension-block';
import type { HatchLinesOf } from '../edit/explode';
import type { SpellService } from '../edit/spelling';
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
  /** The Block Editor (BEDIT, BSAVE, BCLOSE; M5-02), which makes a block's definition `space`. */
  readonly blockEditor: BlockEditorControl;
  readonly prompt: typeof prompts;
  /**
   * The drawing's undo history, for UNDO, U, REDO and OOPS. Undoing goes around `edit`: it is
   * not itself a step.
   */
  readonly undo: UndoStack;
  /** LASTPOINT: the last point given at any prompt. */
  readonly lastPoint: Vec2 | undefined;
  /**
   * The objects selected at `Command:` that a command using the selection `before` took as it
   * started (PICKFIRST), for one that opens on them without a "Select objects" prompt (ULAYERS'
   * dialog, M2-56 part 1); empty when there were none or a selection prompt has taken them.
   */
  readonly preselected: readonly EntityId[];
  /**
   * Leaves `ids` selected at `Command:`, as a pick there would (QUICKPROPERTIES, M2-35 part 21:
   * the objects it shows Quick Properties for stay selected and gripped). Only a command that
   * keeps the selection (`keepsSelection`) should: another's next start clears it.
   */
  select(ids: readonly EntityId[]): void;
  /**
   * Adds `ids` to the selection the command this one runs inside is building, as one step of
   * its "Select objects" ('FILTER, M3-04 part 4). False when it builds none (not transparent, or
   * the command it runs in is at another prompt).
   */
  addSelected(ids: readonly EntityId[]): boolean;
  /**
   * Makes `ids` the Previous selection set, as a "Select objects" ending on them would: DIVIDE's
   * and MEASURE's marks (M3-01 part 5; AutoCAD: "use Previous to select them").
   */
  setPrevious(ids: readonly EntityId[]): void;
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
  /**
   * The dimension engine (M2-10 part 3): what an edited dimension's block is rewritten with.
   * Without it (scripts, tests that do not give one) dimensions are only carried whole.
   */
  readonly dimensions?: DimensionRegenerator | undefined;
  /**
   * A pattern hatch's lines (`@triya/hatch`), which EXPLODE turns into lines (M3-12 part 3).
   * Without it (scripts, tests that do not give one) hatches are not exploded.
   */
  readonly hatchLines?: HatchLinesOf | undefined;
  /**
   * The spelling dictionary SPELL checks with (M4-09 part 4, loaded when first asked for).
   * Without it (scripts, tests that do not give one) SPELL says it has none.
   */
  readonly spelling?: SpellService | undefined;
  /** The time, for the variables that tell it (DATE, CDATE; M2-59). */
  readonly clock: Clock;
}

/**
 * The Block Editor's state (M5-02). While it is open, `space` is the block definition it shows;
 * the edits made since it opened or was last saved can be taken back as it closes.
 */
export interface BlockEditorControl {
  /** The BLOCK_RECORD shown, or undefined when the editor is closed. */
  readonly block: Handle | undefined;
  /** Edits made since BEDIT opened it or BSAVE last saved it. */
  readonly unsaved: boolean;
  /** Shows `block` for editing: the space commands draw in until it closes. */
  open(block: Handle): void;
  /** Keeps the edits made so far: a later Discard takes back only those made after. */
  save(): void;
  /**
   * Closes the editor; with `discard`, takes back the edits made since the last save, in this
   * command's undo step.
   */
  close(discard: boolean): void;
}

/** Where the engine reads the local date and time: injected, so tests fix it. */
export interface Clock {
  now(): Date;
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
  /**
   * A double click on the canvas cancels it and runs what a double click runs at `Command:`
   * (TABLECELL, M4-05 part 3: the first click of a double click on a cell selects the cell).
   */
  readonly yieldsToDoubleClick?: boolean;
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
  /**
   * The user alias file's aliases (M3-10, `parseAliasFile`), over the default ones; never one
   * that is a command's name, which AutoCAD looks up before aliases ("Command Search Order").
   */
  #user = new Map<string, string>();

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

  /** Sets the user's aliases (alias to command, `-NAME` for a dash form), replacing the last. */
  setUserAliases(aliases: Readonly<Record<string, string>>): void {
    this.#user = new Map(
      Object.entries(aliases)
        .map(([a, c]) => [a.trim().toUpperCase(), c.trim().toUpperCase()] as const)
        .filter(([a, c]) => a !== '' && c !== '' && !this.#defs.has(a)),
    );
  }

  /** The aliases that name a command now, sorted: the defaults less those the user's took. */
  aliasesOf(name: string): string[] {
    const n = name.toUpperCase();
    const out: string[] = [];
    for (const [a, c] of this.#user) if (c === n) out.push(a);
    for (const [a, c] of this.#aliases) if (c === n && !this.#user.has(a)) out.push(a);
    return out.sort();
  }

  get(name: string): CommandDef | undefined {
    return this.#defs.get(name.toUpperCase());
  }

  /** The registered command names, for autocomplete. */
  names(): string[] {
    return [...this.#defs.keys()].sort();
  }

  /** The command an alias names (registered or not); `-NAME` for a user alias to a dash form. */
  alias(alias: string): string | undefined {
    const a = alias.toUpperCase();
    return this.#user.get(a) ?? this.#aliases.get(a);
  }

  /**
   * The command typed at `Command:`: a name, else an alias (a user alias first; an alias of its
   * own, like `-CH` for CHANGE, too), else `-` before a name or alias of a command with a dash
   * variant. Names come before aliases, as in AutoCAD's "Command Search Order".
   */
  resolve(input: string): ResolvedCommand | undefined {
    const t = input.trim().toUpperCase();
    if (t === '') return undefined;
    const named = this.#defs.get(t);
    if (named) return { def: named, dash: false };
    const aliased = this.alias(t);
    if (aliased !== undefined) return this.#command(aliased);
    if (!t.startsWith('-')) return undefined;
    const rest = this.alias(t.slice(1)) ?? t.slice(1);
    return rest.startsWith('-') ? undefined : this.#command(`-${rest}`);
  }

  /** A command by name, `-NAME` for its dash form. */
  #command(name: string): ResolvedCommand | undefined {
    const dash = name.startsWith('-');
    const def = this.#defs.get(dash ? name.slice(1) : name);
    return def && (!dash || def.dashVariant) ? { def, dash } : undefined;
  }
}
