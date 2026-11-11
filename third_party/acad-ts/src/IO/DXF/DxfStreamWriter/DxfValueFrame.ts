import { CadValueType } from '../../../CadValueType.js';
import { DxfFileToken } from '../../../DxfFileToken.js';
import type { DxfRawCode } from '../../../Objects/RawObjectData.js';

/**
 * The group codes of an object kept as read (a TABLECONTENT), with every value written before
 * R2007 given the frame values have from R2007: the 93 flags before the 90 type, and the 94
 * units, 300 format, 302 formatted value and 304 ACVALUE_END after the data. Written unframed
 * into an R2007 or later file, a value made its reader run on to the next ACVALUE_END, past the
 * end of the object.
 *
 * A value starts after a `300 VALUE` (cell content) or `301 DATAMAP_VALUE` marker; one written
 * before R2007 starts with its 90 type, one from R2007 with its 93 flags and is left as it is.
 * The frame is the one AutoCAD writes for a value with the general format (flags 2; 1 more for
 * an empty, unknown-type value, which has no data) and no formatted value cached.
 */
export function framePreR2007Values(codes: readonly DxfRawCode[]): DxfRawCode[] {
	const out: DxfRawCode[] = [];
	for (let i = 0; i < codes.length; i++) {
		const marker = codes[i]!;
		out.push(marker);
		const typeCode = codes[i + 1];
		if (!isValueMarker(marker) || typeCode?.code !== 90) {
			continue;
		}
		const type = Number(typeCode.value) as CadValueType;
		const end = preR2007ValueEnd(codes, i + 1, type);
		if (end < 0) {
			continue;
		}
		const empty = type === CadValueType.Unknown;
		out.push({ code: 93, value: empty ? 3 : 2 }, typeCode);
		if (!empty) {
			const data = codes.slice(i + 2, end + 1);
			out.push(...(type === CadValueType.Date ? r2007Date(data) : data));
		}
		out.push(
			{ code: 94, value: 0 },
			{ code: 300, value: '' },
			{ code: 302, value: '' },
			{ code: 304, value: DxfFileToken.valueEnd },
		);
		i = end;
	}
	return out;
}

function isValueMarker({ code, value }: DxfRawCode): boolean {
	const name = String(value).toUpperCase();
	return (code === 300 && name === 'VALUE') || (code === 301 && name === 'DATAMAP_VALUE');
}

/**
 * The index of a pre-R2007 value's last code: its type's last data code, as the DXF reader ends
 * it (`endsPreR2007Value`), or -1 when the codes end first.
 */
function preR2007ValueEnd(codes: readonly DxfRawCode[], typeIndex: number, type: CadValueType): number {
	let size = 0;
	let read = 0;
	for (let j = typeIndex; j < codes.length; j++) {
		const { code, value } = codes[j]!;
		switch (type) {
			case CadValueType.Unknown:
			case CadValueType.Long:
				if (code === 91) return j;
				break;
			case CadValueType.Double:
				if (code === 140) return j;
				break;
			case CadValueType.String:
				if (code === 1) return j;
				break;
			case CadValueType.Date:
			case CadValueType.Buffer:
				if (code === 92) {
					size = Number(value);
				} else if (code === 310) {
					read += (value as Uint8Array).length;
				} else {
					break;
				}
				if (read >= size) return j;
				break;
			case CadValueType.Point2D:
				if (code === 21) return j;
				break;
			case CadValueType.Point3D:
				if (code === 31) return j;
				break;
			case CadValueType.Handle:
				if (code === 330) return j;
				break;
			default:
				// A result buffer or general value has no data codes: it ends on its type.
				return j;
		}
	}
	return -1;
}

/**
 * A date's data from R2007: a 16-byte SYSTEMTIME (year, month, day of week, day, hour, minute,
 * second, millisecond, little-endian shorts) where before R2007 it was 8 bytes of seconds since
 * 1970 (UTC; the AC1018 and AC1032 saves of acadsharp's sample drawing state 0x673680F0 and
 * 2024-11-15 00:00 for one date, written in UTC+1). Data of another size is kept as read.
 */
function r2007Date(data: DxfRawCode[]): DxfRawCode[] {
	const chunks = data.filter((c) => c.code === 310).map((c) => c.value as Uint8Array);
	const bytes = chunks.length === 1 ? chunks[0]! : null;
	if (bytes === null || bytes.length !== 8) {
		return data;
	}
	const seconds = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true);
	const date = new Date(Number(seconds) * 1000);
	const out = new Uint8Array(16);
	const view = new DataView(out.buffer);
	[date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDay(), date.getUTCDate(), date.getUTCHours(),
		date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()]
		.forEach((part, i) => view.setInt16(i * 2, part, true));
	return [{ code: 92, value: out.length }, { code: 310, value: out }];
}
