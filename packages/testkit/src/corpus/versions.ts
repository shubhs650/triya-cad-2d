/**
 * DWG/DXF version codes (`$ACADVER`, and the first six bytes of a DWG) mapped to the AutoCAD
 * release that introduced the format, oldest first. Several releases share one format; the
 * name is the earliest release, matching how AutoCAD's "Save As" list labels them
 * (e.g. AC1032 = "AutoCAD 2018 Drawing", also used by 2019-2025).
 * Ref: https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A
 */
export const ACAD_VERSIONS = {
  AC1002: 'R2.5',
  AC1003: 'R2.6',
  AC1004: 'R9',
  AC1006: 'R10',
  AC1009: 'R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'R2000',
  AC1018: 'R2004',
  AC1021: 'R2007',
  AC1024: 'R2010',
  AC1027: 'R2013',
  AC1032: 'R2018',
} as const;

export type AcadVersion = keyof typeof ACAD_VERSIONS;

export function isAcadVersion(code: string): code is AcadVersion {
  return Object.hasOwn(ACAD_VERSIONS, code);
}

export function releaseName(code: string): string | undefined {
  return isAcadVersion(code) ? ACAD_VERSIONS[code] : undefined;
}
