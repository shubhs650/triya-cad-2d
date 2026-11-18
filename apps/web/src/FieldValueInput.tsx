// An attribute dialog's value box holding fields (M5-03 part 4): ATTDEF's Default, BATTMAN Edit
// Attribute's Default, EATTEDIT's Value and ATTEDIT's values. As AutoCAD's text boxes show a
// field, each one shows its value and is edited as one atom (typing into or deleting across it
// takes it whole), as TEXT's line editor does (text-editor.ts `lineParts`, `lineEdited`). The
// value goes to the engine with each field as its code (`%<\AcVar Date>%`).
//
// With `onField`, Insert Field (the button beside the box, or Ctrl+F in it) answers the value
// with the field's place marked where the caret is (`%<FIELD_INSERT>%`, the selection taken
// out), and a double click on a field answers it marked for Edit Field (`%<FIELD_EDIT code>%`):
// the engine opens the Field dialog and the dialog comes back with the field made. A multiline
// value shows each `\P` as a new line.
import { FIELD_EDIT, FIELD_INSERT } from '@triya/engine';
import { useLayoutEffect, useRef } from 'react';
import {
  lineEdited,
  lineFieldAt,
  lineParts,
  lineShown,
  lineSplit,
  lineValue,
  type LinePart,
} from './text-editor';

/** What a value holding field codes shows, each field by its value (`fields` absent: as it is). */
export const fieldValueShown = (
  value: string,
  fields: Readonly<Record<string, string>> | undefined,
): string => lineShown(lineParts(value, fields));

/** A place in what the box shows, as a place in the value's text (`\P` two characters there). */
const storedAt = (shown: string, at: number, multiline: boolean): number =>
  multiline ? at + (shown.slice(0, at).match(/\n/g)?.length ?? 0) : at;

/** A place in the value's text, as a place in what the box shows. */
const shownAt = (text: string, at: number, multiline: boolean): number =>
  multiline ? at - (text.slice(0, at).match(/\\P/g)?.length ?? 0) : at;

export function FieldValueInput({
  value,
  fields,
  multiline = false,
  onChange,
  onField,
  id,
  label,
  disabled,
}: {
  /** The value, its fields as their codes when `fields` is given. */
  value: string;
  /** What each field shows, by code; absent, the value is plain text (no fields, no Insert Field). */
  fields?: Readonly<Record<string, string>>;
  multiline?: boolean;
  onChange: (value: string) => void;
  /** Insert Field or Edit Field: the value with the field's place marked. */
  onField?: (marked: string) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
}) {
  const parts: LinePart[] = lineParts(value, fields);
  const text = lineShown(parts);
  const display = multiline ? text.replace(/\\P/g, '\n') : text;
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  /** Where the caret goes once the value an edit made is shown (a field taken whole moves it). */
  const caret = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const at = caret.current;
    if (at === undefined || !box.current) return;
    caret.current = undefined;
    box.current.setSelectionRange(at, at);
  }, [value]);
  const fieldsOn = fields !== undefined && onField !== undefined && !disabled;
  const insertField = () => {
    const el = box.current;
    if (!fieldsOn || !el) return;
    const a = storedAt(el.value, el.selectionStart ?? el.value.length, multiline);
    const b = storedAt(el.value, el.selectionEnd ?? el.value.length, multiline);
    // The selection goes (a field it reaches into whole), the field's place marked there.
    const cut = lineEdited(parts, text.slice(0, a) + text.slice(b), a);
    const [head, tail] = lineSplit(cut, a);
    onField(`${lineValue(head)}%<${FIELD_INSERT}>%${lineValue(tail)}`);
  };
  const editField = (): boolean => {
    const el = box.current;
    if (!fieldsOn || !el) return false;
    const at = lineFieldAt(parts, storedAt(el.value, el.selectionStart ?? 0, multiline));
    if (!at) return false;
    onField(
      lineValue(
        parts.map((p, i) =>
          i === at.index && 'code' in p ? { ...p, code: FIELD_EDIT + p.code } : p,
        ),
      ),
    );
    return true;
  };
  const props = {
    id,
    'aria-label': label,
    disabled,
    value: display,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const shown = e.target.value;
      const at = storedAt(shown, e.target.selectionStart ?? shown.length, multiline);
      const stored = multiline ? shown.replace(/\r?\n/g, '\\P') : shown.replace(/\r?\n/g, ' ');
      const next = lineEdited(parts, stored, at);
      const now = lineShown(next);
      // A field deleted whole moves the caret to where it was.
      if (now !== stored) caret.current = shownAt(now, Math.min(at, now.length), multiline);
      onChange(lineValue(next));
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (editField()) e.preventDefault();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && fieldsOn) {
        e.preventDefault();
        e.stopPropagation();
        insertField();
      }
    },
  };
  return (
    <>
      {multiline ? (
        <textarea ref={box} rows={3} {...props} />
      ) : (
        <input ref={box} type="text" {...props} />
      )}
      {fields !== undefined && onField !== undefined && (
        <button
          type="button"
          className="field-value-insert"
          title="Insert Field (Ctrl+F)"
          aria-label="Insert Field"
          disabled={disabled}
          onClick={insertField}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="1.5" y="3.5" width="13" height="9" rx="1" fill="none" stroke="currentColor" />
            <text x="8" y="10.5" fontSize="7" textAnchor="middle" fill="currentColor">
              #
            </text>
          </svg>
        </button>
      )}
    </>
  );
}
