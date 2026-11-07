// The document (file) tabs in the title bar (UI_SPEC.md §1, M1-22): a tab per open drawing
// with its close button, as AutoCAD's file tabs. Part 5 adds what AutoCAD's tabs also do:
// dragging a tab moves it along the row, and resting the pointer on a tab shows a preview of
// the drawing's Model and layouts, each picked with a click.
//
// The drag uses pointer events, not HTML drag and drop, which the window already takes for
// dropped files. Pointer capture starts only once the pointer has moved, so a plain click
// still reaches the tab's button.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { controllerOf } from './canvas/registry';
import { spacesOf, type DocumentStore, type DocumentsState, type OpenDocument } from './documents';
import { engines } from './engine/registry';

/** How far the pointer moves before a press on a tab becomes a drag (CSS pixels). */
const DRAG_START = 5;
/** How long the pointer rests on a tab before its preview shows, and lingers after it leaves. */
const PREVIEW_DELAY = 400;
const PREVIEW_LINGER = 250;
/** The largest thumbnail, CSS pixels. */
const THUMB = { width: 160, height: 110 } as const;

interface Drag {
  readonly id: number;
  readonly pointer: number;
  readonly x: number;
  moved: boolean;
}

interface Preview {
  readonly id: number;
  /** Where the preview hangs: the tab's lower left corner, in viewport pixels. */
  readonly left: number;
  readonly top: number;
}

export function DocTabs({ store, state }: { store: DocumentStore; state: DocumentsState }) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragged, setDragged] = useState<number | undefined>();
  const [preview, setPreview] = useState<Preview | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(f, ms);
  };
  const keep = () => clearTimeout(timer.current);
  const hide = () => {
    clearTimeout(timer.current);
    setPreview(undefined);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // A closed drawing takes its preview with it.
  const previewed = preview && state.docs.find((d) => d.id === preview.id);
  useEffect(() => {
    if (preview && !previewed) setPreview(undefined);
  }, [preview, previewed]);

  const rest = (id: number, e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || drag.current) return;
    const tab = e.currentTarget.getBoundingClientRect();
    later(() => setPreview({ id, left: tab.left, top: tab.bottom }), PREVIEW_DELAY);
  };

  const down = (id: number, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = { id, pointer: e.pointerId, x: e.clientX, moved: false };
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < DRAG_START) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      hide();
      setDragged(d.id);
      // The tab being dragged is the one that shows, as in a browser's tab strip.
      store.activate(d.id);
    }
    // The dragged tab goes before the first other tab whose middle is right of the pointer.
    const others = [...(row.current?.querySelectorAll<HTMLElement>('.doc-tab') ?? [])].filter(
      (t) => t.dataset['id'] !== String(d.id),
    );
    const to = others.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    store.move(d.id, to);
  };

  const up = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = undefined;
    setDragged(undefined);
  };

  // Ctrl+Shift+Page Up / Page Down moves the focused tab, for the keyboard (UI_SPEC.md §8).
  const key = (doc: OpenDocument, e: ReactKeyboardEvent) => {
    if (!e.ctrlKey || !e.shiftKey || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
    e.preventDefault();
    const at = state.docs.findIndex((d) => d.id === doc.id);
    store.move(doc.id, at + (e.key === 'PageUp' ? -1 : 1));
  };

  return (
    <>
      <div ref={row} className="doc-tabs" role="tablist" aria-label="Open drawings">
        {state.docs.map((d) => (
          <div
            key={d.id}
            className="doc-tab"
            data-id={d.id}
            data-active={d.id === state.active}
            data-dragging={d.id === dragged}
            onPointerEnter={(e) => rest(d.id, e)}
            onPointerLeave={() => {
              if (!drag.current) later(() => setPreview(undefined), PREVIEW_LINGER);
            }}
            onPointerDown={(e) => down(d.id, e)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <button
              type="button"
              role="tab"
              aria-selected={d.id === state.active}
              aria-controls={`doc-${d.id}`}
              aria-keyshortcuts="Control+Shift+PageUp Control+Shift+PageDown"
              onClick={() => store.activate(d.id)}
              onKeyDown={(e) => key(d, e)}
              onFocus={hide}
            >
              {d.name}
            </button>
            <button
              type="button"
              className="close"
              aria-label={`Close ${d.name}`}
              onClick={() => {
                store.close(d.id);
                engines.stop(d.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {preview && previewed && (
        <TabPreview
          doc={previewed}
          left={preview.left}
          top={preview.top}
          onEnter={keep}
          onLeave={() => later(() => setPreview(undefined), PREVIEW_LINGER)}
          onPick={(block) => {
            hide();
            store.activate(previewed.id);
            store.showSpace(previewed.id, block);
          }}
        />
      )}
    </>
  );
}

/**
 * AutoCAD's file tab preview: a thumbnail per space, Model first, then the layouts in tab
 * order. A space shows as it was last drawn; one not yet opened in this session has no
 * picture yet (its canvas is made the first time it shows).
 */
function TabPreview({
  doc,
  left,
  top,
  onEnter,
  onLeave,
  onPick,
}: {
  doc: OpenDocument;
  left: number;
  top: number;
  onEnter: () => void;
  onLeave: () => void;
  onPick: (block: string) => void;
}) {
  const spaces = spacesOf(doc);
  const [pictures, setPictures] = useState<ReadonlyMap<string, ImageBitmap>>(new Map());
  const box = useRef<HTMLDivElement>(null);
  // A tab near the right edge: the preview moves left so it stays in the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    el.style.left = `${Math.max(8, Math.min(left, innerWidth - 8 - width))}px`;
  }, [left, pictures]);
  useEffect(() => {
    let live = true;
    const taken = new Map<string, ImageBitmap>();
    void Promise.all(
      spaces.map(async (s) => {
        const bitmap = await controllerOf(doc.id, s.block)
          ?.thumbnail(THUMB)
          .catch(() => undefined);
        if (bitmap) taken.set(s.block, bitmap);
      }),
    ).then(() => {
      if (live) setPictures(taken);
      else for (const b of taken.values()) b.close();
    });
    return () => {
      live = false;
    };
    // Taken once per preview: the drawing doesn't change while the pointer rests on its tab.
  }, [doc.id]);

  return (
    <div
      ref={box}
      className="tab-preview"
      role="group"
      aria-label={`${doc.name} preview`}
      style={{ left, top }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {spaces.map((s) => (
        <button
          key={s.block}
          type="button"
          className="tab-preview-space"
          aria-current={s.block === doc.block}
          onClick={() => onPick(s.block)}
        >
          <Thumbnail bitmap={pictures.get(s.block)} paper={s.block !== doc.opened.modelSpace} />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );
}

/** A thumbnail bitmap on a `bitmaprenderer` canvas (no 2D drawing outside the renderer). */
function Thumbnail({ bitmap, paper }: { bitmap: ImageBitmap | undefined; paper: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    // A bitmap can be handed over once; a closed one measures 0.
    if (!c || !bitmap || bitmap.width === 0) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    // The bitmap is in device pixels; it shows at its CSS size.
    c.style.width = `${bitmap.width / devicePixelRatio}px`;
    c.style.height = `${bitmap.height / devicePixelRatio}px`;
    c.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
    c.dataset['drawn'] = 'true';
  }, [bitmap]);
  return (
    <canvas
      ref={canvas}
      className={paper ? 'thumbnail paper' : 'thumbnail'}
      width={THUMB.width}
      height={THUMB.height}
      aria-hidden="true"
    />
  );
}
