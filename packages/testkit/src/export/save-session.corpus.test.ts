// M2-13 acceptance: Save after a markup session on every readable public corpus file. The session
// runs as the app runs it: commands on the PromptBus (LINE, TEXT, REVCLOUD, WIPEOUT, MLEADER) and
// a MOVE and an ERASE of objects the drawing came with, each change set logged as the engine
// worker posts it (a structured clone). The save is the app's: `saveSession` replays that log
// onto a fresh read of the file and writes an AC1032 DXF (DEC-047), however old the source.
//
// The save must change nothing the session did not touch: against the drawing saved unedited
// (the round-trip suite holds that save to the source), the structural diff is zero once the
// touched objects are left out by handle (the entities the session changed, with their
// extension dictionaries, and every handle the save handed out). With TRIYA_DXF_AUDIT_DIR set the
// save also goes to the ezdxf audit as the file's `session` save.
import { readFileSync } from 'node:fs';
import { CadObject, SortEntitiesTable, type CadDocument } from '@node-projects/acad-ts';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  eraseObjects,
  moveBy,
  transformObjects,
  type ChangeSet,
  type EntityId,
} from '@triya/engine';
import { documentInit, readCadDocument, saveDxf, saveSession } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';
import { documentHandles, documentObjects } from '../roundtrip/handle-coverage.ts';
import { writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const PER_FILE_BUDGET_MS = 30_000;
/** The save's refusal of a new style named as an entry it keeps as read (mleader-styles.ts). */
const TAKEN = /the dictionary has an entry named STANDARD that Triya keeps as read/;

/** The lists of a container's members, which change when the session adds or removes one. */
const MEMBERSHIP = /^(entities\._entries|ownedObjectHandles|_?entries\[|_entryNames\[)/;

/** The handle a difference's side names when it is one reference (`MTEXT#33`), else NaN. */
const referenced = (side: string | undefined): number => {
  const m = side === undefined ? null : /^[A-Z_0-9]+#([0-9A-F]+)$/.exec(side);
  return m ? Number.parseInt(m[1]!, 16) : Number.NaN;
};

/** Model-space objects a drafter can select (off locked layers), in file order. */
function selectable(model: DocumentModel, space: string): EntityId[] {
  return model
    .blockEntities(space)
    .filter((id) => model.tables.layers.get(model.entity(id)!.layer)?.locked !== true);
}

/** The `*Model_Space` block record, which the Model tab shows (R12 files have no layouts). */
const modelSpace = (model: DocumentModel): string | undefined =>
  [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;

/** The session, applied to `model`; returns the change log as the app keeps it. */
async function markup(model: DocumentModel, mleader = true): Promise<ChangeSet[]> {
  const log: ChangeSet[] = [];
  const apply = (cs: ChangeSet) => {
    model.apply(cs);
    log.push(structuredClone(cs));
  };
  const space = modelSpace(model)!;
  const existing = selectable(model, space);
  const bus = new PromptBus({ model, registry: builtinCommands(), apply, space: () => space });
  await bus.script(['LINE', '0,0', '100,100', '']);

  await bus.script(['REVCLOUD', 'A', '5', '5', '0,0', '100,50']);
  await bus.script(['WIPEOUT', '0,100', '40,100', '20,130', '']);
  // Text needs a text style, which the oldest drawings (R1, R2.5) do not have.
  if (model.tables.textStyles.size > 0) {
    await bus.script(['TEXT', '0,-20']);
    // A style with a fixed height does not ask it.
    if (bus.promptText.startsWith('Specify height')) await bus.submit('2.5');
    await bus.script(['0', 'Checked', '']);
    if (mleader) await bus.script(['MLEADER', '0,0', '100,50', 'See note', '']);
  }
  expect(bus.command, bus.history.slice(-6).join(' | ')).toBeUndefined();
  // MOVE the first object the drawing came with, ERASE the second, as their commands edit.
  const edit = (f: (b: ChangeSetBuilder) => void) => {
    const b = new ChangeSetBuilder(model);
    f(b);
    apply(b.build());
  };
  if (existing[0] !== undefined)
    edit((b) => transformObjects(b, model, [existing[0]!], moveBy({ x: 10, y: 5 })));
  if (existing[1] !== undefined) edit((b) => eraseObjects(b, model, [existing[1]!]));
  return log;
}

/** Every handle the session touched: the objects its change sets name, with their extension dictionaries. */
function touched(log: readonly ChangeSet[]): Set<number> {
  const out = new Set<string>();
  const add = (o: { readonly handle: string; readonly extDict?: string }) => {
    out.add(o.handle);
    if (o.extDict !== undefined) out.add(o.extDict);
  };
  for (const cs of log) {
    for (const p of [...(cs.entities?.added ?? []), ...(cs.entities?.removed ?? [])]) add(p.entity);
    for (const u of cs.entities?.updated ?? []) add(u.before);
    for (const c of [...Object.values(cs.tables ?? {}), cs.objects, cs.blocks, cs.layouts] as (
      | {
          added?: readonly { handle: string }[];
          updated?: readonly { before: { handle: string } }[];
          removed?: readonly { handle: string }[];
        }
      | undefined
    )[]) {
      for (const r of [...(c?.added ?? []), ...(c?.removed ?? [])]) add(r);
      for (const u of c?.updated ?? []) add(u.before);
    }
  }
  return new Set([...out].map((h) => Number.parseInt(h, 16)));
}

/**
 * `handles` with what they own, in either document: an erased reference takes its attributes
 * and extension dictionary tree with it (AutoCAD's ownership), and a draw order table drops the
 * erased entity's entry (export.ts).
 */
function withOwned(handles: Set<number>, ...docs: CadDocument[]): Set<number> {
  const out = new Set(handles);
  for (const doc of docs) {
    for (const [h, o] of documentObjects(doc)) {
      // An owner is a handled object; the ones that own others are CadObjects.
      const ownerOf = (c: CadObject): CadObject | null =>
        c.owner instanceof CadObject && c.owner !== c ? c.owner : null;
      for (let p = ownerOf(o); p; p = ownerOf(p)) {
        if (handles.has(p.handle)) {
          out.add(h);
          break;
        }
      }
      if (o instanceof SortEntitiesTable && [...o].some((s) => handles.has(s.entity.handle)))
        out.add(h);
    }
  }
  return out;
}

describe('Save after a markup session on the public corpus (M2-13)', () => {
  let saved = 0;
  const refused: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves as AC1032 DXF, changing only what the session touched',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const open = () =>
        withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));
      let model = open();
      expect(modelSpace(model), f.path).toBeDefined();
      const seed = Number.parseInt(model.handSeed, 16);
      let log = await markup(model);
      let out: Uint8Array;
      try {
        out = withPinnedClock(() => saveSession(bytes, log));
      } catch (e) {
        // MLEADER adds a Standard style where an R13 drawing keeps an R2007 one as a proxy
        // object; the save refuses rather than replace it. The rest of the session saves.
        expect(String(e), f.path).toMatch(TAKEN);
        refused.push(f.path);
        model = open();
        log = await markup(model, false);
        out = withPinnedClock(() => saveSession(bytes, log));
      }
      writeAuditSave(f.path, 'session', () => out);
      const unedited = withPinnedClock(() => {
        const doc = readCadDocument(bytes);
        return saveDxf(doc, DocumentModel.create(documentInit(doc)));
      });
      const before = readCadDocument(unedited);
      const after = readCadDocument(out);
      expect(after.header!.version, f.path).toBe(before.header!.version);

      // The session's objects are in the save as the engine held them.
      const back = DocumentModel.create(documentInit(after));
      for (const e of model.entities()) {
        if (!model.blockEntities(e.owner).includes(e.id)) continue;
        expect(back.entityByHandle(e.handle)?.type, `${f.path} ${e.handle}`).toBe(e.type);
      }

      const ignore = withOwned(touched(log), before, after);
      const top = Math.max(...[...documentHandles(after)]);
      for (let h = seed; h <= top; h++) ignore.add(h);
      const headers = new Set(log.flatMap((cs) => (cs.header ?? []).map((h) => h.name)));
      // Objects whose reactors name one the session removed: the save takes it off them.
      const reacting = new Set(
        [...documentObjects(before)]
          .filter(([, o]) => o.reactors.some((r) => ignore.has(r.handle)))
          .map(([h]) => h.toString(16).toUpperCase()),
      );
      const diff = structuralDiff(before, after, { ignoreHandles: ignore }).differences.filter(
        (d) =>
          // A container lists what the session added or removed: the block's entities, a
          // table's records, a dictionary's entries.
          !MEMBERSHIP.test(d.path) &&
          // A header variable the session set (TEXT keeps the height used in $TEXTSIZE).
          !(d.objectName === 'HEADER' && headers.has(d.path)) &&
          !(d.path === '_reactors' && reacting.has(d.handle)) &&
          // A pointer to an object the session erased is null once it is gone.
          !(d.kind === 'value' && ignore.has(referenced(d.a))),
      );
      expect(diff.slice(0, 5), f.path).toEqual([]);
      saved++;
    },
    PER_FILE_BUDGET_MS,
  );

  it('saved every readable file', () => {
    expect(saved).toBe(readable.length);
    expect(refused).toEqual([
      'public/third-party/ezdxf/integration_tests/bin_dxf_r13.dxf',
      'public/third-party/ezdxf/integration_tests/bin_dxf_r14.dxf',
    ]);
  });
});
