// The About dialog's content (M9-07): the third-party components the app ships and the notice of
// the PlaneGCS solver module. Both are read from the repository's own files at build time, so the
// dialog says what ATTRIBUTION.md and packages/constraints/wasm/NOTICE.md say and cannot drift
// from them: PlaneGCS's LGPL-2.1+ and Eigen's MPL-2.0 ask for the notice and the way to the
// source wherever the module is distributed, and the app is where it is distributed.
//
// Pure: the parsing is tested in Node (apps/web/test/about.test.ts).
import attribution from '../../../ATTRIBUTION.md?raw';
import solverNotice from '../../../packages/constraints/wasm/NOTICE.md?raw';

/** A run of a line's text: plain, bold, code or a link (its own URL as its text). */
export type Inline =
  | { readonly kind: 'text' | 'strong' | 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

/** A row of ATTRIBUTION.md's table, its cells as written (Markdown). */
export interface AttributionRow {
  readonly component: string;
  readonly use: string;
  readonly licence: string;
  readonly source: string;
}

export type NoticeBlock =
  | { readonly kind: 'heading'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] };

// `**bold**`, `` `code` `` and bare http(s) URLs: all the Markdown the two files use in prose.
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|(https?:\/\/[^\s<>]+)/g;
// A sentence's punctuation after a URL is not part of it.
const URL_TAIL = /[.,;:)]+$/;

/** The runs of `s`: bold, code and bare links read, the rest kept as plain text. */
export function inlineMarkdown(s: string): Inline[] {
  const out: Inline[] = [];
  const text = (t: string) => {
    if (t === '') return;
    const last = out.at(-1);
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    text(s.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else {
      const url = m[3]!.replace(URL_TAIL, '');
      out.push({ kind: 'link', text: url, href: url });
      at = m.index + url.length;
    }
  }
  text(s.slice(at));
  return out;
}

/** The rows of ATTRIBUTION.md's table (Component, Use, License, Source), the header left out. */
export function attributionRows(md: string): AttributionRow[] {
  const rows: AttributionRow[] = [];
  for (const line of md.split('\n')) {
    // Table rows start with "| "; the separator row "|---|" does not.
    if (!line.startsWith('| ')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const [component = '', use = '', licence = '', source = ''] = cells;
    if (component === 'Component') continue;
    rows.push({ component, use, licence, source });
  }
  return rows;
}

// ATTRIBUTION.md says so in a row's Use column when the component is not in the app.
const NOT_SHIPPED = /not shipped|dev only|CI only/;

/** The components the app ships: ATTRIBUTION.md's rows but tooling, tests and CI. */
export function shippedComponents(md: string): AttributionRow[] {
  return attributionRows(md).filter((r) => !NOT_SHIPPED.test(r.use));
}

/** A notice's headings, paragraphs (lines joined) and "- " lists. */
export function noticeBlocks(md: string): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length > 0)
      blocks.push({ kind: 'paragraph', inlines: inlineMarkdown(paragraph.join(' ')) });
    if (items.length > 0) blocks.push({ kind: 'list', items: items.map(inlineMarkdown) });
    paragraph = [];
    items = [];
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '') flush();
    else if (line.startsWith('#')) {
      flush();
      blocks.push({ kind: 'heading', inlines: inlineMarkdown(line.replace(/^#+\s*/, '')) });
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) flush();
      items.push(line.slice(2));
    } else if (items.length > 0) items[items.length - 1] += ` ${line}`;
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

/** What the About dialog lists under Third-party software. */
export const ABOUT_COMPONENTS: readonly AttributionRow[] = shippedComponents(attribution);

/** The PlaneGCS module's notice, as the About dialog shows it. */
export const SOLVER_NOTICE: readonly NoticeBlock[] = noticeBlocks(solverNotice);

/** Where Triya's own source and licence are. */
export const SOURCE_URL = 'https://github.com/shubhs650/triya-cad-2d';
export const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;

/** The MPL-2.0's text (Eigen's licence; the module ships no copy of its own). */
export const MPL_URL = 'https://mozilla.org/MPL/2.0/';

/** The full licence texts the dialog can show, loaded when first opened. */
export const LICENCE_TEXTS = [
  {
    id: 'lgpl',
    label: 'GNU Lesser General Public License 2.1 (PlaneGCS)',
    load: () => import('../../../third_party/planegcs/LICENSE?raw').then((m) => m.default),
  },
  {
    id: 'dictionary',
    label: 'Hunspell en_US dictionary licence (SCOWL, UKACD and others)',
    load: () => import('../../../assets/dictionaries/en-US/LICENSE?raw').then((m) => m.default),
  },
] as const;

/**
 * Whether the About dialog is open, and what ABOUT waits for (it to close). Tools > About and
 * ABOUT at the command line open the same dialog.
 */
export function createAboutDialog() {
  let open = false;
  let waiting: (() => void)[] = [];
  const listeners = new Set<() => void>();
  const set = (o: boolean) => {
    open = o;
    for (const l of listeners) l();
  };
  return {
    get: (): boolean => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Shows the dialog; resolves when it closes. */
    show(): Promise<void> {
      if (!open) set(true);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close() {
      if (open) set(false);
      const done = waiting;
      waiting = [];
      for (const d of done) d();
    },
  };
}

export const aboutDialog = createAboutDialog();
