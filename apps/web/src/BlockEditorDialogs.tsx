// The Block Editor's dialogs (M5-02 part 1), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Edit Block Definition Dialog Box", "Block - Changes Not Saved Dialog Box"; UI_SPEC.md
// §7):
//
// - BEDIT's Edit Block Definition: "Block to create or edit" (a name box over the list of the
//   drawing's blocks), Preview and Description of the block picked, OK and Cancel. A double
//   click on a block opens it. The engine says why a name it cannot open was refused.
// - BCLOSE's Block - Changes Not Saved: Save the changes to <name>, Discard the changes and
//   close the Block Editor, and Cancel (the editor stays open).
//
// M5-02 part 2: a name no block has makes a new, empty block, which opens in the editor.
//
// Left out (block-editor.ts says why): <Current Drawing>, and Help.
//
// M5-02 part 3: REFEDIT's Reference Edit (AutoCAD Help, "Reference Edit Dialog Box"): the
// Identify Reference tab (the Reference name tree, from the reference picked to the one nested
// deepest under the pick, Preview, Path, and Automatically select all nested objects or Prompt to
// select nested objects) and the Settings tab (Create unique layer, style, and block names,
// Display attribute definitions for editing, Lock objects not in working set).
import type { DialogRequest, PromptAnswer } from '@triya/engine';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { StylePreview } from './StylePreview';
import { engines } from './engine/registry';

