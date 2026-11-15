// Dynamic Input (M2-02 part 2, UI_SPEC.md §5): the prompt and its input fields beside the cursor
// while a command waits and the cursor is over a drawing (dynamic-input.ts has the rules). Keys
// typed outside a text field come here rather than to the command line then; Enter sends the
// fields as the command line's text. The tooltip follows the cursor by its style alone, and the
// fields show the cursor's values by their text alone, so moving the cursor renders nothing in
// React (.claude/rules/ui.md). The Drafting Settings dialog's Dynamic Input tab (M3-06 part 4)
// says which fields show and whether the prompt does (`DynSettings`); with neither, the tooltip
// stays hidden and keys go to the command line.
import { keywordShortcut, type Prompt, type Vec2 } from '@triya/engine';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cycleLasso, cycleOverlap, cycleSnap } from './canvas/registry';
import { drafting } from './drafting';
import { overrideKey } from './shortcuts';
import {
  dynAhead,
  dynBackspace,
  dynCurrent,
  dynEnds,
  dynFor,
  dynLive,
  dynMode,
  dynRelativeTo,
  dynReplay,
  dynSettings,
  dynShows,
  dynTab,
  dynText,
  dynType,
  type DynState,
  type DynUnits,
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
  units,
  message,
  cursor,
  onSubmit,
  onKeyword,
  hold = () => false,
  ahead,
}: {
  /** The prompt the command waits at; undefined at `Command:`, where Dynamic Input shows nothing. */
  prompt: Prompt | undefined;
  /** The drawing's units and angle convention, which the fields show the cursor's values in. */
  units?: DynUnits | undefined;
  /** The prompt as the tooltip words it (without its options). */
  message: string;
  cursor: () => Vec2 | undefined;
  /** Sends the fields' text; `relativeTo`: what its `@` counts from (`dynRelativeTo`). */
  onSubmit: (text: string, relativeTo?: Vec2) => void;
  onKeyword: (keyword: string) => void;
  /**
   * Holds `key` for the prompt it reaches when it is typed ahead of it (M2-47 part 3, M2-71,
   * command-line.ts `holdsKey`); true when it was held. The command line keeps the held keys.
   */
  hold?: (key: string) => boolean;
  /**
   * Set to the function that replays held keys into the fields of the prompt they reach, which
   * the command line calls once that prompt is shown: it returns the keys left for the prompt
   * after the input they sent, or undefined when the tooltip does not take keys now.
   */
  ahead?: { current: ((keys: readonly string[]) => readonly string[] | undefined) | undefined };
}) {
  const on = useSyncExternalStore(dynMode.subscribe, dynMode.get);
  const aids = useSyncExternalStore(drafting.subscribe, drafting.get);
  const { dynBits, dynPrompt, dynPiCoords, dynPiFormat } = aids;
  // Rebuilt only when the tab's settings change, which starts the fields afresh.
  const o = useMemo(
    () => dynSettings({ dynBits, dynPrompt, dynPiCoords, dynPiFormat }),
    [dynBits, dynPrompt, dynPiCoords, dynPiFormat],
  );
  const [over, setOver] = useState(false);
  /**
   * Whether the cursor is over a drawing now. The keys read this rather than `over`: a key typed
   * right after the cursor leaves the drawing can come before React renders that, and would go
   * to a tooltip about to close (CI lost the 3 of a 350,-15 typed so).
   */
  const overNow = useRef(false);
  /**
   * The fields as last set and the prompt they were set for. Keys read this rather than the
   * rendered state: two keys, or a new prompt's fields and a key, can come before React renders,
   * and a key handled on the rendered state would undo the first (CI saw a Distance typed ahead
   * of its prompt land in the previous prompt's X field).
   */
  const latest = useRef<{ prompt: Prompt | undefined; state: DynState | undefined }>({
    prompt,
    state: prompt && dynFor(prompt, o),
  });
  const [state, setState] = useState<DynState | undefined>(latest.current.state);
  const put = (p: Prompt | undefined, next: DynState | undefined) => {
    latest.current = { prompt: p, state: next };
    setState(next);
  };
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<(HTMLSpanElement | null)[]>([]);
  const at = useRef({ x: 0, y: 0 });
  const shown = on && over && prompt !== undefined && state !== undefined && dynShows(state, o);

  /** Keys typed since the last Enter: replayed on a prompt that arrives after them. */
  const typed = useRef<string[]>([]);
  // A new prompt starts with empty fields, or with what was typed ahead of it.
  useEffect(() => put(prompt, prompt && dynReplay(prompt, typed.current, o)), [prompt, o]);

  const props = useRef({ prompt, units, state, shown, cursor, onSubmit, onKeyword, hold, o });
  props.current = { prompt, units, state, shown, cursor, onSubmit, onKeyword, hold, o };

  const place = () => {
    const el = box.current;
    if (el && props.current.state?.menu === undefined) {
      el.style.transform = `translate(${at.current.x + OFFSET}px, ${at.current.y + OFFSET}px)`;
    }
    const { prompt: p, state: s } = props.current;
    if (!p || !s) return;
    const values = dynLive(s, p, props.current.cursor(), props.current.units);
    values.forEach((v, i) => {
      const span = live.current[i];
      if (span) span.textContent = v;
    });
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      at.current = { x: e.clientX, y: e.clientY };
      overNow.current = overCanvas(e.target);
      setOver(overNow.current);
      place();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  useEffect(place);

  // Keys typed outside a text field, before the command line's own listener sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Spacebar while a lasso is dragged cycles its kind (M3-04 part 2), whatever has focus.
      if (e.key === ' ' && cycleLasso()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Shift+Space over overlapping objects steps through them (M3-04 part 7), not Enter.
      if (e.key === ' ' && e.shiftKey && !takesText(e.target) && cycleOverlap()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const { prompt: p, shown: visible, o: settings } = props.current;
      // Fields set for an earlier prompt are this prompt's as soon as it has arrived.
      const s = dynCurrent(latest.current, p, typed.current, settings);
      if (!visible || !overNow.current || !p || !s || takesText(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // A temporary override key with nothing typed (M3-06 part 5) is the command line's to hold.
      if (typed.current.length === 0 && drafting.get().tempOverrides && overrideKey(e)) return;
      if (props.current.hold(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const take = (next: DynState, key?: string) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Enter starts afresh; the ↓ menu (key '') leaves what was typed alone.
        if (key === undefined) typed.current = [];
        else if (key !== '') typed.current.push(key);
        put(p, next);
      };
      if (e.key === 'Escape') {
        // The command line's listener cancels the command.
        typed.current = [];
        put(p, dynFor(p, settings));
        return;
      }
      if (dynEnds(s, p, e.key)) {
        const options = p.options ?? [];
        if (s.menu !== undefined && options[s.menu]) {
          take(dynFor(p, settings));
          props.current.onKeyword(options[s.menu]!);
          return;
        }
        take(dynFor(p, settings));
        const text = dynText(s, p, props.current.cursor(), props.current.units);
        props.current.onSubmit(text, dynRelativeTo(text, p));
        return;
      }
      // Tab steps through the snap points under the cursor until something is typed (M2-04).
      if (e.key === 'Tab' && typed.current.length === 0 && !e.shiftKey && cycleSnap()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === 'Tab') return take(dynTab(s), 'Tab');
      if (e.key === 'Backspace') return take(dynBackspace(s, p, settings), 'Backspace');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && p.options?.length && settings.prompt) {
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

  // Keys held ahead of the prompt shown (M2-71) go into its fields when the tooltip would take
  // them typed now: on, over the drawing, at a prompt, with nothing typed at the command line.
  useEffect(() => {
    if (!ahead) return;
    ahead.current = (keys) => {
      const { prompt: p, o: settings } = props.current;
      const s = dynCurrent(latest.current, p, typed.current, settings);
      if (!dynMode.get() || !overNow.current || !p || !s || takesText(document.activeElement)) {
        return undefined;
      }
      if (!dynShows(s, settings)) return undefined;
      const r = dynAhead(s, p, keys, settings);
      // An Esc empties the fields, as typed (the command line cancels).
      if (!r.ends && r.rest[0] === 'Escape') {
        typed.current = [];
        put(p, dynFor(p, settings));
        return r.rest;
      }
      if (!r.ends) {
        typed.current = [...typed.current, ...r.typed];
        put(p, r.state);
        return r.rest;
      }
      typed.current = [];
      put(p, dynFor(p, settings));
      const { cursor: at, units: u } = props.current;
      const text = dynText(r.state, p, at(), u);
      props.current.onSubmit(text, dynRelativeTo(text, p));
      return r.rest;
    };
    return () => {
      ahead.current = undefined;
    };
  }, [ahead]);

  if (!shown) return null;
  const options = prompt.options ?? [];
  return (
    <div className="dyn-input" ref={box} role="status" aria-label="Dynamic Input" data-testid="dyn">
      {o.prompt && (
        <div className="dyn-prompt">
          {message}
          {options.length > 0 && (
            <span className="dyn-more" aria-hidden="true">
              {' '}
              ↓
            </span>
          )}
        </div>
      )}
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
          {options.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={i === state.menu}
              onPointerDown={(e) => {
                e.preventDefault();
                typed.current = [];
                put(prompt, dynFor(prompt, o));
                onKeyword(option);
              }}
            >
              {option}
              <span className="alias"> ({keywordShortcut(option)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
