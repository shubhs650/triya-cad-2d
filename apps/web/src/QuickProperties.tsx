// The Quick Properties palette (M2-35 part 16, UI_SPEC.md §4; AutoCAD 2024 Help, "Quick
// Properties Palette"): while QPMODE is on, the objects picked at `Command:` show a short list
// of their properties by the cursor (`quick-properties.ts` places it), collapsed to three rows
// until the pointer or the focus is in it. Its object list narrows it to one type, and an edit is
// the Properties palette's (one undo step). It does not show while a command runs or while the
// Properties palette is open; its close button hides it until the selection changes. Static
// (QPLOCATION 1), its title bar drags it to where it then stays.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { EntityId, EntityType } from '@triya/engine';
import { commandLines } from './command-line';
import { drafting } from './drafting';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { PropertySections } from './PropertiesPalette';
import { propertySheets } from './properties';
import { quickPlacement, quickShown, type Placement } from './quick-properties';

/** Where the last pick on a drawing was made, from the drawing area's top left. */
let lastPick: { x: number; y: number } | undefined;
/** Where the drafter dragged the static palette this session. */
let dragged: Placement | undefined;

export function QuickProperties({
  doc,
  selected,
  patternNames = [],
}: {
  doc: OpenDocument;
  /** The drawing's selected objects, which a new placement follows. */
  selected: () => readonly EntityId[];
  patternNames?: readonly string[];
}) {
  const state = useSyncExternalStore(drafting.subscribe, drafting.get);
  const sheet = useSyncExternalStore(propertySheets.subscribe, () => propertySheets.get(doc.id));
  const idle = useSyncExternalStore(commandLines.subscribe, () => {
    const line = commandLines.get(doc.id);
    return line.prompt === undefined && line.promptText === 'Command:';
  });
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ key: string; at: Placement } | undefined>();
  const [closed, setClosed] = useState<string | undefined>();

  useEffect(() => {
    // The engine sends Quick Properties' sheets while it is on.
    engines.command(doc.id, { kind: 'properties', open: true, quick: true });
    return () => engines.command(doc.id, { kind: 'properties', open: false });
  }, [doc.id]);

  useEffect(() => {
    // The pick's place: the end of a click or of a selection window, over a drawing.
    const area = () => ref.current?.parentElement ?? document.querySelector('.canvas-area');
    const onPointer = (e: PointerEvent) => {
      const el = area();
      if (!el || !(e.target instanceof Element) || !e.target.closest('canvas')) return;
      const r = el.getBoundingClientRect();
      lastPick = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    window.addEventListener('pointerup', onPointer, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('pointerup', onPointer, { capture: true });
    };
  }, []);

  const key = selected().join(',');
  const shown = idle && closed !== key && quickShown(sheet, state.qpmode);

  useEffect(() => {
    // Nothing selected: the next selection shows it again, placed anew, even the same objects.
    if (key !== '') return;
    setClosed(undefined);
    setPlaced(undefined);
  }, [key]);

  useLayoutEffect(() => {
    // A new selection places it again; edits and a narrowed list keep it where it is.
    const el = ref.current;
    const area = el?.parentElement;
    if (!shown || !el || !area || placed?.key === key) return;
    const at = quickPlacement({
      location: state.qpLocation,
      pointer: lastPick,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      area: { width: area.clientWidth, height: area.clientHeight },
      dragged,
    });
    setPlaced({ key, at });
  }, [shown, key, placed?.key, state.qpLocation]);

  if (!shown || !sheet) return null;
  const set = (k: string, value: string) =>
    engines.command(doc.id, { kind: 'property', edit: { key: k, value } });
  const narrow = (type: string) =>
    engines.command(doc.id, {
      kind: 'properties',
      open: true,
      quick: true,
      filter: type === '' ? null : (type as EntityType),
    });

  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    const area = el?.parentElement;
    if (state.qpLocation !== 1 || !el || !area || !placed || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    // A drag moves the palette; it selects none of its title.
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY, at: placed.at };
    const move = (m: PointerEvent) => {
      const at = quickPlacement({
        location: 1,
        pointer: undefined,
        size: { width: el.offsetWidth, height: el.offsetHeight },
        area: { width: area.clientWidth, height: area.clientHeight },
        dragged: { left: from.at.left + m.clientX - from.x, top: from.at.top + m.clientY - from.y },
      });
      dragged = at;
      setPlaced({ key, at });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={ref}
      className="quick-properties"
      role="dialog"
      aria-label="Quick Properties"
      data-location={state.qpLocation === 1 ? 'static' : 'cursor'}
      style={{
        left: placed?.at.left ?? 0,
        top: placed?.at.top ?? 0,
        // Measured where it is first drawn, then shown where it goes.
        visibility: placed?.key === key ? 'visible' : 'hidden',
      }}
    >
      <header onPointerDown={startDrag}>
        <h2>Quick Properties</h2>
        <button type="button" aria-label="Close Quick Properties" onClick={() => setClosed(key)}>
          ×
        </button>
      </header>
      <PropertySections
        sheet={sheet}
        narrow={narrow}
        set={set}
        openEditor={() => engines.command(doc.id, { kind: 'property-editor', key: 'contents' })}
        stepVertex={() => {}}
        markVertex={() => {}}
        patternNames={patternNames}
        quick
      />
    </div>
  );
}
