// The command line (M2-02, UI_SPEC.md §5): AutoCAD's docked command window under the layout
// tabs. The last history lines above the prompt line; the prompt's options as chips; commands
// completed as they are typed; Up/Down recall; F2 opens the whole history. Typing anywhere
// outside a text field goes to it, and Enter or Space there ends the input, as in AutoCAD. It
// is a front-end of the drawing's command engine, which runs in the engine worker.
import { builtinCommands, keywordShortcut } from '@triya/engine';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { completions, promptParts, type CommandLines } from './command-line';
import { engines } from './engine/registry';

/** The commands for completion: the same registry each drawing's engine runs. */
const registry = builtinCommands();

/** Lines of history the docked window shows above the prompt (AutoCAD's default is 3). */
const SHOWN_LINES = 2;

/** Elements that take typed text themselves: text fields, and anything in a dialog. */
function takesText(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.closest('input, textarea, select, dialog') !== null;
}

/** Elements that Enter and Space press (a button, a link, a tab) rather than end the input. */
function pressable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && t.closest('button, a, [role="tab"]') !== null;
}

export function CommandLine({
  doc,
  lines,
  cursor,
}: {
  /** The drawing shown, or undefined with none open. */
  doc: number | undefined;
  lines: CommandLines;
  /** The world point under the cursor, for direct distance entry. */
  cursor: () => { readonly x: number; readonly y: number } | undefined;
}) {
  useSyncExternalStore(lines.subscribe, lines.version);
  const state = doc === undefined ? undefined : lines.get(doc);
  const [text, setText] = useState('');
  const [recall, setRecall] = useState<number | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
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
    if (doc !== undefined && lines.get(doc).prompt) engines.command(doc, { kind: 'cancel' });
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // Keys typed outside any field go to the command line, as in AutoCAD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setHistoryOpen((o) => !o);
        return;
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
                      if (doc === undefined) return;
                      engines.command(doc, {
                        kind: 'answer',
                        answer: { kind: 'keyword', keyword: o },
                      });
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
