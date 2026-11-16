// SPELL's Check Spelling dialog (M4-09 part 4), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Check Spelling Dialog Box", "Check Spelling Settings Dialog Box",
// "Dictionaries Dialog Box"; UI_SPEC.md §7):
//
//   Where to check (Entire drawing, Current space/layout, Selected objects) with its Select
//   text objects button, Start
//   Not in dictionary (the word, and the text it is in), Suggestions (the box and its list)
//   Main dictionary
//   Add to Dictionary, Ignore, Ignore All, Change, Change All
//   Settings... (Include: Dimension text, Block attributes, External references; Options:
//   Ignore capitalized words, Ignore words with mixed cases, Ignore words in uppercase, Ignore
//   words with numbers, Ignore words containing punctuation)
//   Dictionaries... (Main dictionary, the custom dictionary's Content with Add, Delete, Import)
//   Undo, Close
//
// Every button sends the dialog's settings and the custom dictionary to SPELL, which finds the
// next word, zooms to it and opens the dialog again; Close (or Esc) closes it.
import type {
  DialogRequest,
  PromptAnswer,
  SpellAction,
  SpellSettings,
  SpellWhere,
} from '@triya/engine';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { customDictionary, validWord, wordsOfFile } from './custom-dictionary';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'spell' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const WHERE: readonly [SpellWhere, string][] = [
  ['drawing', 'Entire drawing'],
  ['space', 'Current space/layout'],
  ['selection', 'Selected objects'],
];

type Flag = Exclude<keyof SpellSettings, 'where'>;

const INCLUDE: readonly [Flag, string][] = [
  ['dimensions', 'Dimension text'],
  ['attributes', 'Block attributes'],
  ['xrefs', 'External references'],
];

const OPTIONS: readonly [Flag, string][] = [
  ['ignoreCapitalized', 'Ignore capitalized words'],
  ['ignoreMixed', 'Ignore words with mixed cases'],
  ['ignoreUppercase', 'Ignore words in uppercase'],
  ['ignoreNumbers', 'Ignore words with numbers'],
  ['ignorePunctuation', 'Ignore words containing punctuation'],
];

