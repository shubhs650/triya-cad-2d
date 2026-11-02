import { IDxfStreamWriter } from './IDxfStreamWriter.js';
import { DxfCode } from '../../../DxfCode.js';
import { DxfClassMap } from '../../../DxfClassMap.js';
import { DxfProperty } from '../../../DxfProperty.js';
import { DxfReferenceType } from '../../../Types/DxfReferenceType.js';
import { GroupCodeValue, GroupCodeValueType } from '../../../GroupCodeValue.js';
import { Color } from '../../../Color.js';
import { IHandledCadObject } from '../../../IHandledCadObject.js';
import { INamedCadObject } from '../../../INamedCadObject.js';
import { IVector } from '../../../Math/IVector.js';
import { MathHelper } from '../../../Math/MathHelper.js';
import { LittleEndianConverter } from '../../Converters.js';

export abstract class DxfStreamWriterBase implements IDxfStreamWriter {
  public writeOptional: boolean = false;
  /** Use the group-code vocabulary available before R13. */
  public legacyR12: boolean = false;

  public abstract close(): void;

  public abstract dispose(): void;

  public abstract flush(): void;

  public write(code: DxfCode | number, value: unknown, map?: DxfClassMap | null): void {
    if (value === null || value === undefined) {
      return;
    }

    const intCode = typeof code === 'number' ? code : code as number;
    if (this.legacyR12 && intCode >= 80 && intCode < 999 &&
      !(intCode >= 140 && intCode <= 149) &&
      !(intCode >= 170 && intCode <= 179) &&
      !(intCode >= 210 && intCode <= 239)) return;

    if (map && map.dxfProperties.has(intCode)) {
      const prop = map.dxfProperties.get(intCode)!;
      if ((prop.referenceType & DxfReferenceType.Optional) !== 0 && !this.writeOptional) {
        return;
      }
      if ((prop.referenceType & DxfReferenceType.IsAngle) !== 0) {
        value = MathHelper.radToDegRoundTrip(value as number);
      }
    }

    this.writeDxfCode(intCode);

    if (typeof value === 'string') {
      // Caret notation for every control character, not only line feed, return and tab, so the
      // DXF stays one value per line and reads back as it was.
      const s = value
        .replace(/\^/g, '^ ')
        .replace(/[\x00-\x1f]/g, (c) => '^' + String.fromCharCode(c.charCodeAt(0) + 64));
      this.writeValue(intCode, s);
    } else {
      this.writeValue(intCode, value);
    }
  }

  public writeRaw(code: number, value: unknown): void {
    this.writeDxfCode(code);
    this.writeValue(code, value);
  }

  public writeVector(code: DxfCode | number, value: IVector, map?: DxfClassMap | null): void {
    const intCode = typeof code === 'number' ? code : code as number;
    for (let i = 0; i < value.dimension; i++) {
      this.write(intCode + i * 10, value[i], map);
    }
  }

  public writeCmColor(code: number, color: Color, map?: DxfClassMap | null): void {
    if (GroupCodeValue.transformValue(code) === GroupCodeValueType.Int16) {
      this.write(code, color.getApproxIndex() & 0xFFFF);
    } else {
      this.write(code, color.toCmValue(), map);
    }
  }

  public writeHandle(code: number, value: IHandledCadObject | null, map?: DxfClassMap | null): void {
    if (value !== null && value !== undefined) {
      this.write(code, value.handle, map);
    }
  }

  public writeIfNotDefault<T>(code: number, value: T, defaultValue: T, map?: DxfClassMap | null): void {
    if (value !== defaultValue) {
      this.write(code, value, map);
    }
  }

  public writeName(code: number, value: INamedCadObject | null, map?: DxfClassMap | null): void {
    if (value !== null && value !== undefined) {
      this.write(code, value.name, map);
    }
  }

  public writeTrueColor(code: number, color: Color, map?: DxfClassMap | null): void {
    const arr = new Uint8Array(4);
    arr[0] = color.b;
    arr[1] = color.g;
    arr[2] = color.r;
    arr[3] = 0;
    const view = new DataView(arr.buffer);
    this.write(code, view.getInt32(0, true), map);
  }

  protected abstract writeDxfCode(code: number): void;

  protected abstract writeValue(code: number, value: unknown): void;
}
