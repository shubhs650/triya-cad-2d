// MATCHPROP (M3-02 part 5), with AutoCAD 2024's prompts (AutoCAD Help, "MATCHPROP (Command)",
// "Property Settings Dialog Box"):
//
//   Select source object:
//   Current active settings:  Color Layer Ltype Ltscale Lineweight Transparency Thickness …
//   Select destination object(s) or [Settings]:
//
// The destination objects take the source's properties as soon as they are chosen; the prompt
// comes back for more until Enter. Settings opens the Property Settings dialog, whose choices
// are kept while the drawing is open (AutoCAD keeps them for the session). Objects on locked
// layers are left alone. The properties are `properties/match.ts`'s.
import { refusalMessages } from '../../edit/edit';
import type { EntityId } from '../../model/entity-ids';
import type { EntityPatch } from '../../model/update';
import { writeTableBlock } from '../../edit/table';
import { centerMarkOf, matchedCenterMark, redrawCenterMark } from '../../edit/center-marks';
import type { CenterMark } from '../../model/types';
import { restyledTable } from '../tablestyle';
import { namedPlotStyles } from '../../properties/general';
import {
  ALL_MATCH_SETTINGS,
  activeSettingsLine,
  matchedPatch,
  matchedStyles,
  type MatchSettings,
} from '../../properties/match';
import type { CommandDef } from '../command';
import { applyProperty } from './property-edit';

export function matchpropCommand(): CommandDef {
  let settings: MatchSettings = ALL_MATCH_SETTINGS;
  return {
    name: 'MATCHPROP',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select source object',
        single: true,
        pickfirst: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const sourceId = a.ids[0]!;
      ctx.message(activeSettingsLine(settings));
      for (;;) {
        const b = yield ctx.prompt.selection({
          message: 'Select destination object(s) or',
          options: ['Settings'],
          single: true,
          // AutoCAD's paintbrush beside the pickbox while destinations are picked.
          cursor: 'paintbrush',
        });
        if (b.kind === 'keyword') {
          const d = yield ctx.prompt.dialog({
            message: 'Property Settings',
            escape: true,
            dialog: { type: 'matchprop', settings, plotStyles: namedPlotStyles(ctx.model) },
          });
          if (d.kind === 'dialog' && d.action === 'ok' && d.matchprop) settings = d.matchprop;
          else if (d.kind !== 'dialog' && d.kind !== 'escape') return;
          continue;
        }
        if (b.kind !== 'selection' || b.ids.length === 0) return;
        await match(sourceId, b.ids);
      }

      async function match(from: EntityId, ids: readonly EntityId[]): Promise<void> {
        const source = ctx.model.entity(from);
        if (!source) return;
        const refused = new Map<string, number>();
        const targets = ids.flatMap((id) => {
          const e = id === from ? undefined : ctx.model.entity(id);
          if (!e) return [];
          if (ctx.model.tables.layers.get(e.layer)?.locked) {
            refused.set('on a locked layer', (refused.get('on a locked layer') ?? 0) + 1);
            return [];
          }
          return [e];
        });
        for (const line of refusalMessages(refused, 'changed')) ctx.message(line);
        if (targets.length === 0) return;
        // The styles first: a text's new style may give it a height the layer change keeps.
        for (const s of matchedStyles(source, targets, settings)) {
          await applyProperty(ctx, s.ids, { key: s.key, value: s.value }, undefined);
        }
        const patches = new Map<EntityId, EntityPatch>();
        for (const t of targets) {
          const now = ctx.model.entity(t.id);
          let patch = now && matchedPatch(ctx.model, source, now, settings);
          // A table given another style is drawn again in it, its rows fitted (M4-05 part 5).
          const g = patch?.geom;
          if (
            g?.kind === 'ACAD_TABLE' &&
            now?.geom.kind === 'ACAD_TABLE' &&
            g.style !== now.geom.style
          ) {
            const style =
              g.style !== undefined ? ctx.model.tables.tableStyles.get(g.style) : undefined;
            patch = { ...patch, geom: await restyledTable(ctx, g, style) };
          }
          if (patch) patches.set(t.id, patch);
        }
        // Center object (M4-08 part 3): a center mark or centerline takes the source's settings
        // and is drawn again with them.
        const sourceMark = centerMarkOf(ctx.model, source);
        const marks = new Map<EntityId, { before: CenterMark; after: CenterMark }>();
        for (const t of targets) {
          const before = sourceMark && centerMarkOf(ctx.model, ctx.model.entity(t.id));
          const after = before && matchedCenterMark(sourceMark, before, settings.centerObject);
          if (before && after) marks.set(t.id, { before, after });
        }
        if (patches.size === 0 && marks.size === 0) return;
        ctx.edit((b) => {
          for (const [id, patch] of patches) {
            b.updateEntity(id, patch);
            if (patch.geom?.kind === 'ACAD_TABLE') writeTableBlock(b, ctx.model, id);
          }
          for (const [id, { before, after }] of marks) {
            const insert = b.entity(id);
            if (insert) redrawCenterMark(b, ctx.model, insert, before, after);
          }
        });
      }
    },
  };
}