type EditRequest = Extract<DialogRequest, { type: 'bedit' }>;
type CloseRequest = Extract<DialogRequest, { type: 'bclose' }>;
type RefEditRequest = Extract<DialogRequest, { type: 'refedit' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const PREVIEW = { width: 160, height: 120 };

/** BEDIT's Edit Block Definition dialog. */
export function EditBlockDefinitionDialog({ doc, request }: { doc: number; request: EditRequest }) {
  const { blocks } = request;
  const [name, setName] = useState(request.name);
  const listId = useId();
  const nameId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const picked = blocks.findIndex((b) => b.name.toUpperCase() === name.trim().toUpperCase());
  const block = picked >= 0 ? blocks[picked] : undefined;
  const preview = useMemo(
    () => (block ? { kind: 'block' as const, block: block.handle } : undefined),
    [block],
  );

  const open = (n: string) =>
    void answer(doc, { kind: 'dialog', action: 'ok', bedit: { name: n.trim() } });
  const ok = () => {
    if (name.trim() !== '') open(name);
  };
  const cancel = () => void engines.command(doc, { kind: 'cancel' });

  const keys = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = (i: number) => {
      e.preventDefault();
      const to = Math.min(blocks.length - 1, Math.max(0, i));
      const b = blocks[to];
      if (!b) return;
      setName(b.name);
      listRef.current?.children[to]?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(picked + 1);
    else if (e.key === 'ArrowUp') move(picked - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(blocks.length - 1);
  };

  return (
    <Modal label="Edit Block Definition" className="bedit-dialog" onOk={ok} onCancel={cancel}>
      <div className="bedit-dialog-body">
        <div className="bedit-dialog-blocks">
          <label className="cad-dialog-field" htmlFor={nameId}>
            <span>Block to create or edit</span>
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            spellCheck={false}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Blocks"
            aria-activedescendant={block ? `${listId}-${picked}` : undefined}
            className="dimstyle-list bedit-dialog-list"
            tabIndex={0}
            autoFocus
            onKeyDown={keys}
          >
            {blocks.map((b, i) => (
              <li
                key={b.handle}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === picked}
                className={i === picked ? 'layer-list-active' : undefined}
                onClick={() => setName(b.name)}
                onDoubleClick={() => open(b.name)}
              >
                {b.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="bedit-dialog-side">
          <span>Preview</span>
          <StylePreview doc={doc} preview={preview} size={PREVIEW} testId="bedit-preview" />
          <span>Description</span>
          <p className="bedit-dialog-description" data-testid="bedit-description">
            {block?.description ?? ''}
          </p>
        </div>
      </div>
      {request.note !== undefined && (
        <p role="alert" className="bedit-dialog-note">
          {request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={name.trim() === ''}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** BCLOSE's Block - Changes Not Saved question. */
export function BlockChangesNotSavedDialog({
  doc,
  request,
}: {
  doc: number;
  request: CloseRequest;
}) {
  const choose = (bclose: 'save' | 'discard') =>
    void answer(doc, { kind: 'dialog', action: 'ok', bclose });
  const cancel = () => void engines.command(doc, { kind: 'cancel' });
  return (
    <Modal
      label="Block - Changes Not Saved"
      className="bclose-dialog"
      onOk={() => choose('save')}
      onCancel={cancel}
    >
      <p>Do you want to save the changes to {request.name}?</p>
      <div className="cad-dialog-choices">
        <button type="button" autoFocus onClick={() => choose('save')}>
          Save the changes to {request.name}
        </button>
        <button type="button" onClick={() => choose('discard')}>
          Discard the changes and close the Block Editor
        </button>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const REFEDIT_TABS = [
  ['identify', 'Identify Reference'],
  ['settings', 'Settings'],
] as const;

/** REFEDIT's Reference Edit dialog. */
export function ReferenceEditDialog({ doc, request }: { doc: number; request: RefEditRequest }) {
  const { references } = request;
  const [tab, setTab] = useState<(typeof REFEDIT_TABS)[number][0]>('identify');
  const [chosen, setChosen] = useState(request.chosen);
  const [settings, setSettings] = useState(request.settings);
  const treeId = useId();
  const picked = references[chosen];
  const preview = useMemo(
    () => (picked ? { kind: 'block' as const, block: picked.block } : undefined),
    [picked],
  );
  const ok = () =>
    void answer(doc, { kind: 'dialog', action: 'ok', refedit: { chosen, settings } });
  const cancel = () => void engines.command(doc, { kind: 'cancel' });
  const set = (patch: Partial<typeof settings>) => setSettings((s) => ({ ...s, ...patch }));
  const keys = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = (i: number) => {
      e.preventDefault();
      setChosen(Math.min(references.length - 1, Math.max(0, i)));
    };
    if (e.key === 'ArrowDown') move(chosen + 1);
    else if (e.key === 'ArrowUp') move(chosen - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(references.length - 1);
  };
  const check = (label: string, key: 'unique' | 'attributes' | 'lock') => (
    <label className="cad-dialog-check">
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => set({ [key]: e.currentTarget.checked })}
      />
      {label}
    </label>
  );

  return (
    <Modal label="Reference Edit" className="refedit-dialog" onOk={ok} onCancel={cancel}>
      <div role="tablist" className="cad-dialog-tabs">
        {REFEDIT_TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="cad-dialog-panel">
        {tab === 'identify' ? (
          <div className="bedit-dialog-body">
            <div className="bedit-dialog-blocks">
              <span id={`${treeId}-label`}>Reference name:</span>
              <ul
                role="tree"
                aria-labelledby={`${treeId}-label`}
                aria-activedescendant={`${treeId}-${chosen}`}
                className="dimstyle-list refedit-dialog-tree"
                tabIndex={0}
                autoFocus
                onKeyDown={keys}
              >
                {references.map((r, i) => (
                  <li
                    key={`${i}-${r.block}`}
                    id={`${treeId}-${i}`}
                    role="treeitem"
                    aria-level={i + 1}
                    aria-selected={i === chosen}
                    className={i === chosen ? 'layer-list-active' : undefined}
                    style={{ paddingLeft: `${4 + i * 16}px` }}
                    onClick={() => setChosen(i)}
                  >
                    {r.name}
                  </li>
                ))}
              </ul>
              <span>Path:</span>
              <p className="bedit-dialog-description" data-testid="refedit-path" />
            </div>
            <div className="bedit-dialog-side">
              <span>Preview</span>
              <StylePreview doc={doc} preview={preview} size={PREVIEW} testId="refedit-preview" />
            </div>
            <fieldset className="refedit-dialog-nested">
              <legend className="visually-hidden">Nested objects</legend>
              <label className="cad-dialog-check">
                <input
                  type="radio"
                  name={`${treeId}-nested`}
                  checked={!settings.prompt}
                  onChange={() => set({ prompt: false })}
                />
                Automatically select all nested objects
              </label>
              <label className="cad-dialog-check">
                <input
                  type="radio"
                  name={`${treeId}-nested`}
                  checked={settings.prompt}
                  onChange={() => set({ prompt: true })}
                />
                Prompt to select nested objects
              </label>
            </fieldset>
          </div>
        ) : (
          <div className="refedit-dialog-settings">
            {check('Create unique layer, style, and block names', 'unique')}
            {check('Display attribute definitions for editing', 'attributes')}
            {check('Lock objects not in working set', 'lock')}
          </div>
        )}
      </div>
      {request.note !== undefined && (
        <p role="alert" className="bedit-dialog-note">
          {request.note}
        </p>
      )}
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
