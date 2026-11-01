// An independent reader for ASCII DXF, used as the oracle for the AcadToTriya mapping tests:
// the values a file states must come out of acad-ts + AcadToTriya unchanged. It only splits
// the HEADER and TABLES sections, and the style objects of the OBJECTS section, into
// group-code pairs; it knows nothing of acad-ts.

export type Group = readonly [code: number, value: string];

/** One TABLES record: its type (`LAYER`, `STYLE`, …) and its groups after the `0` line. */
export interface DxfRecord {
  readonly type: string;
  readonly groups: readonly Group[];
}

export interface DxfOracle {
  /** `$NAME` → the groups that follow it. */
  readonly header: ReadonlyMap<string, readonly Group[]>;
  readonly records: readonly DxfRecord[];
  /** OBJECTS-section records of the types in STYLE_OBJECTS. */
  readonly objects: readonly DxfRecord[];
  /** Entities of the ENTITIES and BLOCKS sections, in file order. */
  readonly entities: readonly DxfEntity[];
}

/**
 * An entity record. A POLYLINE carries its VERTEX records and an INSERT its ATTRIB records
 * as `children`, as AutoCAD nests them (SEQEND is dropped).
 */
export interface DxfEntity extends DxfRecord {
  /** Name of the BLOCK it is in, or undefined in the ENTITIES section. */
  readonly block?: string;
  readonly children: DxfRecord[];
}

/** The OBJECTS-section types Triya keeps beside the tables. */
export const STYLE_OBJECTS: ReadonlySet<string> = new Set(['MLEADERSTYLE', 'TABLESTYLE']);

export function readDxfOracle(bytes: Uint8Array): DxfOracle {
  const lines = new TextDecoder('latin1').decode(bytes).split(/\r?\n/);
  // Values keep their spaces (descriptions, names); only the line break is dropped.
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    groups.push([Number.parseInt(lines[i]!.trim(), 10), lines[i + 1]!]);
  }
  const header = new Map<string, Group[]>();
  const records: DxfRecord[] = [];
  const objects: DxfRecord[] = [];
  const entities: DxfEntity[] = [];
  let block: string | undefined;
  let parent: DxfEntity | undefined;
  let section = '';
  let blockGroups: Group[] | undefined;
  let current: Group[] | undefined;
  for (let i = 0; i < groups.length; i++) {
    const [code, value] = groups[i]!;
    if (code === 0 && value === 'SECTION') {
      section = groups[i + 1]?.[1] ?? '';
      current = undefined;
      i++;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      section = '';
      current = undefined;
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) header.set(value, (current = []));
      else current?.push([code, value]);
    } else if (section === 'TABLES') {
      if (code === 0) {
        current = undefined;
        if (value !== 'TABLE' && value !== 'ENDTAB')
          records.push({ type: value, groups: (current = []) });
      } else current?.push([code, value]);
    } else if (section === 'ENTITIES' || section === 'BLOCKS') {
      if (code !== 0) {
        current?.push([code, value]);
        // A BLOCK's name is its first 2 group.
        if (current === blockGroups && code === 2 && block === undefined) block = value;
        continue;
      }
      current = undefined;
      if (value === 'BLOCK') {
        block = undefined;
        current = blockGroups = [];
      } else if (value === 'ENDBLK' || value === 'SEQEND') {
        parent = undefined;
      } else if ((value === 'VERTEX' || value === 'ATTRIB') && parent) {
        parent.children.push({ type: value, groups: (current = []) });
      } else {
        const e: DxfEntity = {
          type: value,
          groups: (current = []),
          children: [],
          ...(section === 'BLOCKS' && block !== undefined ? { block } : {}),
        };
        entities.push(e);
        parent = value === 'POLYLINE' || value === 'INSERT' ? e : undefined;
      }
    } else if (section === 'OBJECTS') {
      if (code === 0) {
        current = undefined;
        if (STYLE_OBJECTS.has(value)) objects.push({ type: value, groups: (current = []) });
      } else current?.push([code, value]);
    }
  }
  return { header, records, objects, entities };
}

/** First value of a group code, if present. */
export function first(groups: readonly Group[], code: number): string | undefined {
  return groups.find(([c]) => c === code)?.[1];
}

export function all(groups: readonly Group[], code: number): string[] {
  return groups.filter(([c]) => c === code).map(([, v]) => v);
}

/** Handle of a record: 105 for DIMSTYLE, 5 for the others. */
export function recordHandle(r: DxfRecord): string | undefined {
  const h = first(r.groups, r.type === 'DIMSTYLE' ? 105 : 5);
  return h === undefined
    ? undefined
    : h
        .trim()
        .replace(/^0+(?=.)/, '')
        .toUpperCase();
}
