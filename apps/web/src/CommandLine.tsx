// The command line (M2-02, UI_SPEC.md §5): AutoCAD's docked command window under the layout
// tabs. The last history lines above the prompt line; the prompt's options as chips; commands
// completed as they are typed; Up/Down recall; F2 opens the whole history. Typing anywhere
// outside a text field goes to it, and Enter or Space there ends the input, as in AutoCAD. It
// is a front-end of the drawing's command engine, which runs in the engine worker. Dynamic
// Input (F12) and the Ctrl+K palette (part 2) are two more front-ends, kept here beside it: they
// send what the command line would.
import { builtinCommands, keywordShortcut } from '@triya/engine';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CommandPalette } from './CommandPalette';
import { completions, promptParts, type CommandLines } from './command-line';
import { DynamicInput } from './DynamicInput';
import { dynMode } from './dynamic-input';
import { DRAFTING_ITEMS, DRAFTING_KEYS, drafting, type DraftingToggle } from './drafting';
import { engines } from './engine/registry';
import { commandItems, type PaletteItem } from './palette';

/** The commands for completion: the same registry each drawing's engine runs. */
const registry = builtinCommands();

/** Lines of history the docked window shows above the prompt (AutoCAD's default is 3). */
const SHOWN_LINES = 2;

/** Elements that take typed text themselves: text fields, and anything in a dialog. */
function takesText(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.closest('input, textarea, select, dialog') !== null;
}

/**
 * Elements that take Enter and Space themselves (a button, a link, a tab, a `<summary>`):
 * anything focusable. On the page itself or the canvas they end the command line's input.
 */
function pressable(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    t !== document.body &&
    t !== document.documentElement &&
    t.tabIndex >= 0
  );
}

