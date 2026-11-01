// An independent reader for ASCII DXF, used as the oracle for the AcadToTriya mapping tests:
// the values a file states must come out of acad-ts + AcadToTriya unchanged. It only splits
// the HEADER and TABLES sections into group-code pairs; it knows nothing of acad-ts.

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
}

export function readDxfOracle(bytes: Uint8Array): DxfOracle {
  const lines = new TextDecoder('latin1').decode(bytes).split(/\r?\n/);
  // Values keep their spaces (descriptions, names); only the line break is dropped.
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    groups.push([Number.parseInt(lines[i]!.trim(), 10), lines[i + 1]!]);
  }
  const header = new Map<string, Group[]>();
  const records: DxfRecord[] = [];
  let section = '';
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
    }
  }
  return { header, records };
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
