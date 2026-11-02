// The part of UTIF.js 3.1 (MIT, photopea) that Triya uses. The package ships no type
// definitions. An IFD is a TIFF directory: its tags by number (`t256` width, `t258` bits per
// sample, …) and, once decoded, its size and raw data.
declare module 'utif' {
  export interface Ifd {
    [tag: `t${number}`]: number[] | string[] | undefined;
    width?: number;
    height?: number;
    data?: Uint8Array;
  }
  export function decode(buffer: ArrayBuffer): Ifd[];
  export function decodeImage(buffer: ArrayBuffer, ifd: Ifd, ifds?: Ifd[]): void;
  export function toRGBA8(ifd: Ifd): Uint8Array;
  export function encodeImage(
    rgba: ArrayBuffer | Uint8Array,
    width: number,
    height: number,
    metadata?: Record<string, unknown>,
  ): ArrayBuffer;
}
