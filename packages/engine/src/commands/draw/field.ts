// FIELD and the Field dialog (M4-10 part 2), as AutoCAD 2024 Help, "FIELD (Command)": "Creates a
// multiline text object with a field that can be updated automatically as field values
// change." The Field dialog (edit/field-codes.ts) opens; OK asks for where the text goes:
//
//   Specify start point or [Height/Justify]:
//
// and places an MTEXT holding the field, in the current text style and height (TEXTSIZE unless
// the style fixes one), on the current layer and properties, no width, as one undo step. The
// dialog's Select object closes it while the drafter picks the object an Object field names,
// then it opens again with that object's properties.
//
// The same dialog is the MTEXT editor's Insert Field (Ctrl+F, the toolbar's Field button): the
// editor answers with its text, `%<FIELD_INSERT>%` where the field goes, and opens again with
// the field there (`askEditorText`). Cancel leaves the text as it was.
//
// Edit Field (M4-10 part 4; AutoCAD 2024 Help, "To Edit a Field": "In the In-Place Text Editor,
// double-click the field to display the Field dialog box"): the editor answers with the field's
// code marked, `%<FIELD_EDIT code>%`; the dialog opens on the field's choices (`fieldSpecOf`;
// one it does not make opens as Insert Field does) and the editor opens again with the field as
// the dialog left it. TEXT's line editor does both too.
//
// Update Field (M4-23; AutoCAD 2024 Help, "To Update a Field Manually": "In the In-Place Text
// Editor, select the field you want to update, right-click, and click Update Field"): the
// editor answers with the field's code marked, `%<FIELD_UPDATE code>%`, and opens again on the
// same text with that field's value evaluated now. No dialog opens.
import {
  FIELD_EDIT,
  FIELD_INSERT,
  FIELD_UPDATE,
  markedField,
  objectFieldProperties,
  textWithFields,
  type FieldContext,
  type FieldSnapshot,
} from '../../edit/fields';
import { fieldCode, fieldSpecOf, type FieldSpec } from '../../edit/field-codes';
import { drawingUnits } from '../units';
import type { Handle } from '../../model/handle';
import type { MTextGeometry } from '../../model/types';
import { typeLabel } from '../../properties/sheet';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { Prompt, PromptAnswer, StringPrompt, TextEditorRequest } from '../prompt';
import { currentProps } from '../../properties/current';
import { currentTextStyle, textSize } from './text';

/** The Field dialog's request (FIELD, the MTEXT editor's Insert Field). */
export interface FieldDialogRequest {
  readonly type: 'field';
  /** What the dialog shows its Preview from. */
  readonly snapshot: FieldSnapshot;
  /** The state Select object closed it with, with the object picked. */
  readonly spec?: FieldSpec;
  /** The picked object's type, as the dialog's Object type shows it. */
  readonly objectType?: string;
}

/** The text an app variable gives (DWGNAME, DWGPREFIX), undefined when the app gives none. */
async function appText(ctx: CommandContext, name: string): Promise<string | undefined> {
  const r = await ctx.view.request({ op: 'sysvar', name });
  return r.ok && typeof r.value === 'string' ? r.value : undefined;
}

/** What a text's fields evaluate against, but its space: the drawing, the clock, the file. */
export async function fieldContextOf(ctx: CommandContext): Promise<Omit<FieldContext, 'space'>> {
  const fileName = await appText(ctx, 'DWGNAME');
  const folder = (await appText(ctx, 'DWGPREFIX')) ?? '';
  return {
    model: ctx.model,
    now: ctx.clock.now(),
    ...(fileName === undefined ? {} : { fileName }),
    folder,
  };
}

