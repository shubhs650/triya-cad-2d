import { ACadVersion } from '../../../ACadVersion.js';
import { Color } from '../../../Color.js';
import { DxfSubclassMarker } from '../../../DxfSubclassMarker.js';
import { VisualStyle } from '../../../Objects/VisualStyle.js';
import { extendedTypes, fields, type ValueType } from '../../DWG/DwgVisualStyle.js';
import { IDxfStreamWriter } from './IDxfStreamWriter.js';

// The R2007 and R2010 DXF codes of the DWG fields, in the DWG (and DXF) order. A true colour
// follows its index colour at code + 358: the corpus states 63/421 (face style mono colour) and
// 66/424 (edge colour); 64/422, 65/423 and 67/425 follow the same rule.
export const codes: readonly number[] = [
	71, 72, 73, 90, 40, 41, 63, 74, 91, 64, 65, 75, 175, 42, 92, 66, 43, 76, 77, 78, 67, 79,
	170, 171, 290, 93, 44, 173,
];

// R2013+ writes every value under the code of its type, followed by its operation (176).
const typeCodes: Record<ValueType, number> = { BL: 90, BS: 90, BD: 40, B: 290, RC: 90, CMC: 62, TV: 1 };

function defaultValue(type: ValueType): number | boolean | string | Color {
	return type === 'B' ? false : type === 'TV' ? '' : type === 'CMC' ? Color.byLayer : 0;
}

/**
 * Writes the AcDbVisualStyle subclass from the fields, in the layout AutoCAD writes for the
 * version: one value per code up to R2007 (also in R2000/R2004 DXF), each value followed by its
 * operation (176) in R2010, and in R2013+ the 58 values as a counted list under their types'
 * codes. Checked against AutoCAD's DXF saves of the corpus DWGs (R2007, R2010, R2013, R2018).
 */
export function writeDxfVisualStyle(writer: IDxfStreamWriter, version: ACadVersion, style: VisualStyle): void {
	const value = (key: (typeof fields)[number][0]) => Reflect.get(style, key) as number | boolean | string | Color;
	const plain = (code: number, v: number | boolean | string | Color, trueColorCode: number) => {
		if (v instanceof Color) {
			writer.write(code, v.getApproxIndex());
			if (v.isTrueColor) writer.writeTrueColor(trueColorCode, v);
		} else {
			writer.write(code, typeof v === 'boolean' ? (v ? 1 : 0) : v);
		}
	};

	writer.write(100, DxfSubclassMarker.visualStyle);
	// DWG stores the description, which AutoCAD also writes here; the dictionary holds the name.
	writer.write(2, style.description !== '' ? style.description : style.name);
	writer.write(70, style.type);

	if (version < ACadVersion.AC1024) {
		for (const [index, [key]] of fields.entries()) {
			// AutoCAD writes 62 = 5 before the mono colour in every R2007-layout VISUALSTYLE of the
			// corpus (100 records, R2000 to R2007 DXF); the DWG record has no such value.
			if (key === 'faceStyleMonoColor') writer.write(62, 5);
			plain(codes[index], value(key), codes[index] + 358);
			if (key === 'precisionFlag') writer.write(174, style.edgeApplyStyleFlag);
		}
		writer.write(291, style.internalFlag ? 1 : 0);
		writer.write(45, style.dwgLegacyUnknown);
		return;
	}

	// 177 is 2 in every R2010 and 3 in every R2013+ DXF of the corpus, whatever the DWG field.
	writer.write(177, version < ACadVersion.AC1027 ? 2 : 3);
	writer.write(291, style.internalFlag ? 1 : 0);
	const operation = (index: number) => style.dwgPropertyOperations[index] ?? 1;

	if (version < ACadVersion.AC1027) {
		for (const [index, [key]] of fields.entries()) {
			plain(codes[index], value(key), codes[index] + 358);
			writer.write(176, operation(index));
		}
		return;
	}

	writer.write(70, fields.length + extendedTypes.length);
	for (const [index, [key, type]] of fields.entries()) {
		plain(typeCodes[type], value(key), 420);
		writer.write(176, operation(index));
	}
	for (const [index, type] of extendedTypes.entries()) {
		const property = style.dwgExtendedProperties[index];
		plain(typeCodes[type], property?.value ?? defaultValue(type), 420);
		writer.write(176, property?.operation ?? 1);
	}
}
