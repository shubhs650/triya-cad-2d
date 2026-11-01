/**
 * `pnpm spike:read` (docs/SPIKE_M0_ACAD_TS.md question 1): does acad-ts read every corpus file,
 * and what does it leave unmapped? Unmapped means acad-ts kept the object only as an opaque
 * `UnknownEntity` / `UnknownNonGraphicalObject` / proxy, or skipped it with a notification.
 */
import {
  DwgReader,
  DxfReader,
  NotificationType,
  ProxyEntity,
  ProxyObject,
  UnknownEntity,
  UnknownNonGraphicalObject,
  type CadDocument,
  type NotificationEventArgs,
} from '@node-projects/acad-ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { declaredHandles, documentHandles } from '../roundtrip/handle-coverage.ts';

export type SpikeReadStatus = 'ok' | 'warnings' | 'error';

export interface SpikeReadResult {
  status: SpikeReadStatus;
  error?: string;
  ms: number;
  objects: number;
  /** DXF type name → count of objects acad-ts holds only as unknown/proxy. */
  unmapped: Record<string, number>;
  /** Notification type (Warning, NotSupported, …) → count. */
  notifications: Record<string, number>;
  /** Normalised notification message → count, for the taxonomy. */
  messages: Record<string, number>;
  /**
   * Objects the file declares (DWG handle map, DXF `5`/`105` codes) that never reach the
   * acad-ts object graph. structuralDiff cannot see these: they are absent before and after.
   */
  coverage?: { fileHandles: number; notInGraph: number; notInGraphByType: Record<string, number> };
}

/** Notification types that mean something in the file was not understood. */
const PROBLEM_TYPES = new Set([
  NotificationType.Warning,
  NotificationType.Error,
  NotificationType.NotSupported,
  NotificationType.NotImplemented,
]);

/** Strip handles, line numbers and values so equal causes group together. */
export function normaliseMessage(message: string): string {
  return message
    .replace(/\b(handle|line|position)[:\s]+[0-9A-Fa-f|]+/gi, '$1 …')
    .replace(/\bwith value .*$/i, 'with value …')
    .replace(/\|\d+/g, '|…')
    .replace(/\b\d{3,}\b/g, '…')
    .slice(0, 160);
}

export function spikeRead(bytes: Uint8Array): SpikeReadResult {
  return withPinnedClock(() => {
    const notes: NotificationEventArgs[] = [];
    const onNote = (_sender: object, e: NotificationEventArgs): void => void notes.push(e);
    const t0 = performance.now();
    let doc: CadDocument;
    try {
      doc =
        sniffCadFile(bytes).format === 'dwg'
          ? DwgReader.readFromStream(bytes.slice().buffer, onNote)
          : DxfReader.readFromStream(bytes, onNote);
    } catch (err) {
      return {
        status: 'error',
        error: (err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err))
          .split('\n')[0]!
          .slice(0, 300),
        ms: Math.round(performance.now() - t0),
        objects: 0,
        unmapped: {},
        notifications: tally(notes.map((n) => NotificationType[n.notificationType] ?? '?')),
        messages: tally(notes.map((n) => normaliseMessage(n.message))),
      };
    }
    const ms = Math.round(performance.now() - t0);

    const unmapped: string[] = [];
    let objects = 0;
    for (const obj of doc.getCadObjects()) {
      objects++;
      if (obj instanceof UnknownEntity || obj instanceof UnknownNonGraphicalObject) {
        unmapped.push(obj.objectName || obj.constructor.name);
      } else if (obj instanceof ProxyEntity || obj instanceof ProxyObject) {
        unmapped.push(`${obj.objectName} (proxy)`);
      }
    }
    // Objects read as unknown are reported by notification and, for most types, not registered.
    for (const n of notes) {
      const m = /UnknownNonGraphicalObject: (\S+)|DXF name (\S+) has been read as an Unknown/.exec(
        n.message,
      );
      if (m) unmapped.push(`${m[1] ?? m[2]} (unknown)`);
    }
    const problems = notes.filter((n) => PROBLEM_TYPES.has(n.notificationType));
    const coverage = handleCoverage(bytes, doc);
    return {
      status: problems.length > 0 || unmapped.length > 0 ? 'warnings' : 'ok',
      ms,
      objects,
      unmapped: tally(unmapped),
      notifications: tally(notes.map((n) => NotificationType[n.notificationType] ?? '?')),
      messages: tally(problems.map((n) => normaliseMessage(n.message))),
      ...(coverage ? { coverage } : {}),
    };
  });
}

/** Declared handles missing from the graph acad-ts built (M1-27 shares the scanner). */
function handleCoverage(bytes: Uint8Array, doc: CadDocument): SpikeReadResult['coverage'] | null {
  let declared: Map<number, string>;
  try {
    declared = declaredHandles(bytes, doc.classes).handles;
  } catch {
    return null; // a stream the scanner cannot read: no coverage figure
  }
  if (declared.size === 0) return null;
  const inGraph = documentHandles(doc);
  const missing: string[] = [];
  for (const [h, type] of declared) if (!inGraph.has(h)) missing.push(type);
  return {
    fileHandles: declared.size,
    notInGraph: missing.length,
    notInGraphByType: tally(missing),
  };
}

export function tally(items: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}
