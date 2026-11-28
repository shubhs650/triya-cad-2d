// The library palette (M8-03; LIBRARY, alias LIB, and LIBRARYCLOSE): Triya's symbol library,
// laid out as AutoCAD 2024's Blocks palette lays out its Libraries tab ("Blocks Palette"):
// search, the items found, and the item picked with its options and a preview; Insert attaches
// its block to the cursor for the insertion point, as a click on a block there does. The items
// are the library's generators (packages/library): ASME B16.5 flanges, nozzles and supports
// sized by their principal dimensions, weld and surface texture symbols and standard notes,
// each drawn as a block in the drawing's units, so it is inserted at scale 1. Favorites keeps
// an item with its options (the Blocks palette's Favorites tab), Recent the last ten inserted;
// both are kept on the device with the preferences, and a kept item is drawn the same size in a
// drawing of other units. The user's own library folders come with M8-03 part 2.
import { useEffect, useId, useMemo, useState } from 'react';
import {
  B16_5_CLASSES,
  FLANGE_VIEWS,
  LIBRARY_GROUPS,
  PIPE_SCHEDULES,
  STANDARD_NOTES,
  SURFACE_LAYS,
  SURFACE_PROCESSES,
  SURFACE_PROCESS_NAMES,
  WELD_TYPES,
  WELD_TYPE_NAMES,
  b165Sizes,
  detailGenerator,
  libraryEntry,
  npsLabel,
  searchLibrary,
  standardNoteText,
  type LibraryAnswer,
  type LibraryBlock,
  type LibraryContext,
  type LibraryEntry,
  type LibraryItem,
  type SurfaceLay,
  type SurfaceProcess,
  type WeldSide,
  type WeldType,
} from '@triya/library';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import {
  isKept,
  keptFor,
  libraryDrop,
  libraryPreview,
  rememberInserted,
  toggleFavorite,
  type KeptLibraryItem,
  type LibraryPreferences,
} from './library';
import { StylePreview } from './StylePreview';

const PREVIEW = { width: 220, height: 140 };

/** A group's heading's id: `library-group-surface-texture`. */
const groupId = (group: string) => `library-group-${group.toLowerCase().replace(/\s+/g, '-')}`;
/** How long the item waits for typing to pause before its block is made again. */
const BLOCK_DELAY_MS = 120;

type Item<K extends LibraryItem['kind']> = Extract<LibraryItem, { kind: K }>;

/** The drawing's context (its scale from inches and units), asked again as it changes. */
function useContext(doc: OpenDocument): LibraryContext | undefined {
  const [context, setContext] = useState<{ key: string; value: LibraryContext }>();
  const key = `${doc.id}@${doc.revision}`;
  useEffect(() => {
    let live = true;
    void engines.library(doc.id).then((a) => {
      if (live && a) setContext({ key, value: a.context });
    });
    return () => {
      live = false;
    };
  }, [key]);
  // The units only change with the drawing's: the last answer serves until the next.
  return context?.value;
}

/**
 * `item`'s block for the drawing, made again once typing pauses. As the drawing changes the
 * last answer for the same item stays shown until the next arrives (an insert does not blank
 * the preview).
 */
