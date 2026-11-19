// XBIND and -XBIND (M5-04 part 7; COMMANDS.md "Blocks and references"), alias XB, as AutoCAD
// 2024's (AutoCAD Help, "XBIND (Command)", "Xbind Dialog Box", "-XBIND (Command)"):
//
//   - XBIND opens the Xbind dialog (`XbindRequest`): the Xrefs tree, each xref with its Block,
//     Dimstyle, Layer, Linetype and Textstyle definitions, and Definitions to Bind; OK binds
//     those.
//   - -XBIND: "Enter symbol type to bind [Block/Dimstyle/LAyer/LType/Style]", then "Enter
//     dependent <Kind> name(s)": full `xref|name` names or wildcard patterns, separated by commas.
//
// Each binding is a copy of the definition named `xref$n$name` (edit/xbind.ts), with the
// xref-dependent definitions it names; one XBIND undo step the save writes. AutoCAD's Help gives
// no wording for what -XBIND reports; settled for the common drafter expectation (noted in the
// PR): one line per definition bound ("Layer "plan|WALLS" bound as "plan$0$WALLS"."), "No
// matching dependent <Kind> found." when a pattern names none, and why a definition stayed out.
import type { Handle } from '../model/handle';
import {
  xbindDefinitions,
  xbindXrefs,
  type XbindKind,
  type XbindReport,
  type XbindXref,
} from '../edit/xbind';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** XBIND's Xbind dialog: the drawing's xrefs with the definitions of them it can bind. */
export interface XbindRequest {
  readonly type: 'xbind';
  readonly xrefs: readonly XbindXref[];
}

/** -XBIND's symbol types, as AutoCAD 2024 names them, and the kind each binds. */
const SYMBOL_TYPES: readonly (readonly [string, XbindKind])[] = [
  ['Block', 'Block'],
  ['Dimstyle', 'Dimstyle'],
  ['LAyer', 'Layer'],
  ['LType', 'Linetype'],
  ['Style', 'Textstyle'],
];

/** How -XBIND's prompts and messages name a kind. */
const KIND_WORD: Readonly<Record<XbindKind, string>> = {
  Block: 'Block',
  Dimstyle: 'Dimstyle',
  Layer: 'Layer',
  Linetype: 'Linetype',
  Textstyle: 'Text style',
};

/** The definitions `handles` bound in one XBIND step, reported at the command line. */
function bind(ctx: CommandContext, handles: readonly Handle[]): void {
  let report: XbindReport | undefined;
  ctx.edit((b) => {
    report = xbindDefinitions(b, ctx.model, handles);
  });
  for (const d of report!.bound)
    ctx.message(`${KIND_WORD[d.kind]} "${d.name}" bound as "${d.boundName}".`);
  for (const [reason, n] of report!.omitted)
    ctx.message(`${n} object(s) left out of the bound block(s): ${reason}.`);
}

async function* dashXbind(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter symbol type to bind',
    options: SYMBOL_TYPES.map(([k]) => k),
  });
  if (a.kind !== 'keyword') return;
  const kind = SYMBOL_TYPES.find(([k]) => k === a.keyword)![1];
  const n = yield ctx.prompt.string({ message: `Enter dependent ${KIND_WORD[kind]} name(s)` });
  if (n.kind !== 'string' || n.value.trim() === '') return;
  const patterns = n.value.trim();
  const named = xbindXrefs(ctx.model)
    .flatMap((x) => x.definitions)
    .filter((d) => d.kind === kind && wcmatch(d.name, patterns));
  if (named.length === 0) {
    ctx.message(`No matching dependent ${KIND_WORD[kind]} found.`);
    return;
  }
  bind(
    ctx,
    named.map((d) => d.handle),
  );
}

/** XBIND (and -XBIND), with AutoCAD's alias XB. */
export function xbindCommand(): CommandDef {
  return {
    name: 'XBIND',
    dashVariant: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      if (ctx.dash) {
        yield* dashXbind(ctx);
        return;
      }
      const xrefs = xbindXrefs(ctx.model);
      if (xrefs.length === 0) {
        ctx.message('The drawing has no external references.');
        return;
      }
      const a = yield ctx.prompt.dialog({ message: 'Xbind', dialog: { type: 'xbind', xrefs } });
      if (a.kind !== 'dialog' || a.action !== 'ok') return;
      const handles = (a.xbind ?? []).filter((h): h is Handle => typeof h === 'string');
      if (handles.length === 0) return;
      bind(ctx, handles);
    },
  };
}
