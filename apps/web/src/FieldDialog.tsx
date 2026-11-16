// FIELD's Field dialog (M4-10 part 2), with AutoCAD 2024's structure and labels (AutoCAD Help,
// "Field Dialog Box"; UI_SPEC.md §7): Field category and Field names on the left; the chosen
// field's choices beside them (a date's Date format and Examples; Filename's Format, its
// parts and Display file extension; an Object's Object type with Select object, Property,
// Format and Precision; a System variable and its Format); Preview and Field expression below;
// OK and Cancel. The dialog builds the field's code (`fieldCode`) and previews it against what
// the engine gave it of the drawing (`previewField`), as the field will show. The lists are
// list boxes, so the arrow keys move through them; Enter is OK, Esc Cancel. AutoCAD's Help
// button is left out, as Triya's other dialogs leave it.
import {
  DATE_EXAMPLES,
  DATE_FIELDS,
  FIELD_CATEGORIES,
  NUMBER_FORMATS,
  PLOT_SCALE_FORMATS,
  TEXT_CASES,
  fieldCode,
  previewField,
  type FieldDialogRequest,
  type FieldName,
  type FieldSpec,
  type FilenameParts,
  type PromptAnswer,
} from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** Precision's list: the drawing's, then 0 to 8 places. */
const PRECISIONS = ['Current precision', ...Array.from({ length: 9 }, (_, n) => (0).toFixed(n))];

/** The system variables listed first: those a title block shows most. */
const FIRST_VARIABLES = ['CTAB', 'DWGNAME', 'DWGPREFIX'];

