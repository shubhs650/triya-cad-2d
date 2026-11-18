// NEW's Select Template dialog (M5-10), after AutoCAD 2024's (AutoCAD Help, "Select Template
// Dialog Box", a file dialog on the Template folder): the templates listed by name, the one
// picked described, Open and Cancel. A double click on a template, or Enter, opens it; arrow
// keys, Home and End move through the list. "Use as the default template" sets the template QNEW
// and the start screen's New drawing open, AutoCAD's "Default Template File Name for QNEW"
// (Options > Files > Template Settings).
//
// Left out (M5-10 part 2): the user's own templates (the templates folder) and Open's "Open with
// no template - Imperial / Metric".
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import type { DrawingTemplate } from './templates';

export function SelectTemplateDialog({
  templates,
  defaultId,
  onDefault,
  onOpen,
  onCancel,
}: {
  templates: readonly DrawingTemplate[];
  /** The default template's id, '' for none. */
  defaultId: string;
  /** "Use as the default template" checked (the template's id) or cleared (''). */
  onDefault: (id: string) => void;
  onOpen: (t: DrawingTemplate) => void;
  onCancel: () => void;
}) {
  const start = Math.max(
    0,
    templates.findIndex((t) => t.id === defaultId),
  );
  const [picked, setPicked] = useState(start);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const template = templates[picked];
  const open = () => {
    if (template) onOpen(template);
  };

  const keys = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = (i: number) => {
      e.preventDefault();
      const to = Math.min(templates.length - 1, Math.max(0, i));
      setPicked(to);
      listRef.current?.children[to]?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(picked + 1);
    else if (e.key === 'ArrowUp') move(picked - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(templates.length - 1);
  };

  return (
    <Modal label="Select Template" className="select-template" onOk={open} onCancel={onCancel}>
      <div className="select-template-body">
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Templates"
          aria-activedescendant={template ? `${listId}-${picked}` : undefined}
          className="dimstyle-list select-template-list"
          tabIndex={0}
          autoFocus
          onKeyDown={keys}
        >
          {templates.map((t, i) => (
            <li
              key={t.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === picked}
              className={i === picked ? 'layer-list-active' : undefined}
              onClick={() => setPicked(i)}
              onDoubleClick={() => onOpen(t)}
            >
              <span className="select-template-name">{t.name}</span>
              <span className="select-template-file">{t.file}</span>
            </li>
          ))}
        </ul>
        <p className="select-template-description" data-testid="template-description">
          {template?.description ?? ''}
        </p>
      </div>
      <label className="matchprop-check">
        <input
          type="checkbox"
          checked={template !== undefined && template.id === defaultId}
          disabled={template === undefined}
          onChange={(e) => onDefault(e.currentTarget.checked && template ? template.id : '')}
        />
        Use as the default template (QNEW)
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={open} disabled={template === undefined}>
          Open
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
