// ADCENTER and ADCCLOSE (M5-11; AutoCAD 2024 Help, "ADCENTER (Command)": "Manages and inserts
// content such as blocks, xrefs, and hatch patterns", aliases ADC, DC, DCENTER, Ctrl+2;
// "ADCCLOSE (Command)": closes DesignCenter). The palette is the app's, so each asks the host.
//
// What the palette brings in runs here, as the command `ADCENTER` the command line does not echo
// (`PromptBus.designCenter`), one undo step: the items copied out of another drawing
// (`DesignCenterItem`) added, a duplicate definition ignored, and, for a block, the block
// inserted: dragged in, at the drop point with scale 1 (in the drawing's units, INSUNITS) and no
// rotation, its attributes asked as INSERT asks them ("To Insert a Block with DesignCenter":
// "automatic scaling"); by Insert Block..., in INSERT's Insert dialog on that block. Settled for
// the common drafter expectation (noted in the PR): the command line says what was added and
// what was ignored, by name, where AutoCAD's own wording is not documented.
//
// The library palette's Insert (M8-03) is the same drop: its block, drawn in the drawing's units,
// is added and inserted where the drafter picks (`onScreen`), at scale 1 and the UCS's angle, as
// AutoCAD 2024's Blocks palette inserts on a click ("Blocks Palette": the block is attached to
// the cursor for its insertion point), one INSERT undo step.
import type { Vec2 } from '../geom/types';
import type { CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { blockNamed } from '../edit/blocks';
import {
  addDesignCenterItem,
  hasDesignCenterItem,
  type DesignCenterItem,
} from '../edit/design-center';
import { insertBlock, insertDialog, insertRefusal } from './blocks';
import { currentUcs } from './ucs';
import { loadPastedXrefs, xrefHandles } from './xref-attach';
import { viewRequest } from './view/zoom';

/** What DesignCenter asks of a drawing: items to add and, maybe, a block to insert. */
export interface DesignCenterDrop {
  /** Copied out of the drawing they come from; none when it is this drawing. */
  readonly items: readonly DesignCenterItem[];
  /**
   * The block (by name) to insert once added: at `at` (world), else at the point picked with
   * `onScreen`, else by the Insert dialog.
   */
  readonly insert?: { readonly block: string; readonly at?: Vec2; readonly onScreen?: boolean };
  /** The library palette's (M8-03): its undo step is INSERT's. */
  readonly library?: boolean;
}

/** Each category's item, as the command line names it. */
const NOUN: Record<DesignCenterItem['category'], string> = {
  blocks: 'Block',
  dimstyles: 'Dimension style',
  layers: 'Layer',
  linetypes: 'Linetype',
  mleaderstyles: 'Multileader style',
  tablestyles: 'Table style',
  textstyles: 'Text style',
};

/** The command a DesignCenter drop runs (see the file comment). */
export function designCenterCommand(drop: DesignCenterDrop): CommandDef {
  return {
    name: drop.library ? 'INSERT' : 'ADCENTER',
    usesSelection: 'none',
    async *run(ctx): AsyncGenerator<Prompt, void, PromptAnswer> {
      const added = new Map<string, string[]>();
      const ignored: string[] = [];
      const xrefs = xrefHandles(ctx);
      for (const item of drop.items) {
        // A duplicate makes no edit, so a drop of duplicates alone makes no undo step.
        let done = false;
        if (!hasDesignCenterItem(ctx.model, item.category, item.name)) {
          ctx.edit((b) => {
            done = addDesignCenterItem(b, ctx.model, item);
          });
        }
        const noun = NOUN[item.category];
        if (!done) ignored.push(`${noun.toLowerCase()} ${item.name}`);
        else added.set(noun, [...(added.get(noun) ?? []), item.name]);
      }
      for (const [noun, names] of added) ctx.message(`${noun}(s) added: ${names.join(', ')}.`);
      if (ignored.length > 0) {
        ctx.message(`Duplicate definitions ignored: ${ignored.join(', ')}.`);
      }
      // A block holding an xref's reference attaches the xref, loaded as a paste's (M5-04 part 19).
      await loadPastedXrefs(ctx, xrefs);
      const insert = drop.insert;
      if (!insert) return;
      if (insert.at === undefined && !insert.onScreen)
        return yield* insertDialog(ctx, insert.block);
      const refusal = insertRefusal(ctx, insert.block);
      if (refusal) {
        ctx.message(refusal);
        return;
      }
      const r = blockNamed(ctx.model, insert.block)!;
      yield* insertBlock(ctx, r, {
        explode: false,
        uniform: r.scalable === false,
        ...(insert.at && { at: insert.at }),
        scale: { x: 1, y: 1, z: 1 },
        rotation: currentUcs(ctx).angle,
      });
    },
  };
}

function paletteCommand(name: string, open: boolean): CommandDef {
  return {
    name,
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host opens or closes the palette
    async *run(ctx) {
      await viewRequest(ctx, { op: 'palette', palette: 'designcenter', open });
    },
  };
}

export const DESIGN_CENTER_COMMANDS: readonly (() => CommandDef)[] = [
  () => paletteCommand('ADCENTER', true),
  () => paletteCommand('ADCCLOSE', false),
];