function Listbox({
  label,
  items,
  value,
  onChange,
  size = 8,
}: {
  label: string;
  items: readonly string[];
  value: number;
  onChange: (index: number) => void;
  size?: number;
}) {
  return (
    <label className="field-dialog-list">
      {label}
      <select
        size={size}
        value={value < 0 ? '' : String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {items.map((item, n) => (
          <option key={n} value={n}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function Precision({ spec, set }: { spec: FieldSpec; set: (s: FieldSpec) => void }) {
  return (
    <label className="cad-dialog-field">
      <span>Precision:</span>
      <select
        value={spec.precision === undefined ? 0 : spec.precision + 1}
        onChange={(e) => {
          const { precision: _was, ...rest } = spec;
          const n = Number(e.target.value);
          set(n === 0 ? rest : { ...rest, precision: n - 1 });
        }}
      >
        {PRECISIONS.map((p, n) => (
          <option key={n} value={n}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}

const caseOf = (spec: FieldSpec): number => spec.textCase ?? 0;
const withCase = (spec: FieldSpec, n: number): FieldSpec => {
  const { textCase: _was, ...rest } = spec;
  return n > 0 ? { ...rest, textCase: n } : rest;
};

export function FieldDialog({ doc, request }: { doc: number; request: FieldDialogRequest }) {
  const s = request.snapshot;
  const [category, setCategory] = useState(0);
  const [spec, setSpec] = useState<FieldSpec>(
    request.spec ?? { name: 'Date', date: DATE_EXAMPLES[0]! },
  );
  const names = FIELD_CATEGORIES[category]!.fields;
  const choose = (name: FieldName) => {
    if (name === spec.name) return;
    setSpec(DATE_FIELDS.has(name) ? { name, date: DATE_EXAMPLES[0]! } : { name });
  };
  const code = fieldCode(spec);
  const preview = code === undefined ? '' : previewField(code, s);
  const ok = () => answer(doc, { kind: 'dialog', action: 'ok', field: spec });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const variables = [
    ...FIRST_VARIABLES,
    ...Object.keys(s.variables)
      .filter((v) => !FIRST_VARIABLES.includes(v))
      .sort(),
  ];
  const variableValue = (v: string | undefined) =>
    v === undefined ? undefined : v === 'CTAB' ? s.layout?.name : s.variables[v];
  const properties = spec.object === undefined ? {} : (s.objects[spec.object] ?? {});
  const propertyNames = Object.keys(properties);
  const numeric =
    spec.name === 'Object'
      ? spec.property !== undefined &&
        properties[spec.property] !== undefined &&
        'n' in properties[spec.property]!
      : spec.name === 'SystemVariable' && typeof variableValue(spec.variable) === 'number';

  const formatPane = () => {
    if (DATE_FIELDS.has(spec.name)) {
      return (
        <>
          <label className="cad-dialog-field">
            <span>Date format:</span>
            <input
              type="text"
              value={spec.date ?? ''}
              onChange={(e) => setSpec({ ...spec, date: e.target.value })}
            />
          </label>
          <Listbox
            label="Examples:"
            items={DATE_EXAMPLES.map((d) => previewField(fieldCode({ name: 'Date', date: d })!, s))}
            value={DATE_EXAMPLES.indexOf(spec.date ?? '')}
            onChange={(n) => setSpec({ ...spec, date: DATE_EXAMPLES[n]! })}
          />
        </>
      );
    }
    if (spec.name === 'Filename') {
      const parts = spec.parts ?? 'name';
      const radio = (p: FilenameParts, label: string) => (
        <label>
          <input
            type="radio"
            name="field-filename"
            checked={parts === p}
            onChange={() => setSpec({ ...spec, parts: p })}
          />
          {label}
        </label>
      );
      return (
        <>
          <Listbox
            label="Format:"
            items={TEXT_CASES}
            value={caseOf(spec)}
            onChange={(n) => setSpec(withCase(spec, n))}
            size={5}
          />
          <fieldset className="field-dialog-radios">
            {radio('name', 'Filename only')}
            {radio('path', 'Path only')}
            {radio('full', 'Path and filename')}
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={spec.extension !== false && parts !== 'path'}
              disabled={parts === 'path'}
              onChange={(e) => setSpec({ ...spec, extension: e.target.checked })}
            />
            Display file extension
          </label>
        </>
      );
    }
    if (spec.name === 'PageSetupName') {
      return (
        <Listbox
          label="Format:"
          items={TEXT_CASES}
          value={caseOf(spec)}
          onChange={(n) => setSpec(withCase(spec, n))}
          size={5}
        />
      );
    }
    if (spec.name === 'PlotScale') {
      return (
        <>
          <Listbox
            label="Format:"
            items={PLOT_SCALE_FORMATS}
            value={spec.scaleFormat ?? 0}
            onChange={(n) => setSpec({ ...spec, scaleFormat: n })}
            size={3}
          />
          {spec.scaleFormat === 1 && <Precision spec={spec} set={setSpec} />}
        </>
      );
    }
    if (spec.name === 'SystemVariable') {
      return (
        <>
          <Listbox
            label="System variable:"
            items={variables}
            value={spec.variable === undefined ? -1 : variables.indexOf(spec.variable)}
            onChange={(n) => setSpec({ name: 'SystemVariable', variable: variables[n]! })}
          />
          {spec.variable !== undefined && numberOrCase()}
        </>
      );
    }
    // Object.
    return (
      <>
        <div className="cad-dialog-field">
          <span>Object type:</span>
          <output aria-label="Object type">{request.objectType ?? ''}</output>
          <button
            type="button"
            onClick={() => answer(doc, { kind: 'dialog', action: 'select', field: spec })}
          >
            Select object
          </button>
        </div>
        <Listbox
          label="Property:"
          items={propertyNames}
          value={spec.property === undefined ? -1 : propertyNames.indexOf(spec.property)}
          onChange={(n) => {
            const { units: _u, precision: _p, textCase: _t, ...rest } = spec;
            setSpec({ ...rest, property: propertyNames[n]! });
          }}
          size={5}
        />
        {spec.property !== undefined && numberOrCase()}
      </>
    );
  };

  /** A number's Format and Precision, or a text's Format. */
  function numberOrCase() {
    if (!numeric) {
      return (
        <Listbox
          label="Format:"
          items={TEXT_CASES}
          value={caseOf(spec)}
          onChange={(n) => setSpec(withCase(spec, n))}
          size={5}
        />
      );
    }
    return (
      <>
        <Listbox
          label="Format:"
          items={NUMBER_FORMATS}
          value={spec.units ?? 0}
          onChange={(n) => {
            const { units: _was, ...rest } = spec;
            setSpec(n > 0 ? { ...rest, units: n } : rest);
          }}
          size={6}
        />
        <Precision spec={spec} set={setSpec} />
      </>
    );
  }

  return (
    <Modal label="Field" className="field-dialog" onOk={ok} onCancel={cancel}>
      <div className="field-dialog-layout">
        <div className="field-dialog-names">
          <label className="cad-dialog-field">
            <span>Field category:</span>
            <select value={category} onChange={(e) => setCategory(Number(e.target.value))}>
              {FIELD_CATEGORIES.map((c, n) => (
                <option key={c.name} value={n}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Listbox
            label="Field names:"
            items={names}
            value={names.indexOf(spec.name)}
            onChange={(n) => choose(names[n]!)}
            size={10}
          />
        </div>
        <div className="field-dialog-format">{formatPane()}</div>
      </div>
      <div className="cad-dialog-field">
        <span>Preview:</span>
        <output aria-label="Preview">{preview}</output>
      </div>
      <label className="field-dialog-expression">
        Field expression:
        <textarea readOnly rows={2} value={code === undefined ? '' : `%<${code}>%`} />
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
