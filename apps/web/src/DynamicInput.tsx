// Dynamic Input (M2-02 part 2, UI_SPEC.md §5): the prompt and its input fields beside the cursor
// while a command waits and the cursor is over a drawing (dynamic-input.ts has the rules). Keys
// typed outside a text field come here rather than to the command line then; Enter sends the
// fields as the command line's text. The tooltip follows the cursor by its style alone, and the
// fields show the cursor's values by their text alone, so moving the cursor renders nothing in
// React (.claude/rules/ui.md).
import { keywordShortcut, type Prompt, type Vec2 } from '@triya/engine';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cycleSnap } from './canvas/registry';
import {
  dynBackspace,
  dynFor,
  dynLive,
  dynMode,
  dynReplay,
  dynTab,
  dynText,
  dynType,
  type DynState,
} from './dynamic-input';

/** The tooltip sits this far right of and below the cursor, clear of the crosshairs. */
const OFFSET = 18;

const overCanvas = (t: EventTarget | null) =>
  t instanceof Element && t.closest('.drawing-canvas') !== null;

/**
 * Elements that take typed text themselves. The command line's field counts only once something
 * is typed in it: with the cursor in the drawing, what is typed next goes to the cursor, as in
 * AutoCAD, though the field kept the focus from the command name typed before.
 */
const takesText = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !(t instanceof HTMLInputElement && t.id === 'command-input' && t.value === '') &&
  (t.isContentEditable || t.closest('input, textarea, select, dialog') !== null);

export function DynamicInput({
  prompt,
  message,
  cursor,
  onSubmit,
  onKeyword,
}: {
  /** The prompt the command waits at; undefined at `Command:`, where Dynamic Input shows nothing. */
  prompt: Prompt | undefined;
  /** The prompt as the tooltip words it (without its options). */
  message: string;
  cursor: () => Vec2 | undefined;
  onSubmit: (text: string) => void;
  onKeyword: (keyword: string) => void;
}) {
  const on = useSyncExternalStore(dynMode.subscribe, dynMode.get);
  const [over, setOver] = useState(false);
  const [state, setState] = useState<DynState | undefined>(prompt && dynFor(prompt));
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<(HTMLSpanElement | null)[]>([]);
  const at = useRef({ x: 0, y: 0 });
  const shown = on && over && prompt !== undefined && state !== undefined;

  /** Keys typed since the last Enter: replayed on a prompt that arrives after them. */
  const typed = useRef<string[]>([]);
  // A new prompt starts with empty fields, or with what was typed ahead of it.
  useEffect(() => setState(prompt && dynReplay(prompt, typed.current)), [prompt]);

  const props = useRef({ prompt, state, shown, cursor, onSubmit, onKeyword });
  props.current = { prompt, state, shown, cursor, onSubmit, onKeyword };

  const place = () => {
    const el = box.current;
    if (el && props.current.state?.menu === undefined) {
      el.style.transform = `translate(${at.current.x + OFFSET}px, ${at.current.y + OFFSET}px)`;
    }
    const { prompt: p, state: s } = props.current;
    if (!p || !s) return;
    const values = dynLive(s, p, props.current.cursor());
    values.forEach((v, i) => {
      const span = live.current[i];
      if (span) span.textContent = v;
    });
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      at.current = { x: e.clientX, y: e.clientY };
      setOver(overCanvas(e.target));
      place();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  useEffect(place);

  // Keys typed outside a text field, before the command line's own listener sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { prompt: p, state: s, shown: visible } = props.current;
      if (!visible || !p || !s || takesText(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const take = (next: DynState, key?: string) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Enter starts afresh; the ↓ menu (key '') leaves what was typed alone.
        if (key === undefined) typed.current = [];
        else if (key !== '') typed.current.push(key);
        setState(next);
      };
      const spaces = p.kind === 'string' && p.spaces && s.raw;
      if (e.key === 'Escape') {
        // The command line's listener cancels the command.
        typed.current = [];
        setState(dynFor(p));
        return;
      }
      if (e.key === 'Enter' || (e.key === ' ' && !spaces)) {
        const options = p.options ?? [];
        if (s.menu !== undefined && options[s.menu]) {
          take(dynFor(p));
          props.current.onKeyword(options[s.menu]!);
          return;
        }
        take(dynFor(p));
        props.current.onSubmit(dynText(s, p, props.current.cursor()));
        return;
      }
      // Tab steps through the snap points under the cursor until something is typed (M2-04).
      if (e.key === 'Tab' && typed.current.length === 0 && !e.shiftKey && cycleSnap()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === 'Tab') return take(dynTab(s), 'Tab');
      if (e.key === 'Backspace') return take(dynBackspace(s, p), 'Backspace');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && p.options?.length) {
        const n = p.options.length;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        return take(
          {
            ...s,
            menu: s.menu === undefined ? (step > 0 ? 0 : n - 1) : (s.menu + step + n) % n,
          },
          '',
        );
      }
      if (e.key.length === 1) return take(dynType(s, e.key), e.key);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  if (!shown) return null;
  const options = prompt.options ?? [];
  return (
    <div className="dyn-input" ref={box} role="status" aria-label="Dynamic Input" data-testid="dyn">
      <div className="dyn-prompt">
        {message}
        {options.length > 0 && (
          <span className="dyn-more" aria-hidden="true">
            {' '}
            ↓
          </span>
        )}
      </div>
      <div className="dyn-fields">
        {state.fields.map((f, i) => (
          <span
            key={`${state.kind}${i}`}
            className="dyn-field"
            data-active={i === state.active}
            data-locked={f.locked}
            aria-label={f.label || 'Value'}
          >
            {f.text !== '' ? (
              <span className="dyn-typed">{f.text}</span>
            ) : (
              <span
                className="dyn-live"
                ref={(el) => {
                  live.current[i] = el;
                }}
              />
            )}
            {f.locked && <span className="dyn-lock" aria-label="locked" />}
          </span>
        ))}
      </div>
      {state.menu !== undefined && (
        <ul className="dyn-menu" role="listbox" aria-label="Options">
          {options.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === state.menu}
              onPointerDown={(e) => {
                e.preventDefault();
                typed.current = [];
                setState(dynFor(prompt));
                onKeyword(o);
              }}
            >
              {o}
              <span className="alias"> ({keywordShortcut(o)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