/** What the dialog previews from: the drawing's variables, the layout, the object picked. */
function snapshotOf(fc: FieldContext, object: Handle | undefined): FieldSnapshot {
  const variables: Record<string, number | string> = {};
  for (const [k, v] of fc.model.header) {
    if (k.startsWith('$') && (typeof v === 'number' || typeof v === 'string'))
      variables[k.slice(1).toUpperCase()] = v;
  }
  const layout = fc.model.layouts.find((l) => l.blockRecord === fc.space);
  const props = object === undefined ? undefined : objectFieldProperties(fc.model, object);
  return {
    now: fc.now.getTime(),
    ...(fc.fileName === undefined ? {} : { fileName: fc.fileName }),
    folder: fc.folder,
    units: drawingUnits(fc.model.header),
    variables,
    ...(layout && {
      layout: {
        name: layout.name,
        ...(layout.plot && {
          plot: {
            scale: layout.plot.scale,
            ...(layout.plot.pageSetupName !== undefined && {
              pageSetupName: layout.plot.pageSetupName,
            }),
          },
        }),
      },
    }),
    objects: props && object !== undefined ? { [object]: props } : {},
  };
}

/** The type of the object a field names, as the dialog's Object type shows it. */
function objectTypeOf(ctx: CommandContext, spec: FieldSpec | undefined): string | undefined {
  const e = spec?.object === undefined ? undefined : ctx.model.entityByHandle(spec.object);
  return e && typeLabel(e.geom.kind);
}

/**
 * The Field dialog, until OK or Cancel: the code of the field made (without `%<` `>%`), or
 * undefined when it was cancelled (Esc goes back to the editor, not out of the command) or made
 * none. `initial` is the field Edit Field opens it on.
 */
export async function* askFieldCode(
  ctx: CommandContext,
  fc: FieldContext,
  initial?: FieldSpec,
): AsyncGenerator<Prompt, string | undefined, PromptAnswer> {
  let spec: FieldSpec | undefined = initial;
  let objectType: string | undefined = objectTypeOf(ctx, initial);
  for (;;) {
    const d = yield ctx.prompt.dialog({
      message: 'Field',
      escape: true,
      dialog: {
        type: 'field',
        snapshot: snapshotOf(fc, spec?.object),
        ...(spec && { spec }),
        ...(objectType !== undefined && { objectType }),
      },
    });
    if (d.kind !== 'dialog' || !d.field) return undefined;
    if (d.action !== 'select') return fieldCode(d.field);
    // Select object: the dialog closes until an object is picked, and opens again on it.
    spec = d.field;
    const a = yield ctx.prompt.selection({ message: 'Select object', single: true });
    if (a.kind !== 'selection') return undefined;
    const e = a.ids.length > 0 ? ctx.model.entity(a.ids[0]!) : undefined;
    if (e) {
      const props = objectFieldProperties(ctx.model, e.handle) ?? {};
      // The property chosen stays when the new object has it, else its first.
      const { property: was, ...rest } = spec;
      const property = was !== undefined && was in props ? was : Object.keys(props)[0];
      spec = { ...rest, object: e.handle, ...(property !== undefined && { property }) };
      objectType = typeLabel(e.geom.kind);
    }
  }
}

/**
 * A string prompt that opens the MTEXT editor, with its Insert Field: each time the editor
 * answers with `%<FIELD_INSERT>%` in its text, the Field dialog opens and the editor opens again
 * with the field made in that place (nothing there when the dialog is cancelled), showing the
 * field's value. Update Field opens it again with the field's value evaluated now, and calls
 * `onUpdate`: the text then differs from the one the editor opened on, its codes the same. The
 * answer is the editor's last.
 */
