// NEW's Select Template dialog (M5-10), after AutoCAD 2024's (AutoCAD Help, "Select Template
// Dialog Box", a file dialog on the Template folder): the templates listed by name, the one
// picked described, Open and Cancel. A double click on a template, or Enter, opens it; arrow
// keys, Home and End move through the list. "Use as the default template" sets the template QNEW
// and the start screen's New drawing open, AutoCAD's "Default Template File Name for QNEW"
// (Options > Files > Template Settings).
//
// Part 2: the user's own templates (Settings > Templates) listed after the bundled ones, and the
// Open button's arrow, as AutoCAD's, offering Open, "Open with no template - Imperial" and "Open
// with no template - Metric".
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { NO_TEMPLATE, type DrawingTemplate } from './templates';

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
  // The list may grow while the dialog is open (the user's templates read back from the device).
  useEffect(() => {
    if (picked >= templates.length) setPicked(Math.max(0, templates.length - 1));
  }, [picked, templates.length]);

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
        <OpenButton template={template} onOpen={onOpen} />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * Open, and its arrow's menu (AutoCAD's Select Template Open button): Open, "Open with no template
 * - Imperial" and "Open with no template - Metric". The menu is keyboard-operable: Enter, Space
 * or ArrowDown on the arrow opens it on its first item, arrow keys, Home and End move, Escape
 * closes it (and only it) and Tab leaves it.
 */
function OpenButton({
  template,
  onOpen,
}: {
  template: DrawingTemplate | undefined;
  onOpen: (t: DrawingTemplate) => void;
}) {
  const [shown, setShown] = useState(false);
  const arrow = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const items = (): HTMLElement[] =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
  const focusItem = (to: number | 'first' | 'last') => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const i =
      to === 'first' ? 0 : to === 'last' ? all.length - 1 : (at + to + all.length) % all.length;
    all[i]?.focus();
  };
  useEffect(() => {
    if (shown)
      menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [shown]);
  const close = (refocus: boolean) => {
    setShown(false);
    if (refocus) arrow.current?.focus();
  };
  const choose = (t: DrawingTemplate) => {
    setShown(false);
    onOpen(t);
  };
  return (
    <span className="split-button">
      <button type="button" onClick={() => template && onOpen(template)} disabled={!template}>
        Open
      </button>
      <button
        ref={arrow}
        type="button"
        className="split-button-arrow"
        aria-label="Open options"
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? menuId : undefined}
        onClick={() => setShown(!shown)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setShown(true);
          }
        }}
      >
        ▾
      </button>
      {shown && (
        <div
          ref={menu}
          id={menuId}
          className="split-button-menu"
          role="menu"
          aria-label="Open options"
          onBlur={(e) => {
            if (
              !e.currentTarget.contains(e.relatedTarget as Node | null) &&
              e.relatedTarget !== arrow.current
            )
              setShown(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // The menu closes, not the dialog.
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              focusItem(e.key === 'Home' ? 'first' : 'last');
            } else if (e.key === 'Tab') {
              close(false);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!template}
            onClick={() => template && choose(template)}
          >
            Open
          </button>
          <button type="button" role="menuitem" onClick={() => choose(NO_TEMPLATE.imperial)}>
            Open with no template - Imperial
          </button>
          <button type="button" role="menuitem" onClick={() => choose(NO_TEMPLATE.metric)}>
            Open with no template - Metric
          </button>
        </div>
      )}
    </span>
  );
}
