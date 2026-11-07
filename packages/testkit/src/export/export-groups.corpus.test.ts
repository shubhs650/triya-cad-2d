// GROUP edits on every readable public corpus file (M1-75 part 23): what the Object Grouping
// dialog, GROUPEDIT, GROUP and UNGROUP do. Every named group is renamed, every group gets a new
// description, the other selectable setting and its members reversed, a group of two or more
// lets go of its first member, the last group is ungrouped, and a new group takes the first two
// entities of model space. The edits map back, every member lists its groups once in its
// reactors, and nothing else in the drawing changes. A file before R13, which introduced groups,
// refuses the new group.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion, CadDictionary } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Group,
  type Handle,
  type NonGraphicalObject,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/** Generous for the largest corpus files read twice and written once under full-suite load. */
const PER_FILE_BUDGET_MS = 10_000;

const groupsOf = (objects: Iterable<NonGraphicalObject> | undefined): Group[] =>
  [...(objects ?? [])].filter((o): o is Group => o.type === 'GROUP');

const comparable = ({ raw: _raw, ...rest }: Group) => rest;

const sameList = (a: readonly Handle[], b: readonly Handle[]) =>
  a.length === b.length && a.every((h, i) => h === b[i]);

describe('TriyaToAcad group edits on the public corpus', () => {
  it('finds groups in the corpus', () => {
    const files = readable.filter((f) =>
      /\bGROUP\b/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    'edits, adds and removes the groups of %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const version = original.header?.version ?? ACadVersion.AC1032;
        const groups = groupsOf(model.objects.values());
        const modelSpace = [...model.tables.blockRecords.values()].find(
          (b) => b.name.toUpperCase() === '*MODEL_SPACE',
        )?.handle;
        const firstTwo =
          modelSpace === undefined
            ? []
            : model
                .blockEntities(modelSpace)
                .slice(0, 2)
                .map((id) => model.entity(id)!);
        const dict = original.rootDictionary?.getEntry<CadDictionary>(CadDictionary.acadGroup);
        if (groups.length === 0 && firstTwo.length < 2) return;

        const b = new ChangeSetBuilder(model);
        const reactors = (h: Handle, f: (rs: Handle[]) => Handle[]) => {
          const e = b.entity(model.ids.idOf(h)!)!;
          b.updateEntity(e.id, { reactors: f([...(e.reactors ?? [])]) });
        };
        const removed = groups.at(-1);
        for (const g of groups) {
          if (g === removed) {
            b.removeObject(g.handle);
            for (const m of g.entities) reactors(m, (rs) => rs.filter((x) => x !== g.handle));
            continue;
          }
          const [first, ...rest] = g.entities;
          const keeps = g.entities.length > 1 ? rest : g.entities;
          b.updateObject(g.handle, {
            ...(g.name.startsWith('*') ? {} : { name: `${g.name}-renamed` }),
            description: `${g.description} edited`,
            selectable: !g.selectable,
            entities: [...keeps].reverse(),
          } as Partial<NonGraphicalObject>);
          if (g.entities.length > 1) reactors(first!, (rs) => rs.filter((x) => x !== g.handle));
        }
        let added: Handle | undefined;
        if (firstTwo.length === 2) {
          const owner = dict ? dict.handle.toString(16).toUpperCase() : 'FFFFF';
          added = b.addObject({
            type: 'GROUP',
            owner,
            reactors: [owner],
            name: 'TRIYA-GROUP',
            description: 'made by Triya',
            selectable: true,
            entities: firstTwo.map((e) => e.handle),
          } as Omit<Group, 'handle'>).handle;
          for (const e of firstTwo) reactors(e.handle, (rs) => [...rs, added!]);
        }
        model.apply(b.build());
        if (version < ACadVersion.AC1012) {
          expect(() => exportDocument(readCadDocument(bytes), model, options)).toThrow(
            /has no groups \(R13 introduced them\)/,
          );
          return;
        }

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        expect(groupsOf(init.objects).map(comparable), f.path).toEqual(
          groupsOf(model.objects.values()).map(comparable),
        );
        const reactorsBack = new Map(init.entities?.map((e) => [e.handle, e.reactors ?? []]));
        const edited = new Set<Handle>(
          groups.flatMap((g) => g.entities).concat(firstTwo.map((e) => e.handle)),
        );
        expect(
          [...edited].filter((h) => {
            const e = model.entityByHandle(h);
            return e && !sameList(reactorsBack.get(h) ?? [], e.reactors ?? []);
          }),
          f.path,
        ).toEqual([]);
        // ACAD_GROUP lists the groups kept, in place, under their new names, and the new one last.
        if (dict) {
          const back = reopened.getCadObject(dict.handle) as CadDictionary;
          const nameOf = new Map(
            groupsOf(model.objects.values()).map((g) => [Number.parseInt(g.handle, 16), g.name]),
          );
          const kept = dict.entryHandles
            .map((h, i) => [h, dict.entryNames[i]!] as const)
            .filter(([h]) => nameOf.has(h));
          expect({ names: back.entryNames, handles: back.entryHandles }, f.path).toEqual({
            names: [...kept.map(([h]) => nameOf.get(h)!), ...(added ? ['TRIYA-GROUP'] : [])],
            handles: [...kept.map(([h]) => h), ...(added ? [Number.parseInt(added, 16)] : [])],
          });
        }
        // Nothing else changes: the groups, their dictionary and their members are the edit.
        const ignoreHandles = new Set(
          [...groups.map((g) => g.handle), ...(added ? [added] : []), ...edited].map((h) =>
            Number.parseInt(h, 16),
          ),
        );
        if (dict) ignoreHandles.add(dict.handle);
        // A DWG before R2004 has no list of a space's objects: acad-ts fills
        // `ownedObjectHandles` in the order it happens to read the entities, which follows the
        // handles a group points at, and its writer never writes the list for those versions.
        const readOrderOnly = format === 'dwg' && version < ACadVersion.AC1018;
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            !(d.handle === '0' && d.path.startsWith('$HANDSEED')) &&
            !(readOrderOnly && d.path.startsWith('ownedObjectHandles')),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