export async function* askEditorText(
  ctx: CommandContext,
  prompt: Omit<StringPrompt, 'kind'>,
  space: Handle,
  onUpdate?: () => void,
): AsyncGenerator<Prompt, PromptAnswer, PromptAnswer> {
  let p = prompt;
  const marker = `%<${FIELD_INSERT}>%`;
  for (;;) {
    const a = yield ctx.prompt.string(p);
    if (a.kind !== 'string' || !a.editor || !p.editor) return a;
    const edited = markedField(a.value, FIELD_EDIT);
    const updated = markedField(a.value, FIELD_UPDATE);
    if (!a.value.includes(marker) && !edited && !updated) return a;
    const fc: FieldContext = { ...(await fieldContextOf(ctx)), space };
    if (updated && !edited && !a.value.includes(marker)) {
      // Update Field: the same text, the field's value evaluated now.
      const at = updated.start + 2;
      const value = a.value.slice(0, at) + a.value.slice(at + FIELD_UPDATE.length);
      const now = textWithFields(`%<${updated.code}>%`, fc).text;
      p = reopened(p, p.editor, a, value, { [updated.code]: now });
      onUpdate?.();
      continue;
    }
    const was = edited?.code;
    const code: string | undefined = yield* askFieldCode(
      ctx,
      fc,
      was === undefined ? undefined : fieldSpecOf(was),
    );
    // Cancel: an edited field stays as it was, an inserted one is not made.
    const made = code ?? was;
    const inserted = made === undefined ? '' : `%<${made}>%`;
    const value = edited
      ? a.value.slice(0, edited.start) + inserted + a.value.slice(edited.end)
      : a.value.replace(marker, inserted);
    const known = made === undefined || made in (p.editor.fields ?? {});
    p = reopened(p, p.editor, a, value, known ? {} : { [made]: textWithFields(inserted, fc).text });
  }
}

/** The editor's prompt opened again on `value`, with `values` among the fields it shows. */
function reopened(
  p: Omit<StringPrompt, 'kind'>,
  editor: TextEditorRequest,
  a: PromptAnswer & { readonly kind: 'string' },
  value: string,
  values: Readonly<Record<string, string>>,
): Omit<StringPrompt, 'kind'> {
  const { columns: _was, ...rest } = editor;
  // The editor's columns as it closed (null: none), else as it opened.
  const columns = a.columns === undefined ? editor.columns : (a.columns ?? undefined);
  return {
    ...p,
    editor: {
      ...rest,
      value,
      fields: { ...editor.fields, ...values },
      ...(columns && { columns }),
    },
  };
}

const ATTACH = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];

export function fieldCommand(): CommandDef {
  let height: number | undefined;
  let attachment = 1;
  return {
    name: 'FIELD',
    async *run(ctx): CommandGenerator {
      const style = currentTextStyle(ctx.model);
      if (!style) {
        ctx.message('The drawing has no text style.');
        return;
      }
      const fc: FieldContext = { ...(await fieldContextOf(ctx)), space: ctx.space };
      const code: string | undefined = yield* askFieldCode(ctx, fc);
      if (code === undefined) return;
      let position;
      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Specify start point or',
          options: ['Height', 'Justify'],
        });
        if (a.kind === 'point') {
          position = a.point;
          break;
        }
        if (a.kind !== 'keyword') return;
        if (a.keyword === 'Height') {
          const h = yield ctx.prompt.distance({
            message: 'Specify height',
            default: { kind: 'distance', value: height ?? textSize(ctx.model) },
          });
          if (h.kind !== 'distance' || h.value <= 0) return;
          height = h.value;
        } else {
          const k = yield ctx.prompt.keyword({
            message: 'Enter justification',
            options: ATTACH,
            default: { kind: 'keyword', keyword: ATTACH[attachment - 1]! },
          });
          if (k.kind !== 'keyword') return;
          attachment = ATTACH.indexOf(k.keyword) + 1;
        }
      }
      const t = textWithFields(`%<${code}>%`, fc);
      const h = style.height > 0 ? style.height : (height ?? textSize(ctx.model));
      const geom: MTextGeometry = {
        kind: 'MTEXT',
        contents: t.text,
        ...(t.field && { field: t.field }),
        style: style.handle,
        position,
        height: h,
        width: 0,
        rotation: 0,
        attachment,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      };
      const props = currentProps(ctx.model);
      ctx.edit((b) => {
        b.addEntity({ owner: ctx.space, ...props, geom });
        if (style.height <= 0 && height !== undefined) b.setHeader('$TEXTSIZE', height);
      });
    },
  };
}
