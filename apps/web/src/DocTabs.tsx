// The document (file) tabs in the title bar (UI_SPEC.md §1, M1-22): a tab per open drawing
// with its close button, as AutoCAD's file tabs. Part 5 adds what AutoCAD's tabs also do:
// dragging a tab moves it along the row, and resting the pointer on a tab shows a preview of
// the drawing's Model and layouts, each picked with a click. The close-out pictures layouts not
// shown yet too, and resting on a thumbnail shows that drawing and space in the drawing area
// until the pointer leaves the preview, which brings back what showed before, as in AutoCAD.
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
import { commandLines } from './command-line';

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

/** What showed before the preview showed a thumbnail's space in the drawing area. */
interface Peek {
  readonly active: number | undefined;
  readonly doc: number;
  readonly block: string;
}

/** Pictures a space not shown yet (a canvas made only for it), fitted inside `max`. */
export type PictureSpace = (
  doc: OpenDocument,
  block: string,
  max: { width: number; height: number },
  cancelled: () => boolean,
) => Promise<ImageBitmap | undefined>;

interface Preview {
  readonly id: number;
  /** Where the preview hangs: the tab's lower left corner, in viewport pixels. */
  readonly left: number;
  readonly top: number;
}

export function DocTabs({
  store,
  state,
  picture,
}: {
  store: DocumentStore;
  state: DocumentsState;
  picture?: PictureSpace;
}) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragged, setDragged] = useState<number | undefined>();
  const [preview, setPreview] = useState<Preview | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peeked = useRef<Peek | undefined>(undefined);

  /** Shows a thumbnail's drawing and space, remembering what showed before the first one. */
  const peek = (doc: OpenDocument, block: string) => {
    peeked.current ??= { active: state.active, doc: doc.id, block: doc.block };
    store.activate(doc.id);
    store.showSpace(doc.id, block);
  };
  /** Brings back what showed before the preview showed a thumbnail's space. */
  const unpeek = () => {
    const p = peeked.current;
    if (!p) return;
    peeked.current = undefined;
    store.showSpace(p.doc, p.block);
    if (p.active !== undefined) store.activate(p.active);
  };

  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(f, ms);
  };
  const keep = () => clearTimeout(timer.current);
  const hide = () => {
    clearTimeout(timer.current);
    unpeek();
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
                commandLines.forget(d.id);
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
          current={peeked.current?.doc === previewed.id ? peeked.current.block : previewed.block}
          picture={picture}
          onEnter={keep}
          onLeave={() => {
            unpeek();
            later(() => setPreview(undefined), PREVIEW_LINGER);
          }}
          onPeek={(block) => peek(previewed, block)}
          onPick={(block) => {
            // What the preview shows stays: nothing to bring back.
            peeked.current = undefined;
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
 * order. A space shows as it was last drawn; one not yet opened in this session is pictured
 * as it would open, by a canvas made only for the picture, one space at a time after those
 * already drawn.
 */
function TabPreview({
  doc,
  left,
  top,
  current,
  picture,
  onEnter,
  onLeave,
  onPeek,
  onPick,
}: {
  doc: OpenDocument;
  left: number;
  top: number;
  /** The space the drawing was in before the preview showed another. */
  current: string;
  picture: PictureSpace | undefined;
  onEnter: () => void;
  onLeave: () => void;
  onPeek: (block: string) => void;
  onPick: (block: string) => void;
}) {
  const spaces = spacesOf(doc, engines.changesOf(doc.id));
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
    const keep = (block: string, bitmap: ImageBitmap | undefined) => {
      if (!bitmap) return;
      if (!live) {
        bitmap.close();
        return;
      }
      taken.set(block, bitmap);
      setPictures(new Map(taken));
    };
    const unseen = spaces.filter((s) => !controllerOf(doc.id, s.block));
    void Promise.all(
      spaces.map(async (s) => {
        const c = controllerOf(doc.id, s.block);
        if (c) keep(s.block, await c.thumbnail(THUMB).catch(() => undefined));
      }),
    ).then(async () => {
      // Spaces not shown yet, one at a time: each is a renderer of its own while pictured.
      for (const s of unseen) {
        if (!live || !picture) return;
        keep(s.block, await picture(doc, s.block, THUMB, () => !live));
      }
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
          aria-current={s.block === current}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') onPeek(s.block);
          }}
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
