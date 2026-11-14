// ULAYERS (M2-56 part 1). AutoCAD 2024 Help, "ULAYERS (Command)": "Controls the display of
// layers in a DWF, DWFx, PDF, or DGN underlay", through the Underlay Layers dialog, whose
// Reference Name lists the underlays attached and whose layer list turns each layer on or off.
// The dialog is the app's (it reads the PDF); ULAYERS opens it on the underlay selected first,
// or the first one, waits, and applies what OK changed as its own edit, so the whole dialog is
// one undo step. A drawing with no PDF underlay gets AutoCAD's message instead of the dialog.
import type { CommandDef } from './command';
import {
  setUnderlayLayersOff,
  underlayLayersProblem,
  underlayReferences,
} from '../edit/underlay-layers';
import { viewRequest } from './view/zoom';

export function underlayLayersCommand(): CommandDef {
  return {
    name: 'ULAYERS',
    usesSelection: 'before',
    // eslint-disable-next-line require-yield -- the dialog asks, not the command line
    async *run(ctx) {
      const underlays = underlayReferences(ctx.model);
      if (underlays.length === 0) {
        ctx.message('No underlays found in the drawing.');
        return;
      }
      const picked = new Set(ctx.preselected);
      const current = underlays.find((u) => picked.has(u.id))?.id;
      const reply = await viewRequest(ctx, {
        op: 'underlayLayers',
        underlays,
        ...(current !== undefined && { current }),
      });
      if (!reply.ok || !reply.underlayLayers) return;
      const before = new Map(underlays.map((u) => [u.id, u.layersOff.join('\n')]));
      const changes = reply.underlayLayers.filter(
        (c) =>
          before.has(c.id) &&
          before.get(c.id) !== [...new Set(c.layersOff)].join('\n') &&
          !underlayLayersProblem(c.layersOff),
      );
      if (changes.length === 0) return;
      ctx.edit((b) => {
        for (const c of changes) setUnderlayLayersOff(b, ctx.model, c.id, c.layersOff);
      });
    },
  };
}
