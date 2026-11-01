import { DxfCode } from '../../../DxfCode.js';
import { GroupCodeValueType } from '../../../GroupCodeValue.js';
import type { DxfRawCode } from '../../../Objects/RawObjectData.js';

export interface IDxfStreamReader {
  encoding: string;

  dxfCode: DxfCode;

  groupCodeValue: GroupCodeValueType;

  code: number;

  value: unknown;

  position: number;

  valueAsString: string;

  valueRaw: string;

  /** When set, every group code read is appended to it (used to keep unknown objects raw). */
  recorder: DxfRawCode[] | null;

  valueAsBool: boolean;

  valueAsShort: number;

  valueAsUShort: number;

  valueAsInt: number;

  valueAsLong: number;

  valueAsDouble: number;

  valueAsAngle: number;

  valueAsHandle: number;

  valueAsBinaryChunk: Uint8Array;

  find(dxfEntry: string): boolean;

  start(): void;

  readNext(): void;

  expectedCode(code: number): void;
}
