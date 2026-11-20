// M6-03: the status bar's annotation scale controls on the Model tab, after MODEL as AutoCAD
// 2024's status bar has them (UI_SPEC.md §8): Annotation Visibility (ANNOALLVISIBLE, "Show
// annotation objects - Always" or "- At current scale"), AutoScale (ANNOAUTOSCALE's sign, "Add
// scales to annotative objects when the annotation scale changes") and the Annotation Scale
// button, which shows CANNOSCALE and opens the drawing's scale list (its ACAD_SCALELIST) with
// the current scale checked. A scale picked is set as CANNOSCALE typed at `Command:` is: one
// undo step, CANNOSCALEVALUE following, saved in the drawing's DICTIONARYVAR. In a layout the
// controls are not shown: a layout viewport's own annotation scale and the representation an
// object draws at are M1-63's, post-launch (PRD FR-A6, DEC-047).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drafting } from './drafting';
import { inLayout, type OpenDocument } from './documents';
import { engines } from './engine/registry';

/** Sets CANNOSCALE as typed at `Command:` (transparently while a command runs). */
function setAnnotationScale(doc: number, name: string): void {
  engines.command(doc, { kind: 'invoke', name: 'CANNOSCALE' });
  engines.command(doc, { kind: 'submit', text: name });
}

export function AnnotationScaleControls({
  doc,
  header,
}: {
  doc: OpenDocument;
  /** The drawing's header as its edits left it: CANNOSCALE set or undone shows at once. */
  header: ReadonlyMap<string, unknown>;
}) {
  const state = useSyncExternalStore(drafting.subscribe, drafting.get);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const scales = doc.opened.init.meta.annotationScales ?? [];
  // A drawing with no scale list (before AutoCAD 2008) has no annotation scale to show.
  if (inLayout(doc) || scales.length === 0) return null;
  const current = header.get('CANNOSCALE');
  const name = typeof current === 'string' ? current : '1:1';
  return (
    <span className="status-group">
      <button
        type="button"
        className="status-toggle"
        aria-pressed={state.annoAllVisible}
        title={`Show annotation objects - ${state.annoAllVisible ? 'Always' : 'At current scale'}`}
        aria-label="Annotation Visibility"
        onClick={() => drafting.toggle('annoVisible')}
      >
        AV
      </button>
      <button
        type="button"
        className="status-toggle"
        aria-pressed={state.annoAutoScale > 0}
        title="Add scales to annotative objects when the annotation scale changes"
        aria-label="AutoScale"
        onClick={() => drafting.toggle('annoAutoScale')}
      >
        AS
      </button>
      <button
        type="button"
        className="status-toggle annotation-scale"
        title="Annotation Scale of the current view"
        aria-label="Annotation Scale"
        aria-haspopup="menu"
        aria-expanded={menu}
        data-testid="annotation-scale"
        onClick={() => setMenu((m) => !m)}
      >
        {name} ▴
      </button>
      {menu && (
        <ScaleMenu
          scales={scales.map((s) => s.name)}
          current={name}
          onPick={(s) => {
            close();
            if (s !== name) setAnnotationScale(doc.id, s);
          }}
          onClose={close}
        />
      )}
    </span>
  );
}

/** The drawing's annotation scales, the current one checked; Esc or a click elsewhere closes it. */
function ScaleMenu({
  scales,
  current,
  onPick,
  onClose,
}: {
  scales: readonly string[];
  current: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const checked = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="osnap-menu annotation-scale-menu"
      role="menu"
      aria-label="Annotation scales"
      onKeyDown={(e) => {
        const list = [
          ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
        ];
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {scales.map((s) => (
        <button
          key={s}
          type="button"
          role="menuitemradio"
          aria-checked={s === current}
          className="osnap-menu-item"
          onClick={() => onPick(s)}
        >
          <span className="osnap-check" aria-hidden="true">
            {s === current ? '✓' : ''}
          </span>
          {s}
        </button>
      ))}
    </div>
  );
}
