// The command line (M2-02, UI_SPEC.md §5): AutoCAD's docked command window under the layout
// tabs. The last history lines above the prompt line; the prompt's options as chips; commands
// completed as they are typed; Up/Down recall; F2 opens the whole history. Typing anywhere
// outside a text field goes to it, and Enter or Space there ends the input, as in AutoCAD. It
// is a front-end of the drawing's command engine, which runs in the engine worker. Dynamic
// Input (F12) and the Ctrl+K palette (part 2) are two more front-ends, kept here beside it: they
// send what the command line would.
import { keywordShortcut, type Vec2 } from '@triya/engine';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CommandPalette } from './CommandPalette';
import {
  clipboardCommand,
  completions,
  holdsKey,
  promptParts,
  reading,
  replayAhead,
  type CommandLines,
} from './command-line';
import { undoKeyCommand } from './undo';
import { DynamicInput } from './DynamicInput';
import { dynMode } from './dynamic-input';
import { DRAFTING_ITEMS, DRAFTING_KEYS, drafting, type DraftingToggle } from './drafting';
import { cycleSnap } from './canvas/registry';
import { engines } from './engine/registry';
import { commandItems, type PaletteItem } from './palette';
import { aliasFileVersion, appRegistry as registry } from './user-aliases';

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
  variables = [],
  lines,
  cursor,
  onSettings,
  recent = [],
  onOpenRecent,
  onEditAliases,
}: {
  /** The drawing shown, or undefined with none open. */
  doc: number | undefined;
  /** The drawing's system variables, which autocomplete lists after the commands (M2-59). */
  variables?: readonly string[];
  lines: CommandLines;
  /** The world point under the cursor, for direct distance entry. */
  cursor: () => { readonly x: number; readonly y: number } | undefined;
  /** Opens the Settings dialog (from the palette). */
  onSettings: () => void;
  /** Opens the Edit Aliases dialog (from the palette, M3-10). */
  onEditAliases?: () => void;
  /** The recent drawings the palette lists (M2-14, UI_SPEC §5), newest first. */
  recent?: readonly { readonly key: string; readonly name: string }[];
  /** Opens a recent drawing by its key. */
  onOpenRecent?: (key: string) => void;
}) {
  useSyncExternalStore(lines.subscribe, lines.version);
  // The user alias file changes completion and the palette's aliases (M3-10).
  const aliasVersion = useSyncExternalStore(aliasFileVersion.subscribe, aliasFileVersion.get);
  const state = doc === undefined ? undefined : lines.get(doc);
  const [text, setText] = useState('');
  const [recall, setRecall] = useState<number | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const prompt = state?.prompt;
  const suggestions =
    prompt === undefined ? completions(registry, text, variables).slice(0, 8) : [];

  /** Keys typed ahead of the prompt that reads them (M2-47 part 3, M2-71, `holdsKey`). */
  const held = useRef<string[]>([]);
  /** Dynamic Input's replay of held keys into its fields (M2-71). */
  const dynAhead = useRef<((keys: readonly string[]) => readonly string[] | undefined) | undefined>(
    undefined,
  );
  const textRef = useRef(text);
  textRef.current = text;

  /** Sends typed input; `relativeTo`: what its `@` counts from, for Dynamic Input (M2-71). */
  const send = (value: string, relativeTo?: Vec2) => {
    if (doc === undefined) return;
    const c = cursor();
    const seq = lines.send(doc);
    engines.command(doc, {
      kind: 'submit',
      text: value,
      seq,
      ...(c && { cursor: c }),
      ...(relativeTo && { relativeTo }),
    });
    lines.typed(doc, value);
    setText('');
    setRecall(undefined);
  };
  /** Esc: drops the keys held, unless it was itself held behind them (`after`, M2-71). */
  const cancel = (after: readonly string[] = []) => {
    held.current = [...after];
    setText('');
    setRecall(undefined);
    // Sent whatever the mirror shows: it may not have heard yet of a command typed just before
    // (AutoCAD also answers Esc at `Command:` with `*Cancel*`). Numbered like typed input, so
    // keys typed after it wait for the prompt it leads to.
    if (doc !== undefined) engines.command(doc, { kind: 'cancel', seq: lines.send(doc) });
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
      {
        id: 'settings',
        kind: 'action',
        label: 'Settings',
        // AutoCAD's OPTIONS, and what Settings holds (M2-20).
        aliases: ['Options', 'Theme', 'Canvas colors', 'Clear all local data'],
      },
      {
        id: 'aliases',
        kind: 'action',
        label: 'Edit Aliases',
        // AutoCAD's Edit Aliases (Manage tab), which opens acad.pgp (M3-10).
        aliases: ['acad.pgp', 'Command aliases', 'ALIASEDIT'],
      },
      ...recent.map((r): PaletteItem => ({
        id: `recent:${r.key}`,
        kind: 'action',
        label: `Open recent: ${r.name}`,
        aliases: [],
      })),
    ],
    // The registry's aliases change with aliasVersion.
    [recent, aliasVersion],
  );
  const runItem = (item: PaletteItem) => {
    if (item.kind === 'command') {
      if (doc !== undefined) engines.command(doc, { kind: 'invoke', name: item.id });
    } else if (item.id === 'history') setHistoryOpen(true);
    else if (item.id === 'dyn') dynMode.toggle();
    else if (item.id === 'aliases') onEditAliases?.();
    else if (item.id.startsWith('recent:')) onOpenRecent?.(item.id.slice('recent:'.length));
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
  const invoke = (name: string) => {
    if (doc !== undefined) engines.command(doc, { kind: 'invoke', name });
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  /** Holds `key` when it waits for the prompt it reaches; true when it was held. */
  const hold = (key: string): boolean => {
    if (doc === undefined || !holdsKey(lines.get(doc), held.current, key)) return false;
    held.current.push(key);
    return true;
  };
  const holdRef = useRef(hold);
  holdRef.current = hold;

  // Keys held for a prompt not shown yet are replayed once the engine has read every input
  // sent: on the prompt they reach, until one ends the input and the rest wait again. Dynamic
  // Input takes them into its fields when it shows that prompt (M2-71); the command line else.
  useEffect(() => {
    if (doc === undefined || held.current.length === 0) return;
    const now = lines.get(doc);
    if (reading(now)) return;
    let rest = dynAhead.current?.(held.current);
    if (rest === undefined) {
      const r = replayAhead(textRef.current, held.current, now.prompt);
      rest = r.keys;
      if (r.submit !== undefined) send(r.submit);
      else {
        setText(r.text);
        // The field shows it at once: the next key, no longer held, is typed into the field
        // before React renders the text, and would otherwise replace it (CI lost `REVCLOUDG`
        // of a REVCLOUDGRIPS typed across the engine's answer).
        textRef.current = r.text;
        if (input.current) input.current.value = r.text;
      }
    }
    held.current = [...rest];
    // An Esc the replay reached with no input sent before it cancels now; the keys after it
    // wait for the prompt the cancel leads to.
    if (!reading(lines.get(doc)) && held.current[0] === 'Escape') cancel(held.current.slice(1));
  });
  // Another drawing shown starts with nothing held.
  useEffect(() => {
    held.current = [];
  }, [doc]);

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
      // The Clipboard keys (M2-14 part 2) copy and paste objects, and Ctrl+Z and Ctrl+Y run U
      // and REDO (M2-23), unless they would copy, paste or undo text: anywhere text is typed
      // but an empty command line. Like a ribbon button, each cancels a running command first.
      const clip = clipboardCommand(e) ?? undoKeyCommand(e);
      if (clip) {
        const field = e.target instanceof HTMLInputElement ? e.target : undefined;
        const typing =
          field === input.current
            ? field?.value !== ''
            : field !== undefined || takesText(e.target);
        if (typing) return;
        e.preventDefault();
        return invokeRef.current(clip);
      }
      // Tab with nothing typed steps AutoSnap through the snap points under the cursor (M2-04).
      const empty = e.target === input.current ? input.current?.value === '' : !takesText(e.target);
      if (e.key === 'Tab' && !e.shiftKey && empty && !e.defaultPrevented && cycleSnap()) {
        e.preventDefault();
        return;
      }
      if (e.target === input.current || takesText(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (holdRef.current(e.key)) e.preventDefault();
        else cancelRef.current();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && pressable(e.target)) return;
      if (holdRef.current(e.key)) {
        e.preventDefault();
        input.current?.focus();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
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
    if (
      !(e.key === 'Escape' && historyOpen) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      hold(e.key)
    ) {
      e.preventDefault();
    } else if (e.key === 'Enter' || (e.key === ' ' && !spaces)) {
      e.preventDefault();
      // What the field shows, which may be ahead of `text`: keys typed ahead and replayed into
      // it (M2-71) are there before React renders them.
      send(e.currentTarget.value);
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

  const parts = state?.lasso
    ? promptParts(state.lasso, undefined)
    : promptParts(state?.promptText ?? 'Command:', prompt?.options);
  const shown = state?.lines.slice(-SHOWN_LINES) ?? [];
  return (
    <section
      className="command-line"
      aria-label="Command line"
      // While the engine has not read every input sent, the prompt shown is the one before them
      // (M2-47 part 3); tests wait for this to clear before a key that acts on the new prompt.
      data-reading={state && reading(state) ? 'true' : undefined}
    >
      {doc !== undefined && (
        <DynamicInput
          prompt={prompt}
          units={state?.units}
          message={prompt?.message ?? ''}
          cursor={cursor}
          onSubmit={send}
          onKeyword={answerKeyword}
          hold={hold}
          ahead={dynAhead}
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
          <ul
            className="command-suggestions"
            role="listbox"
            aria-label="Matching commands and system variables"
          >
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
                {s.variable && <span className="alias"> system variable</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