export function SpellDialog({ doc, request }: { doc: number; request: Request }) {
  // What SPELL added to (or took from) the custom dictionary is the user's from now on.
  useEffect(() => {
    if (request.custom) customDictionary.set(request.custom);
  }, [request.custom]);
  const [s, setS] = useState<SpellSettings>(request.settings);
  const word = request.word;
  const [to, setTo] = useState(word ? (word.suggestions[0] ?? word.word) : '');
  const [sub, setSub] = useState<'settings' | 'dictionaries' | undefined>();
  const send = (action: SpellAction, settings = s) =>
    answer(doc, {
      kind: 'dialog',
      action: 'apply',
      spell: { settings, custom: customDictionary.words, action },
    });
  const close = () =>
    answer(doc, {
      kind: 'dialog',
      action: 'ok',
      spell: { settings: s, custom: customDictionary.words },
    });
  const changing = word !== undefined && !word.readOnly && to !== '';

  return (
    // Enter is Start before a word is found, then Change, as the default button moves.
    <Modal
      label="Check Spelling"
      className="spell-dialog"
      onOk={() => (word ? changing && send({ op: 'change', to }) : send({ op: 'start' }))}
      onCancel={close}
    >
      <div className="spell-layout">
        <div className="spell-main">
          <div className="cad-dialog-field">
            <label htmlFor="spell-where">Where to check:</label>
            <select
              id="spell-where"
              value={s.where}
              onChange={(e) => setS({ ...s, where: e.target.value as SpellWhere })}
            >
              {WHERE.filter(([w]) => w !== 'selection' || request.selected > 0).map(
                ([w, label]) => (
                  <option key={w} value={w}>
                    {label}
                  </option>
                ),
              )}
            </select>
            <button type="button" onClick={() => send({ op: 'select' })}>
              Select text objects
            </button>
          </div>
          <label className="cad-dialog-field">
            <span>Not in dictionary:</span>
            <input type="text" readOnly value={word?.word ?? ''} />
          </label>
          {word && (
            <p className="spell-context" title={`${word.location} · ${word.objectType}`}>
              {word.context.text.slice(0, word.context.start)}
              <mark>{word.context.text.slice(word.context.start, word.context.end)}</mark>
              {word.context.text.slice(word.context.end)}
            </p>
          )}
          <label className="cad-dialog-field">
            <span>Suggestions:</span>
            <input
              type="text"
              value={to}
              disabled={!word}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <select
            className="spell-suggestions"
            aria-label="Suggestion list"
            size={5}
            disabled={!word}
            value={word?.suggestions.includes(to) ? to : ''}
            onChange={(e) => setTo(e.target.value)}
            onDoubleClick={() => changing && send({ op: 'change', to })}
          >
            {word && word.suggestions.length === 0 && (
              <option value="" disabled>
                (no suggestions)
              </option>
            )}
            {word?.suggestions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <div className="cad-dialog-field">
            <label htmlFor="spell-main-dictionary">Main dictionary:</label>
            <select id="spell-main-dictionary" value={request.dictionary} disabled>
              <option value={request.dictionary}>{request.dictionary}</option>
            </select>
          </div>
        </div>
        <div className="spell-actions">
          <button type="button" onClick={() => send({ op: 'start' })}>
            Start
          </button>
          <button type="button" disabled={!word} onClick={() => send({ op: 'add' })}>
            Add to Dictionary
          </button>
          <button type="button" disabled={!word} onClick={() => send({ op: 'ignore' })}>
            Ignore
          </button>
          <button type="button" disabled={!word} onClick={() => send({ op: 'ignoreAll' })}>
            Ignore All
          </button>
          <button type="button" disabled={!changing} onClick={() => send({ op: 'change', to })}>
            Change
          </button>
          <button type="button" disabled={!changing} onClick={() => send({ op: 'changeAll', to })}>
            Change All
          </button>
        </div>
      </div>
      {request.note !== undefined && (
        <p className="find-note" role="status">
          {request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => setSub('dictionaries')}>
          Dictionaries...
        </button>
        <button type="button" onClick={() => setSub('settings')}>
          Settings...
        </button>
        <button type="button" disabled={!request.undo} onClick={() => send({ op: 'undo' })}>
          Undo
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      {sub === 'settings' && (
        <SpellSettingsDialog
          settings={s}
          onOk={(next) => {
            setS(next);
            setSub(undefined);
          }}
          onCancel={() => setSub(undefined)}
        />
      )}
      {sub === 'dictionaries' && (
        <DictionariesDialog
          dictionary={request.dictionary}
          // SPELL checks with the words as they are left from its next button on.
          onClose={() => setSub(undefined)}
        />
      )}
    </Modal>
  );
}

function SpellSettingsDialog(props: {
  settings: SpellSettings;
  onOk: (s: SpellSettings) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(props.settings);
  const check = ([k, label]: readonly [Flag, string]) => (
    <label key={k} className="cad-dialog-check">
      <input
        type="checkbox"
        checked={s[k] as boolean}
        onChange={(e) => setS({ ...s, [k]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <Modal label="Check Spelling Settings" onOk={() => props.onOk(s)} onCancel={props.onCancel}>
      <div className="find-options spell-settings">
        <fieldset>
          <legend>Include</legend>
          {INCLUDE.map(check)}
        </fieldset>
        <fieldset>
          <legend>Options</legend>
          {OPTIONS.map(check)}
        </fieldset>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => props.onOk(s)}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function DictionariesDialog(props: { dictionary: string; onClose: () => void }) {
  const [words, setWords] = useState(customDictionary.words);
  const [entry, setEntry] = useState('');
  const [picked, setPicked] = useState<string>('');
  const file = useRef<HTMLInputElement>(null);
  const save = (next: readonly string[]) => {
    customDictionary.set(next);
    setWords(customDictionary.words);
  };
  const add = () => {
    const w = entry.trim();
    if (!validWord(w)) return;
    save([...words, w]);
    setEntry('');
  };
  const sorted = [...words].sort((a, b) => a.localeCompare(b));
  return (
    <Modal label="Dictionaries" className="spell-dictionaries" onOk={add} onCancel={props.onClose}>
      <div className="cad-dialog-field">
        <label htmlFor="spell-dictionaries-main">Main dictionary:</label>
        <select id="spell-dictionaries-main" value={props.dictionary} disabled>
          <option value={props.dictionary}>{props.dictionary}</option>
        </select>
      </div>
      <fieldset className="spell-custom">
        <legend>Custom dictionary</legend>
        <div className="cad-dialog-field">
          <label htmlFor="spell-word">Content:</label>
          <input
            id="spell-word"
            type="text"
            value={entry}
            maxLength={63}
            onChange={(e) => setEntry(e.target.value)}
          />
          <button type="button" disabled={!validWord(entry.trim())} onClick={add}>
            Add
          </button>
        </div>
        <select
          aria-label="Custom dictionary words"
          size={8}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
        >
          {sorted.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <div className="cad-dialog-buttons find-row">
          <button
            type="button"
            disabled={picked === ''}
            onClick={() => {
              save(words.filter((w) => w !== picked));
              setPicked('');
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => file.current?.click()}>
            Import...
          </button>
          <input
            ref={file}
            type="file"
            hidden
            aria-label="Import words"
            accept=".cus,.txt,.dic,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f)
                void f.text().then((t) => save([...customDictionary.words, ...wordsOfFile(t)]));
            }}
          />
        </div>
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
