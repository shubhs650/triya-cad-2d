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
        ctx.edit((b) => {
          for (const t of targets) {
            const now = ctx.model.entity(t.id);
            const patch = now && matchedPatch(ctx.model, source, now, settings);
            if (patch) b.updateEntity(t.id, patch);
          }
        });
      }
    },
  };
}