function useBlock(doc: OpenDocument, item: LibraryItem | undefined): LibraryBlock | undefined {
  const [block, setBlock] = useState<{ item: string; value: LibraryBlock | undefined }>();
  const itemKey = item ? `${doc.id}:${JSON.stringify(item)}` : '';
  const key = `${itemKey}@${doc.revision}`;
  useEffect(() => {
    if (!item) return;
    let live = true;
    const timer = setTimeout(() => {
      void engines.library(doc.id, item).then((a: LibraryAnswer | undefined) => {
        if (live) setBlock({ item: itemKey, value: a?.block });
      });
    }, BLOCK_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` stands for the item's content and the drawing's revision.
  }, [key]);
  return block?.item === itemKey ? block.value : undefined;
}

/** `o` with `key` set to `v`, or without it when `v` is undefined or empty. */
function withValue<T extends object, K extends keyof T>(o: T, key: K, v: T[K] | undefined): T {
  const rest = { ...o };
  delete rest[key];
  return v === undefined || v === '' ? rest : { ...rest, [key]: v };
}

/** A number typed: kept as typed while it is not one, the item getting NaN (its check says). */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => String(Number(value.toFixed(4))));
  useEffect(() => {
    if (Number(text) !== value) setText(String(Number(value.toFixed(4))));
    // Only a value changed from outside (another item picked) rewrites the field.
  }, [value]);
  return (
    <div className="library-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          const t = e.currentTarget.value.trim();
          onChange(t === '' ? NaN : Number(t));
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="library-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </div>
  );
}

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="library-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const picked = options.find(([v]) => String(v) === e.currentTarget.value);
          if (picked) onChange(picked[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="library-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function FlangeFields({
  item,
  onChange,
}: {
  item: Item<'flange'>;
  onChange: (i: LibraryItem) => void;
}) {
  const { flangeClass, nps, type, schedule } = item.spec;
  const sizes = b165Sizes(flangeClass, type);
  const bored = type === 'WN' || type === 'SW';
  return (
    <>
      <Choice
        label="Class"
        value={flangeClass}
        options={B16_5_CLASSES.map((c) => [c, String(c)] as const)}
        onChange={(c) => {
          // A size the class lacks becomes the class's nearest.
          const fits = b165Sizes(c, type);
          const near = fits.reduce((a, b) => (Math.abs(b - nps) < Math.abs(a - nps) ? b : a));
          onChange({
            ...item,
            spec: { ...item.spec, flangeClass: c, nps: fits.includes(nps) ? nps : near },
          });
        }}
      />
      <Choice
        label="NPS"
        value={nps}
        options={sizes.map((s) => [s, npsLabel(s)] as const)}
        onChange={(s) => onChange({ ...item, spec: { ...item.spec, nps: s } })}
      />
      {bored && (
        <Choice
          label="Bore schedule"
          value={schedule ?? 'STD'}
          options={PIPE_SCHEDULES.map((s) => [s, s] as const)}
          onChange={(s) => onChange({ ...item, spec: { ...item.spec, schedule: s } })}
        />
      )}
      <Choice
        label="View"
        value={item.view}
        options={FLANGE_VIEWS.map((v) => [v, `${v[0]!.toUpperCase()}${v.slice(1)}`] as const)}
        onChange={(v) => onChange({ ...item, view: v })}
      />
    </>
  );
}

function DetailFields({
  item,
  units,
  onChange,
}: {
  item: Item<'detail'>;
  units: string;
  onChange: (i: LibraryItem) => void;
}) {
  const g = detailGenerator(item.generator);
  if (!g) return null;
  return (
    <>
      {g.fields.map((f) => (
        <NumberField
          key={f.key}
          label={`${f.label[0]!.toUpperCase()}${f.label.slice(1)} (${f.kind === 'angle' ? '°' : units}${f.optional ? ', 0 for none' : ''})`}
          value={item.spec[f.key] ?? 0}
          onChange={(v) => onChange({ ...item, spec: { ...item.spec, [f.key]: v } })}
        />
      ))}
    </>
  );
}

const NO_WELD = 'none';

function WeldSideFields({
  side,
  value,
  onChange,
}: {
  side: string;
  value: WeldSide | undefined;
  onChange: (s: WeldSide | undefined) => void;
}) {
  return (
    <>
      <Choice<WeldType | typeof NO_WELD>
        label={`${side} weld`}
        value={value?.type ?? NO_WELD}
        options={[[NO_WELD, 'None'], ...WELD_TYPES.map((t) => [t, WELD_TYPE_NAMES[t]] as const)]}
        onChange={(t) => onChange(t === NO_WELD ? undefined : { ...value, type: t })}
      />
      {value && (
        <TextField
          label={`${side} size`}
          value={value.size ?? ''}
          onChange={(size) => onChange(withValue(value, 'size', size))}
        />
      )}
    </>
  );
}

function WeldFields({
  item,
  units,
  onChange,
}: {
  item: Item<'weld'>;
  units: string;
  onChange: (i: LibraryItem) => void;
}) {
  type Spec = Item<'weld'>['spec'];
  const set = <K extends keyof Spec>(key: K, v: Spec[K] | undefined) =>
    onChange({ ...item, spec: withValue(item.spec, key, v) });
  return (
    <>
      <WeldSideFields
        side="Arrow side"
        value={item.spec.arrowSide}
        onChange={(arrowSide) => set('arrowSide', arrowSide)}
      />
      <WeldSideFields
        side="Other side"
        value={item.spec.otherSide}
        onChange={(otherSide) => set('otherSide', otherSide)}
      />
      <Check
        label="Weld all around"
        checked={item.spec.allAround === true}
        onChange={(allAround) => set('allAround', allAround)}
      />
      <Check
        label="Field weld"
        checked={item.spec.field === true}
        onChange={(field) => set('field', field)}
      />
      <TextField label="Tail" value={item.spec.tail ?? ''} onChange={(tail) => set('tail', tail)} />
      <NumberField
        label={`Text height (${units})`}
        value={item.spec.height}
        onChange={(height) => set('height', height)}
      />
    </>
  );
}

const NO_LAY = 'none';

function SurfaceFields({
  item,
  units,
  onChange,
}: {
  item: Item<'surface'>;
  units: string;
  onChange: (i: LibraryItem) => void;
}) {
  type Spec = Item<'surface'>['spec'];
  const set = <K extends keyof Spec>(key: K, v: Spec[K] | undefined) =>
    onChange({ ...item, spec: withValue(item.spec, key, v) });
  return (
    <>
      <Choice<SurfaceProcess>
        label="Process"
        value={item.spec.process}
        options={SURFACE_PROCESSES.map((p) => [p, SURFACE_PROCESS_NAMES[p]] as const)}
        onChange={(process) => set('process', process)}
      />
      <TextField
        label="Requirement"
        value={item.spec.requirement ?? ''}
        onChange={(requirement) => set('requirement', requirement)}
      />
      <TextField
        label="Method"
        value={item.spec.method ?? ''}
        onChange={(method) => set('method', method)}
      />
      <Choice<SurfaceLay | typeof NO_LAY>
        label="Lay"
        value={item.spec.lay ?? NO_LAY}
        options={[[NO_LAY, 'None'], ...SURFACE_LAYS.map((l) => [l, l] as const)]}
        onChange={(lay) => set('lay', lay === NO_LAY ? undefined : lay)}
      />
      <Check
        label="All around"
        checked={item.spec.allAround === true}
        onChange={(allAround) => set('allAround', allAround)}
      />
      <NumberField
        label={`Text height (${units})`}
        value={item.spec.height}
        onChange={(height) => set('height', height)}
      />
    </>
  );
}

function NotesFields({
  item,
  context,
  onChange,
}: {
  item: Item<'notes'>;
  context: LibraryContext;
  onChange: (i: LibraryItem) => void;
}) {
  const set = (spec: Partial<Item<'notes'>['spec']>) =>
    onChange({ ...item, spec: { ...item.spec, ...spec } });
  const picked = new Set(item.spec.notes.flatMap((n) => ('id' in n ? [n.id] : [])));
  const units = context.units.name.toLowerCase();
  return (
    <>
      <TextField
        label="Heading"
        value={item.spec.heading}
        onChange={(heading) => set({ heading })}
      />
      <fieldset className="library-notes">
        <legend>Notes</legend>
        {STANDARD_NOTES.map((n) => (
          <Check
            key={n.id}
            label={standardNoteText({ id: n.id }, context.units)}
            checked={picked.has(n.id)}
            onChange={(on) =>
              set({
                // In the catalogue's order.
                notes: STANDARD_NOTES.filter((x) => (x.id === n.id ? on : picked.has(x.id))).map(
                  (x) => ({ id: x.id }),
                ),
              })
            }
          />
        ))}
      </fieldset>
      <NumberField
        label={`Text height (${units})`}
        value={item.spec.height}
        onChange={(height) => set({ height })}
      />
      <NumberField
        label={`Width (${units})`}
        value={item.spec.width}
        onChange={(width) => set({ width })}
      />
    </>
  );
}

function ItemFields({
  item,
  context,
  onChange,
}: {
  item: LibraryItem;
  context: LibraryContext;
  onChange: (i: LibraryItem) => void;
}) {
  const units = context.units.name.toLowerCase();
  switch (item.kind) {
    case 'flange':
      return <FlangeFields item={item} onChange={onChange} />;
    case 'detail':
      return <DetailFields item={item} units={units} onChange={onChange} />;
    case 'weld':
      return <WeldFields item={item} units={units} onChange={onChange} />;
    case 'surface':
      return <SurfaceFields item={item} units={units} onChange={onChange} />;
    case 'notes':
      return <NotesFields item={item} context={context} onChange={onChange} />;
  }
}

/** A list of kept items: a click picks one, with its options, for the drawing's units. */
function KeptList({
  label,
  list,
  onPick,
}: {
  label: string;
  list: readonly KeptLibraryItem[];
  onPick: (k: KeptLibraryItem) => void;
}) {
  if (list.length === 0) return null;
  return (
    <section className="library-kept" aria-label={label}>
      <h3>{label}</h3>
      <ul>
        {list.map((k) => (
          <li key={`${k.entry}:${JSON.stringify(k.item)}`}>
            <button type="button" title={k.name} onClick={() => onPick(k)}>
              <span>{libraryEntry(k.entry)?.title}</span> <span className="name">{k.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LibraryPalette({
  doc,
  library,
  onLibrary,
  onClose,
}: {
  /** The drawing shown: what Insert inserts into. */
  doc: OpenDocument;
  library: LibraryPreferences;
  onLibrary: (next: LibraryPreferences) => void;
  onClose: () => void;
}) {
  const context = useContext(doc);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ entry: string; item: LibraryItem; scale: number }>();
  const found = useMemo(() => searchLibrary(query), [query]);
  // The item as this drawing draws it: one kept from a drawing of other units is rescaled.
  const item = picked && context ? keptFor({ ...picked, name: '' }, context.scale) : undefined;
  const block = useBlock(doc, item);
  const preview = useMemo(() => libraryPreview(block), [block]);
  const entry = picked ? libraryEntry(picked.entry) : undefined;
  const kept: KeptLibraryItem | undefined =
    picked && item && context && block && block.error === undefined
      ? { entry: picked.entry, item, scale: context.scale, name: block.name }
      : undefined;
  const favorite = kept !== undefined && isKept(library.favorites, kept);

  const pick = (e: LibraryEntry) => {
    if (context) setPicked({ entry: e.id, item: e.defaults(context), scale: context.scale });
  };
  const insert = () => {
    const drop = block && libraryDrop(block);
    if (!drop || !kept) return;
    onLibrary({ ...library, recent: rememberInserted(library.recent, kept) });
    engines.command(doc.id, { kind: 'design-center', drop });
  };

  return (
    <aside className="palette library-palette" aria-labelledby="library-title">
      <header>
        <h2 id="library-title">Library</h2>
        <button type="button" aria-label="Close Library" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="library-search">
        <input
          type="search"
          aria-label="Search library"
          placeholder="Search library"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      {context && (
        <p className="hint" data-testid="library-units">
          Drawn in {context.units.name.toLowerCase()}, inserted at scale 1.
        </p>
      )}
      <div className="library-panes">
        <div className="library-browse">
          {query === '' && (
            <>
              <KeptList label="Favorites" list={library.favorites} onPick={setPicked} />
              <KeptList label="Recent" list={library.recent} onPick={setPicked} />
            </>
          )}
          <ul className="library-list" role="listbox" aria-label="Library items">
            {LIBRARY_GROUPS.map((group) => {
              const entries = found.filter((e) => e.group === group);
              if (entries.length === 0) return null;
              return (
                <li key={group} role="presentation">
                  <div className="library-group" id={groupId(group)}>
                    {group}
                  </div>
                  <ul role="group" aria-labelledby={groupId(group)}>
                    {entries.map((e) => (
                      <li
                        key={e.id}
                        role="option"
                        tabIndex={0}
                        aria-selected={picked?.entry === e.id}
                        onClick={() => pick(e)}
                        onKeyDown={(k) => {
                          if (k.key === 'Enter' || k.key === ' ') {
                            k.preventDefault();
                            pick(e);
                          }
                        }}
                      >
                        {e.title}
                        {e.group === 'Flanges' && <span className="standard"> {e.standard}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          {found.length === 0 && <p className="empty">Nothing in the library matches “{query}”.</p>}
        </div>
        {picked && item && context && (
          <section className="library-item" aria-label={entry?.title ?? 'Item'}>
            <h3>{entry?.title}</h3>
            <StylePreview doc={doc.id} preview={preview} size={PREVIEW} testId="library-preview" />
            {block?.error !== undefined ? (
              <p className="message error" role="alert">
                {block.error}
              </p>
            ) : (
              <p className="library-name" data-testid="library-block-name">
                {block?.name ?? ''}
              </p>
            )}
            <div className="library-actions">
              <button type="button" disabled={!kept} onClick={insert}>
                Insert
              </button>
              <button
                type="button"
                disabled={!kept}
                aria-pressed={favorite}
                onClick={() =>
                  kept &&
                  onLibrary({ ...library, favorites: toggleFavorite(library.favorites, kept) })
                }
              >
                {favorite ? '★ Remove from Favorites' : '☆ Add to Favorites'}
              </button>
            </div>
            <div className="library-fields">
              <ItemFields
                item={item}
                context={context}
                onChange={(i) => setPicked({ entry: picked.entry, item: i, scale: context.scale })}
              />
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
