import { ACadVersion } from '../../ACadVersion.js';
import { Color } from '../../Color.js';
import { VisualStyle } from '../../Objects/VisualStyle.js';
import { IDwgStreamReader } from './DwgStreamReaders/IDwgStreamReader.js';
import { IDwgStreamWriter } from './DwgStreamWriters/IDwgStreamWriter.js';

type ValueType = 'BL' | 'BS' | 'BD' | 'B' | 'RC' | 'CMC' | 'TV';
type Value = number | boolean | string | Color;
type ValueKey = { [K in keyof VisualStyle]: VisualStyle[K] extends Value ? K : never }[keyof VisualStyle];
type Field = readonly [ValueKey, ValueType];

// AcDbVisualStyle has a fixed sequence, not a counted list of payload entries.
// R2010 adds an operation (BS) after every value. R2013 adds 30 more values.
// Layout cross-checked against LibreDWG's src/dwg2.spec, VISUALSTYLE.
const fields: readonly Field[] = [
  ['faceLightingModel', 'BL'], ['faceLightingQuality', 'BL'], ['faceColorMode', 'BL'],
  ['faceModifiers', 'BS'], ['faceOpacityLevel', 'BD'], ['faceSpecularLevel', 'BD'],
  ['faceStyleMonoColor', 'CMC'], ['edgeStyleModel', 'BL'], ['edgeStyle', 'BL'],
  ['edgeIntersectionColor', 'CMC'], ['edgeObscuredColor', 'CMC'],
  ['edgeObscuredLineType', 'BL'], ['edgeIntersectionLineType', 'BL'],
  ['edgeCreaseAngle', 'BD'], ['edgeModifiers', 'BL'], ['edgeColorValue', 'CMC'],
  ['opacityLevel', 'BD'], ['edgeWidth', 'BL'], ['edgeOverhang', 'BL'],
  ['edgeJitter', 'BL'], ['edgeSilhouetteColor', 'CMC'], ['edgeSilhouetteWidth', 'BL'],
  ['haloGap', 'BL'], ['edgeIsolineCount', 'BL'], ['precisionFlag', 'B'],
  ['displaySettings', 'BL'], ['brightness', 'BD'], ['shadowType', 'BL'],
];

const extendedTypes: readonly ValueType[] = [
  'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'BL', 'BD', 'BD',
  'BL', 'CMC', 'BL', 'BL', 'CMC', 'B', 'BL', 'BL', 'BL', 'B', 'BL', 'CMC',
  'BD', 'BL', 'TV', 'B', 'BD', 'BD',
];

function readValue(reader: IDwgStreamReader, type: ValueType): number | boolean | string | Color {
  switch (type) {
    case 'BL': return reader.readBitLong();
    case 'BS': return reader.readBitShort();
    case 'BD': return reader.readBitDouble();
    case 'B': return reader.readBit();
    case 'RC': return reader.readByte();
    case 'CMC': return reader.readCmColor();
    case 'TV': return reader.readVariableText();
  }
}

function writeValue(writer: IDwgStreamWriter, type: ValueType, value: number | boolean | string | Color): void {
  switch (type) {
    case 'BL': writer.writeBitLong(value as number); break;
    case 'BS': writer.writeBitShort(value as number); break;
    case 'BD': writer.writeBitDouble(value as number); break;
    case 'B': writer.writeBit(value as boolean); break;
    case 'RC': writer.writeByte(value as number); break;
    case 'CMC': writer.writeCmColor(value as Color); break;
    case 'TV': writer.writeVariableText(value as string); break;
  }
}

function legacyFields(): Field[] {
  // R2007 stores face modifiers later, and the intersection linetype near the end.
  return [
    ...fields.slice(0, 3), ...fields.slice(4, 7), ['faceModifiers', 'BL'],
    ...fields.slice(7, 12), ...fields.slice(13, 17),
    ['edgeWidth', 'BS'], ['edgeOverhang', 'BS'], ['edgeJitter', 'BL'],
    ['edgeSilhouetteColor', 'CMC'], ['edgeSilhouetteWidth', 'BS'],
    ['haloGap', 'RC'], ['edgeIsolineCount', 'BS'], ['precisionFlag', 'B'],
    ['edgeApplyStyleFlag', 'BS'], ['edgeIntersectionLineType', 'BS'],
    ['displaySettings', 'BL'], ['brightness', 'BL'], ['shadowType', 'BL'],
  ];
}

export function readDwgVisualStyle(reader: IDwgStreamReader, version: ACadVersion, style: VisualStyle): void {
  style.description = reader.readVariableText();
  // The dictionary supplies the name; the stored text is the description.
  style.type = reader.readBitLong();
  const modern = version >= ACadVersion.AC1024;
  if (modern) {
    style.dwgLightingModel = reader.readBitShort();
    style.internalFlag = reader.readBit();
  }
  for (const [index, [key, type]] of (modern ? fields : legacyFields()).entries()) {
    Reflect.set(style, key, readValue(reader, type));
    if (modern) style.dwgPropertyOperations[index] = reader.readBitShort();
  }
  if (!modern) {
    if (version >= ACadVersion.AC1021) style.dwgLegacyUnknown = reader.readBitDouble();
    style.internalFlag = reader.readBit();
  }
  if (version >= ACadVersion.AC1027) {
    style.dwgExtendedProperties = extendedTypes.map(type => ({
      value: readValue(reader, type), operation: reader.readBitShort(),
    }));
  }
}

export function writeDwgVisualStyle(writer: IDwgStreamWriter, version: ACadVersion, style: VisualStyle): void {
  writer.writeVariableText(style.description);
  writer.writeBitLong(style.type);
  const modern = version >= ACadVersion.AC1024;
  if (modern) {
    writer.writeBitShort(style.dwgLightingModel);
    writer.writeBit(style.internalFlag);
  }
  for (const [index, [key, type]] of (modern ? fields : legacyFields()).entries()) {
    writeValue(writer, type, Reflect.get(style, key));
    if (modern) writer.writeBitShort(style.dwgPropertyOperations[index] ?? 1);
  }
  if (!modern) {
    if (version >= ACadVersion.AC1021) writer.writeBitDouble(style.dwgLegacyUnknown);
    writer.writeBit(style.internalFlag);
  }
  if (version >= ACadVersion.AC1027) {
    for (const [index, type] of extendedTypes.entries()) {
      const property = style.dwgExtendedProperties[index];
      const defaultValue = type === 'B' ? false : type === 'TV' ? '' : type === 'CMC' ? Color.byLayer : 0;
      writeValue(writer, type, property?.value ?? defaultValue);
      writer.writeBitShort(property?.operation ?? 1);
    }
  }
}
