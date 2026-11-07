// TriyaToAcad for LEADER annotations and the reactors that point back at them (M1-75 part 15).
// AutoCAD keeps a leader and its annotation linked both ways: the LEADER names the MTEXT,
// TOLERANCE or block reference it annotates (DXF 340), and the annotation lists the leader in
// its reactors (102 {ACAD_REACTORS 330}), as every LEADER of the AutoCAD-saved corpus files
// shows. The LEADER command makes the leader first and its annotation next, so a new leader
// may name an annotation the same save adds. Other reactor changes (hatch boundaries, groups,
// associative dimensions, ...) are still refused: their other end is not written yet.

import type { DocumentInit, DocumentModel, Entity, EntityInit, Handle } from '@triya/engine';
import { same } from './entities';

/** What AutoCAD attaches to a leader as its annotation (AcDbLeader::attachAnnotation). */
const ANNOTATION_TYPES = new Set(['MTEXT', 'TOLERANCE', 'INSERT']);

const annotationOf = (e: Entity | EntityInit): Handle | undefined =>
  e.geom.kind === 'LEADER' ? e.geom.annotation : undefined;

/** Why the model's leader annotations and entity reactors cannot be written. */
export function annotationProblems(base: DocumentInit, model: DocumentModel): string[] {
  const out: string[] = [];
  const baseByHandle = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  for (const m of model.entities()) {
    const b = baseByHandle.get(m.handle);
    const what = `${m.type} ${m.handle}`;
    const after = m.reactors ?? [];
    const before = b?.reactors ?? [];
    if (!same(before, after)) {
      for (const h of after.filter((x) => !before.includes(x))) {
        const leader = model.entityByHandle(h);
        if (!leader || annotationOf(leader) !== m.handle) {
          out.push(`${what}: reactor ${h} is not a leader it annotates`);
        }
      }
      for (const h of before.filter((x) => !after.includes(x))) {
        const was = baseByHandle.get(h);
        const leader = model.entityByHandle(h);
        if (!was || was.geom.kind !== 'LEADER') {
          out.push(`${what}: reactor ${h} goes, which is not a leader's`);
        } else if (leader && annotationOf(leader) === m.handle) {
          out.push(`${what}: reactor ${h} goes, but that leader still annotates it`);
        }
      }
    }
    if (m.geom.kind !== 'LEADER') continue;
    const annotation = m.geom.annotation;
    const old = b && annotationOf(b);
    if (b && annotation === old) continue;
    if (annotation !== undefined) {
      const a = model.entityByHandle(annotation);
      if (!a) {
        out.push(`${what}: annotation ${annotation} is not an entity of the drawing`);
      } else {
        if (!ANNOTATION_TYPES.has(a.type)) {
          out.push(
            `${what}: annotation ${annotation} is a ${a.type}, not MTEXT, TOLERANCE or INSERT`,
          );
        }
        if (a.owner !== m.owner) out.push(`${what}: annotation ${annotation} is in another block`);
        if (!(a.reactors ?? []).includes(m.handle)) {
          out.push(`${what}: annotation ${annotation} does not point back at it (reactors)`);
        }
      }
    }
    // AutoCAD takes the leader off the reactors of an annotation it no longer annotates.
    if (old !== undefined && old !== annotation) {
      const a = model.entityByHandle(old);
      if (a && (a.reactors ?? []).includes(m.handle)) {
        out.push(`${what}: its old annotation ${old} still points at it (reactors)`);
      }
    }
  }
  return out;
}
