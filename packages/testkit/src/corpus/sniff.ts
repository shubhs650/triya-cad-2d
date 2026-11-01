/**
 * Reads the format and version of a drawing from its bytes, without parsing the drawing.
 * Used by `corpus:validate` to keep `corpus.json` truthful; the real readers live in
 * `packages/io` (acad-ts).
 */
export type CadFormat = 'dwg' | 'dxf-ascii' | 'dxf-binary' | 'unknown';

export interface SniffResult {
  format: CadFormat;
  /** `$ACADVER` code such as `AC1032`, or null when the file does not state one. */
  version: string | null;
}

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\0';
const VERSION_RE = /^AC\d{4}$/;

export function sniffCadFile(bytes: Uint8Array): SniffResult {
  const head = latin1(bytes, 0, Math.min(bytes.length, 32));
  // A DWG starts with its version code, e.g. "AC1032".
  if (VERSION_RE.test(head.slice(0, 6))) return { format: 'dwg', version: head.slice(0, 6) };
  if (head.startsWith(BINARY_DXF_SENTINEL)) {
    return { format: 'dxf-binary', version: binaryDxfVersion(bytes) };
  }
  const ascii = asciiDxfVersion(bytes);
  if (ascii !== undefined) return { format: 'dxf-ascii', version: ascii };
  return { format: 'unknown', version: null };
}

/**
 * Binary DXF: after `$ACADVER\0` comes group code 1, one byte in R12 files and a
 * two-byte little-endian integer from R13 on, then a NUL-terminated string.
 * Ref: DXF Reference, "Binary DXF Files".
 */
function binaryDxfVersion(bytes: Uint8Array): string | null {
  const marker = indexOf(bytes, '$ACADVER\0');
  if (marker < 0) return null;
  let i = marker + '$ACADVER\0'.length;
  if (bytes[i] !== 1) return null;
  i += bytes[i + 1] === 0 ? 2 : 1;
  const end = bytes.indexOf(0, i);
  const value = latin1(bytes, i, end < 0 ? bytes.length : end);
  return VERSION_RE.test(value) ? value : null;
}

/**
 * ASCII DXF: group-code/value line pairs. Looks for `9 / $ACADVER` followed by `1 / ACxxxx`
 * inside the HEADER section only. Returns undefined when the bytes do not look like a DXF
 * at all, null when it is a DXF without a version (header-less files are legal; readers
 * treat them as R12).
 */
function asciiDxfVersion(bytes: Uint8Array): string | null | undefined {
  // The header is near the start; 256 KB covers every real header with room to spare.
  const lines = latin1(bytes, 0, Math.min(bytes.length, 256 * 1024)).split(/\r?\n/);
  let section: string | null = null;
  let sawSection = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (!/^-?\d+$/.test(code)) return sawSection ? null : undefined;
    if (code === '0' && value === 'SECTION') {
      sawSection = true;
      section = lines[i + 3]?.trim() ?? null;
      continue;
    }
    if (code === '0' && value === 'ENDSEC') {
      if (section === 'HEADER') return null;
      section = null;
      continue;
    }
    if (code === '0' && value === 'EOF') return null;
    if (section === 'HEADER' && code === '9' && value === '$ACADVER') {
      const v = lines[i + 3]?.trim() ?? '';
      return lines[i + 2]?.trim() === '1' && VERSION_RE.test(v) ? v : null;
    }
    // Comments (999) and leading groups are fine; anything after the first section that is
    // not a HEADER means the version was not stated.
    if (sawSection && section !== 'HEADER' && section !== null) return null;
  }
  return sawSection ? null : undefined;
}

const LATIN1 = new TextDecoder('latin1');

function latin1(bytes: Uint8Array, start: number, end: number): string {
  return LATIN1.decode(bytes.subarray(start, end));
}

function indexOf(bytes: Uint8Array, needle: string): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = bytes.indexOf(first); i >= 0; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
