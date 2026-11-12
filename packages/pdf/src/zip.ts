// A plot that writes one file a sheet (M2-39 part 4: PUBLISH and Export's All layouts to SVG or
// PNG) as one ZIP archive. AutoCAD writes a raster or SVG plotter's sheets as separate files
// into a folder; a web page cannot write a folder in every browser, and a page starting several
// downloads at once is blocked or asked about by most of them, so the sheets travel as one
// download, a file each, named as AutoCAD names them. No DOM here.

import { zipSync, type Zippable } from 'fflate';

export interface ArchiveFile {
  /** The file's name in the archive; a name already used gets " (2)", " (3)" … before its extension. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** `names` made unique as a file system would ask: "a.svg", "a (2).svg" … */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const key = (n: string) => n.toLowerCase();
    if (!used.has(key(name))) {
      used.add(key(name));
      return name;
    }
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; ; n++) {
      const next = `${stem} (${n})${ext}`;
      if (!used.has(key(next))) {
        used.add(key(next));
        return next;
      }
    }
  });
}

/**
 * The files as a ZIP archive, in the order given. PNGs are stored (already deflated); other
 * files are deflated. `modified` dates every entry (now when absent).
 */
export function zipFiles(files: readonly ArchiveFile[], modified: Date = new Date()): Uint8Array {
  const names = uniqueFileNames(files.map((f) => f.name));
  const entries: Zippable = {};
  files.forEach((f, i) => {
    const level = /\.png$/i.test(names[i]!) ? 0 : 6;
    entries[names[i]!] = [f.bytes, { level, mtime: modified }];
  });
  return zipSync(entries);
}
