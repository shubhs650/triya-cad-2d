// FIND's Find and Replace dialog (M4-09 part 2), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Find and Replace Dialog Box"; UI_SPEC.md §7):
//
//   Find what, Find where (Current space/layout, Entire drawing, Selected objects) with its
//   Select objects button, Replace with, List results
//   the results list (Location, Object Type, Text) with Zoom to highlighted result and
//   Create selection set (all) / (highlighted), when List results is checked
//   More Options: Search Options (Match case, Find whole words only, Use wildcards, Search blocks,
//   Ignore hidden items, Match diacritics, Match half/full width forms) and Text Types (Block
//   attribute value, Dimension or leader text, Single-line or multiline text, Table text,
//   Hyperlink description, Hyperlink)
//   Replace, Replace All, Find (Find Next once a match is shown), Done
//
// Every button sends the dialog's fields to FIND, which searches, zooms to the match it shows and
// opens the dialog again with what it found; Done (or Esc) closes it. Changes already made stay.
import type {
  DialogRequest,
  FindAction,
  FindOptions,
  FindSettings,
  FindTextType,
  FindWhere,
  PromptAnswer,
} from '@triya/engine';
import { useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'find' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const WHERE: readonly [FindWhere, string][] = [
  ['space', 'Current space/layout'],
  ['drawing', 'Entire drawing'],
  ['selection', 'Selected objects'],
];

type Flag = Exclude<keyof FindOptions, 'types'>;

const SEARCH_OPTIONS: readonly [Flag, string][] = [
  ['matchCase', 'Match case'],
  ['wholeWords', 'Find whole words only'],
  ['wildcards', 'Use wildcards'],
  ['searchBlocks', 'Search blocks'],
  ['ignoreHidden', 'Ignore hidden items'],
  ['matchDiacritics', 'Match diacritics'],
  ['matchWidth', 'Match half/full width forms'],
];

const TEXT_TYPES: readonly [FindTextType, string][] = [
  ['attribute', 'Block attribute value'],
  ['dimension', 'Dimension or leader text'],
  ['text', 'Single-line or multiline text'],
  ['table', 'Table text'],
  ['hyperlinkDescription', 'Hyperlink description'],
  ['hyperlink', 'Hyperlink'],
];

/** More Options stays open from one opening to the next, as AutoCAD's does. */
let moreOptions = false;

export function FindReplaceDialog({ doc, request }: { doc: number; request: Request }) {
  const [s, setS] = useState<FindSettings>(request.settings);
  const [more, setMore] = useState(moreOptions);
  const [picked, setPicked] = useState<number | undefined>(request.current);
  const results = request.results;
  const options = s.options;
  const send = (action: FindAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', find: { settings: s, action } });
  const done = () => answer(doc, { kind: 'dialog', action: 'ok', find: { settings: s } });
  const setOption = (k: Flag, v: boolean) => setS({ ...s, options: { ...options, [k]: v } });
  const setType = (t: FindTextType, on: boolean) =>
    setS({
      ...s,
      options: {
        ...options,
        types: TEXT_TYPES.map(([k]) => k).filter((k) => (k === t ? on : options.types.includes(k))),
      },
    });
  const keys = (e: KeyboardEvent) => {
    if (!results || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const i = picked ?? -1;
    const next = Math.max(0, Math.min(results.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    setPicked(next);
  };
  const empty = s.find === '';

  return (
    // Enter is Find, the dialog's default button, as in AutoCAD.
    <Modal
      label="Find and Replace"
      className="find-dialog"
      onOk={() => (empty ? done() : send({ op: 'find' }))}
      onCancel={done}
    >
      <div className="find-fields">
        <label className="cad-dialog-field">
          <span>Find what:</span>
          <input
            type="text"
            value={s.find}
            autoFocus
            onChange={(e) => setS({ ...s, find: e.target.value })}
          />
        </label>
        <div className="cad-dialog-field">
          <label htmlFor="find-where">Find where:</label>
          <select
            id="find-where"
            value={s.where}
            onChange={(e) => setS({ ...s, where: e.target.value as FindWhere })}
          >
            {WHERE.filter(([w]) => w !== 'selection' || request.selected > 0).map(([w, label]) => (
              <option key={w} value={w}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => send({ op: 'select' })}>
            Select objects
          </button>
        </div>
        <label className="cad-dialog-field">
          <span>Replace with:</span>
          <input
            type="text"
            value={s.replace}
            onChange={(e) => setS({ ...s, replace: e.target.value })}
          />
        </label>
        <label className="cad-dialog-check">
          <input
            type="checkbox"
            checked={s.listResults}
            onChange={(e) => setS({ ...s, listResults: e.target.checked })}
          />
          List results
        </label>
      </div>
      {s.listResults && results && (
        <div className="find-results">
          <table className="eattedit-list find-list" aria-label="Results">
            <thead>
              <tr>
                <th>Location</th>
                <th>Object Type</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody tabIndex={0} onKeyDown={keys}>
              {results.map((r, i) => (
                <tr
                  key={i}
                  aria-selected={i === picked}
                  onClick={() => setPicked(i)}
                  onDoubleClick={() => send({ op: 'zoom', index: i })}
                >
                  <td>{r.location}</td>
                  <td>{r.objectType}</td>
                  <td title={r.text}>
                    {r.text.slice(0, r.start)}
                    <mark>{r.text.slice(r.start, r.end)}</mark>
                    {r.text.slice(r.end)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cad-dialog-buttons find-row">
            <button
              type="button"
              disabled={picked === undefined}
              onClick={() => picked !== undefined && send({ op: 'zoom', index: picked })}
            >
              Zoom to highlighted result
            </button>
            <button
              type="button"
              disabled={results.length === 0}
              onClick={() => send({ op: 'selectionSet' })}
            >
              Create selection set (all)
            </button>
            <button
              type="button"
              disabled={picked === undefined}
              onClick={() =>
                picked !== undefined && send({ op: 'selectionSet', indexes: [picked] })
              }
            >
              Create selection set (highlighted)
            </button>
          </div>
        </div>
      )}
      {request.note !== undefined && (
        <p className="find-note" role="status">
          {request.note}
        </p>
      )}
      <button
        type="button"
        className="find-more"
        aria-expanded={more}
        onClick={() => {
          moreOptions = !more;
          setMore(!more);
        }}
      >
        {more ? '⊖' : '⊕'} More Options
      </button>
      {more && (
        <div className="find-options">
          <fieldset>
            <legend>Search Options</legend>
            {SEARCH_OPTIONS.map(([k, label]) => (
              <label key={k} className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={options[k]}
                  onChange={(e) => setOption(k, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Text Types</legend>
            {TEXT_TYPES.map(([t, label]) => (
              <label key={t} className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={options.types.includes(t)}
                  onChange={(e) => setType(t, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={empty} onClick={() => send({ op: 'replace' })}>
          Replace
        </button>
        <button type="button" disabled={empty} onClick={() => send({ op: 'replaceAll' })}>
          Replace All
        </button>
        <button type="button" disabled={empty} onClick={() => send({ op: 'find' })}>
          {request.current === undefined ? 'Find' : 'Find Next'}
        </button>
        <button type="button" onClick={done}>
          Done
        </button>
      </div>
    </Modal>
  );
}