export function CommandLine({
  doc,
  lines,
  cursor,
  onSettings,
}: {
  /** The drawing shown, or undefined with none open. */
  doc: number | undefined;
  lines: CommandLines;
  /** The world point under the cursor, for direct distance entry. */
  cursor: () => { readonly x: number; readonly y: number } | undefined;
  /** Opens the Settings dialog (from the palette). */
  onSettings: () => void;
}) {
  useSyncExternalStore(lines.subscribe, lines.version);
  const state = doc === undefined ? undefined : lines.get(doc);
  const [text, setText] = useState('');
  const [recall, setRecall] = useState<number | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const prompt = state?.prompt;
  const suggestions = prompt === undefined ? completions(registry, text).slice(0, 8) : [];

  const send = (value: string) => {
    if (doc === undefined) return;
    const c = cursor();
    engines.command(doc, { kind: 'submit', text: value, ...(c && { cursor: c }) });
    lines.typed(doc, value);
    setText('');
    setRecall(undefined);
  };
  const cancel = () => {
    setText('');
    setRecall(undefined);
    // Sent whatever the mirror shows: it may not have heard yet of a command typed just before
    // (AutoCAD also answers Esc at `Command:` with `*Cancel*`).
    if (doc !== undefined) engines.command(doc, { kind: 'cancel' });
  };
  const answerKeyword = (keyword: string) => {
    if (doc !== undefined)
      engines.command(doc, { kind: 'answer', answer: { kind: 'keyword', keyword } });
  };
  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...commandItems(registry),
      { id: 'history', kind: 'action', label: 'Command history', aliases: [], keys: 'F2' },
      { id: 'dyn', kind: 'action', label: 'Dynamic Input on/off', aliases: [], keys: 'F12' },
      ...DRAFTING_ITEMS,
      { id: 'settings', kind: 'action', label: 'Settings', aliases: [] },
    ],
    [],
  );
  const runItem = (item: PaletteItem) => {
    if (item.kind === 'command') {
      if (doc !== undefined) engines.command(doc, { kind: 'invoke', name: item.id });
    } else if (item.id === 'history') setHistoryOpen(true);
    else if (item.id === 'dyn') dynMode.toggle();
    else if (item.id.startsWith('drafting:'))
      drafting.toggle(item.id.slice('drafting:'.length) as DraftingToggle);
    else onSettings();
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const selectAll = () => {
    if (doc !== undefined) engines.command(doc, { kind: 'select-all' });
  };
  const selectAllRef = useRef(selectAll);
  selectAllRef.current = selectAll;

  // Keys typed outside any field go to the command line, as in AutoCAD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setHistoryOpen((o) => !o);
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        dynMode.toggle();
        return;
      }
      // F3 OSNAP, F8 ORTHO, F9 SNAP, F10 POLAR (M2-04), wherever the focus is, as in AutoCAD.
      const aid = DRAFTING_KEYS[e.key];
      if (aid && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        drafting.toggle(aid);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        // Ctrl+A selects every object (M2-03, AutoCAD's SELECTALL), unless it would select
        // text typed in a field.
        const field = e.target instanceof HTMLInputElement ? e.target : undefined;
        if ((field && field.value !== '') || (!field && takesText(e.target))) return;
        e.preventDefault();
        return selectAllRef.current();
      }
      if (e.target === input.current || takesText(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'Escape') return cancelRef.current();
      if (e.key === 'Enter' || e.key === ' ') {
        if (pressable(e.target)) return;
        e.preventDefault();
        return sendRef.current('');
      }
      if (e.key.length === 1 && input.current) {
        e.preventDefault();
        input.current.focus();
        setText((t) => t + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (historyOpen && full.current) full.current.scrollTop = full.current.scrollHeight;
  }, [historyOpen, state?.lines]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const spaces = prompt?.kind === 'string' && prompt.spaces;
    if (e.key === 'Enter' || (e.key === ' ' && !spaces)) {
      e.preventDefault();
      send(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (historyOpen) setHistoryOpen(false);
      else cancel();
    } else if (e.key === 'Tab' && suggestions[0]) {
      e.preventDefault();
      setText(suggestions[0].name);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && state) {
      e.preventDefault();
      const recent = state.recent;
      if (recent.length === 0) return;
      const at =
        e.key === 'ArrowUp'
          ? Math.max(0, (recall ?? recent.length) - 1)
          : Math.min(recent.length, (recall ?? recent.length) + 1);
      setRecall(at);
      setText(recent[at] ?? '');
    }
  };

  const parts = promptParts(state?.promptText ?? 'Command:', prompt?.options);
  const shown = state?.lines.slice(-SHOWN_LINES) ?? [];
  return (
    <section className="command-line" aria-label="Command line">
      {doc !== undefined && (
        <DynamicInput
          prompt={prompt}
          message={prompt?.message ?? ''}
          cursor={cursor}
          onSubmit={send}
          onKeyword={answerKeyword}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onRun={runItem}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {historyOpen && (
        <div className="command-history-window" role="dialog" aria-label="Command history">
          <div className="command-history-header">
            <span>Command history</span>
            <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history">
              ×
            </button>
          </div>
          <div className="command-history-full" ref={full} role="log" tabIndex={0}>
            {state?.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}
      <div className="command-lines" role="log" aria-label="Recent command lines">
        {shown.map((l, i) => (
          <div key={state!.lines.length - shown.length + i}>{l}</div>
        ))}
      </div>
      <div className="command-input-row">
        <label htmlFor="command-input" className="command-prompt" data-testid="command-prompt">
          {parts.before}
          {parts.options.length > 0 && (
            <>
              {' ['}
              {parts.options.map((o, i) => (
                <span key={o}>
                  {i > 0 && '/'}
                  <button
                    type="button"
                    className="command-option"
                    title={`${o} (${keywordShortcut(o)})`}
                    onClick={() => {
                      answerKeyword(o);
                      input.current?.focus();
                    }}
                  >
                    {o}
                  </button>
                </span>
              ))}
              {']'}
            </>
          )}
          {parts.after && (parts.after.startsWith(':') ? parts.after : ` ${parts.after}`)}
        </label>
        <input
          id="command-input"
          ref={input}
          className="command-input"
          aria-label="Command"
          autoComplete="off"
          spellCheck={false}
          disabled={doc === undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRecall(undefined);
          }}
          onKeyDown={onKeyDown}
        />
        {suggestions.length > 0 && (
          <ul className="command-suggestions" role="listbox" aria-label="Matching commands">
            {suggestions.map((s) => (
              <li
                key={s.name}
                role="option"
                aria-selected={false}
                onPointerDown={(e) => {
                  e.preventDefault();
                  send(s.name);
                }}
              >
                {s.name}
                {s.alias && <span className="alias"> ({s.alias})</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
