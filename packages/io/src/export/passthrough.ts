// PassthroughStore (ARCHITECTURE.md §6.2, M1-05): every acad-ts object of the retained original,
// by handle, split into what Triya maps (entities, table records, layouts, the objects it
// models) and what it only keeps. Export looks mapped objects up here to apply Triya's changes
// onto their originals; the passthrough handles are handed to the engine so it never allocates
// one of them again (`DocumentInit.passthrough`).

import {
  CadDictionary,
  Field,
  Insert,
  PolyfaceMesh,
  Polyline,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, Handle } from '@triya/engine';
import { hex } from '../map/common';

/**
 * Every object the document holds, by handle. acad-ts keeps polyline vertices, polyface-mesh
 * faces, attributes and their `SEQEND`, and child fields inside their owner (under their file
 * handles) rather than in the document's object map, so those are added from the owner. A held
 * child is not registered with the document, so neither is its extension dictionary; the
 * dictionary and its entries are reached only through the child. Handle 0 (the document
 * itself) is left out.
 */
export function documentObjects(doc: CadDocument): Map<number, CadObject> {
  const out = new Map<number, CadObject>();
  const addTree = (o: CadObject): void => {
    if (out.has(o.handle)) return;
    out.set(o.handle, o);
    if (o.xDictionary) addTree(o.xDictionary);
    if (o instanceof CadDictionary) for (const e of o) addTree(e);
    addHeld(o);
  };
  const addHeld = (o: CadObject): void => {
    if (o instanceof Field) for (const f of o.children) addTree(f);
    const children = o instanceof Polyline ? o.vertices : o instanceof Insert ? o.attributes : null;
    if (!children) return;
    for (const c of children) addTree(c);
    if (children.seqend) addTree(children.seqend);
    if (o instanceof PolyfaceMesh) for (const f of o.faces) addTree(f);
  };
  const registered = [...doc.getCadObjects()];
  for (const o of registered) out.set(o.handle, o);
  for (const o of registered) addHeld(o);
  out.delete(0);
  return out;
}

/** Handles the Triya document claims for itself (DocumentModel's uniqueness set). */
function mappedHandles(init: DocumentInit): Set<Handle> {
  const out = new Set<Handle>();
  for (const records of Object.values(init.tables ?? {})) {
    for (const r of records as readonly { handle: Handle }[]) out.add(r.handle);
  }
  for (const b of init.blocks ?? []) {
    if (b.beginHandle !== undefined) out.add(b.beginHandle);
    if (b.endHandle !== undefined) out.add(b.endHandle);
  }
  for (const l of init.layouts ?? []) out.add(l.handle);
  for (const o of init.objects ?? []) out.add(o.handle);
  for (const e of init.entities ?? []) out.add(e.handle);
  return out;
}

export class PassthroughStore {
  readonly #objects: Map<number, CadObject>;
  readonly #passthrough: Handle[];

  private constructor(objects: Map<number, CadObject>, passthrough: Handle[]) {
    this.#objects = objects;
    this.#passthrough = passthrough;
  }

  /** The store of `doc`, given what `AcadToTriya` mapped from it. */
  static of(doc: CadDocument, init: DocumentInit): PassthroughStore {
    const objects = documentObjects(doc);
    const mapped = mappedHandles(init);
    const passthrough = [...objects.keys()]
      .sort((a, b) => a - b)
      .map(hex)
      .filter((h) => !mapped.has(h));
    return new PassthroughStore(objects, passthrough);
  }

  /** Handles of the objects Triya keeps without mapping, ascending. */
  get handles(): readonly Handle[] {
    return this.#passthrough;
  }

  /** The acad-ts object with this handle, mapped or not. */
  original(handle: Handle): CadObject | undefined {
    return this.#objects.get(Number.parseInt(handle, 16));
  }
}
