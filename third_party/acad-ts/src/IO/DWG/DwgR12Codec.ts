import { CadDocument } from '../../CadDocument.js';
import { ACadVersion } from '../../ACadVersion.js';
import { DxfWriter } from '../DXF/DxfWriter.js';
import { DxfReader } from '../DXF/DxfReader.js';
import { encodeCadString, decodeCadString } from '../TextEncoding.js';
import { CRC } from './CRC.js';
import { r12Template } from './DwgR12Template.js';
import { NotificationEventHandler, NotificationEventArgs, NotificationType } from '../NotificationEventHandler.js';

type Pair = [number, string];
type RecordData = Pair[];
type Primitive = 'byte' | 'short' | 'long' | 'double' | 'text';
const types: Record<string, number> = { LINE: 1, POINT: 2, CIRCLE: 3, SHAPE: 4, TEXT: 7,
	ARC: 8, TRACE: 9, SOLID: 11, BLOCK: 12, ENDBLK: 13, INSERT: 14, ATTDEF: 15,
	ATTRIB: 16, SEQEND: 17, POLYLINE: 19, VERTEX: 20, '3DFACE': 22 };
const tableHeaders: Record<string, number> = { BLOCK: 44, LAYER: 54, STYLE: 64, LTYPE: 74, VIEW: 84,
	UCS: 0x3ef, VPORT: 0x500, APPID: 0x512, DIMSTYLE: 0x522, VX: 0x69f };
const headerFields: [string, number, number[], Primitive][] = [
	['$INSBASE', 0x5e, [10, 20, 30], 'double'], ['$PLINEGEN', 0x76, [70], 'short'],
	['$EXTMIN', 0x78, [10, 20, 30], 'double'], ['$EXTMAX', 0x90, [10, 20, 30], 'double'],
	['$LIMMIN', 0xa8, [10, 20], 'double'], ['$LIMMAX', 0xb8, [10, 20], 'double'],
	['$ORTHOMODE', 0x128, [70], 'short'], ['$FILLMODE', 0x12c, [70], 'short'],
	['$LTSCALE', 0x132, [40], 'double'], ['$TEXTSIZE', 0x13a, [40], 'double'], ['$TRACEWID', 0x142, [40], 'double'],
];
const originalHeaders = new WeakMap<CadDocument, Uint8Array>();
const value = (record: RecordData, code: number, fallback = '') => record.find(p => p[0] === code)?.[1] ?? fallback;
const number = (record: RecordData, code: number, fallback = 0) => Number(value(record, code, String(fallback)));
const concat = (chunks: Uint8Array[]) => {
	const result = new Uint8Array(chunks.reduce((sum, b) => sum + b.length, 0));
	let offset = 0; for (const b of chunks) { result.set(b, offset); offset += b.length; } return result;
};
function checked(data: Uint8Array): Uint8Array {
	const result = new Uint8Array(data.length + 2); result.set(data);
	new DataView(result.buffer).setUint16(data.length, CRC.applyCrc8(0xc0c1, data), true); return result;
}

class Bytes {
	position = 0;
	constructor(readonly data: Uint8Array, readonly encoding = 'windows-1252') {}
	get view(): DataView { return new DataView(this.data.buffer, this.data.byteOffset, this.data.length); }
	read(type: Primitive): string {
		let result: number | string;
		const p = this.position;
		switch (type) {
			case 'byte': result = this.view.getUint8(p); this.position++; break;
			case 'short': result = this.view.getInt16(p, true); this.position += 2; break;
			case 'long': result = this.view.getUint32(p, true); this.position += 4; break;
			case 'double': result = this.view.getFloat64(p, true); this.position += 8; break;
			case 'text': {
				const length = this.view.getUint16(p, true); this.position += 2;
				if (this.position + length > this.data.length) throw new Error('Truncated R12 string.');
				result = decodeCadString(this.data.subarray(this.position, this.position + length), this.encoding);
				this.position += length; break;
			}
		}
		return String(result);
	}
	write(type: Primitive, value: string): void {
		const p = this.position, n = Number(value);
		switch (type) {
			case 'byte': this.view.setUint8(p, n); this.position++; break;
			case 'short': this.view.setInt16(p, n, true); this.position += 2; break;
			case 'long': this.view.setUint32(p, n, true); this.position += 4; break;
			case 'double': this.view.setFloat64(p, n, true); this.position += 8; break;
			case 'text': {
				const bytes = encodeCadString(value, this.encoding);
				if (bytes.length > 0xffff) throw new Error('R12 text exceeds 65535 bytes.');
				this.view.setUint16(p, bytes.length, true); this.position += 2;
				this.data.set(bytes, this.position); this.position += bytes.length; break;
			}
		}
	}
}

/** Byte-aligned pre-R13 records share the same semantic fields as R12 DXF.
 * Reuse the DXF model builder for ownership, block references and sequences;
 * all on-disk DWG framing and primitive encoding here are independent. */
export class DwgR12Codec {
	private tables = new Map<string, RecordData[]>();
	private blockOffsets: number[] = [];
	private nextHandle = 1;
	private writtenHandles = new Set<number>();
	private checkCrc = false;
	constructor(private readonly encoding = 'windows-1252') {}
	private field(record: RecordData, bytes: Bytes, read: boolean, code: number, type: Primitive, reference?: string): void {
		if (read) {
			let v = bytes.read(type);
			if (type === 'double' && code >= 50 && code <= 58) v = String(Number(v) * 180 / Math.PI);
			if (reference) v = reference === 'LTYPE' && Number(v) < 0 ? Number(v) === -2 ? 'BYBLOCK' : 'BYLAYER'
				: value(this.tables.get(reference)?.[Number(v)] ?? [], 2, reference === 'LTYPE' ? 'BYLAYER' : 'STANDARD');
			record.push([code, v]);
		} else {
			let v = value(record, code, type === 'text' ? '' : '0');
			if (type === 'double' && code >= 50 && code <= 58) v = String(Number(v) * Math.PI / 180);
			if (reference) {
				const index = this.tables.get(reference)?.findIndex(r => value(r, 2).toUpperCase() === v.toUpperCase()) ?? -1;
				if (index < 0 && reference !== 'LTYPE') throw new Error('Missing R12 ' + reference + ' reference: ' + v);
				v = String(index < 0 && reference === 'LTYPE' && v.toUpperCase() === 'BYBLOCK' ? -2 : index);
			}
			bytes.write(type, v);
		}
	}
	private geometry(name: string, record: RecordData, bytes: Bytes, read: boolean, opts: number, flags: number): number {
		const field = (code: number, type: Primitive = 'double', ref?: string) => this.field(record, bytes, read, code, type, ref);
		const point = (code: number, dimensions = 2) => { for (let i = 0; i < dimensions; i++) field(code + 10 * i); };
		const optional = (bit: number, code: number, type: Primitive = 'double', ref?: string) => {
			if (!read && record.some(p => p[0] === code)) opts |= bit;
			if (opts & bit) field(code, type, ref);
		};
		const extrusion = (bit: number) => {
			if (!read && [210, 220, 230].some(c => record.some(p => p[0] === c))) opts |= bit;
			if (opts & bit) point(210, 3);
		};
		switch (name) {
			case 'LINE': point(10, flags & 4 ? 2 : 3); point(11, flags & 4 ? 2 : 3); extrusion(1); break;
			case 'POINT': point(10, flags & 4 ? 2 : 3); extrusion(1); optional(2, 50); break;
			case 'CIRCLE': case 'ARC':
				point(10); field(40); if (name === 'ARC') { field(50); field(51); }
				extrusion(1); optional(2, 30); break;
			case 'TEXT': case 'ATTRIB': case 'ATTDEF': {
				point(10); field(40); field(1, 'text');
				const shift = name === 'TEXT' ? 1 : 2;
				if (name === 'ATTDEF') field(3, 'text');
				if (name !== 'TEXT') { field(2, 'text'); field(70, 'byte'); }
				optional(shift, 50); optional(shift * 2, 41); optional(shift * 4, 51);
				optional(shift * 8, 7, 'byte', 'STYLE'); optional(shift * 16, 71, 'byte'); optional(shift * 32, 72, 'byte');
				if (!read && record.some(p => p[0] === 11)) opts |= shift * 64;
				if (opts & (shift * 64)) point(11);
				extrusion(shift * 128); optional(shift * 256, name === 'TEXT' ? 73 : 74, 'byte'); break;
			}
			case 'BLOCK': point(10); optional(2, 1, 'text'); optional(4, 2, 'text'); break;
			case 'ENDBLK': break;
			case 'SEQEND': if (read) bytes.read('long'); else bytes.write('long', '0'); break;
			case 'INSERT':
				field(2, 'short', 'BLOCK'); point(10);
				for (const [bit, code] of [[1, 41], [2, 42], [4, 50], [8, 43], [16, 70], [32, 71], [64, 44], [128, 45]]) optional(bit, code, bit === 16 || bit === 32 ? 'short' : 'double');
				extrusion(256); if (read && flags & 128) record.push([66, '1']); break;
			case 'POLYLINE':
				optional(1, 70, 'byte'); optional(2, 40); optional(4, 41); extrusion(8);
				for (const [bit, code] of [[16, 71], [32, 72], [64, 73], [128, 74], [256, 75]]) optional(bit, code, 'short');
				if (read) record.push([66, '1'], [10, '0'], [20, '0']); break;
			case 'VERTEX':
				if (!read && number(record, 70) === 128) opts |= 0x4000;
				if (!(opts & 0x4000)) point(10);
				optional(1, 40); optional(2, 41); optional(4, 42); optional(8, 70, 'byte'); optional(16, 50);
				for (let i = 0; i < 4; i++) optional(32 << i, 71 + i, 'short'); break;
			case 'SOLID': case 'TRACE': for (let c = 10; c < 14; c++) point(c); extrusion(1); break;
			case '3DFACE': for (let c = 10; c < 14; c++) point(c, flags & 4 ? 2 : 3); optional(1, 70, 'short'); break;
			default: throw new Error('Unsupported R12 DWG entity: ' + name);
		}
		return opts;
	}
	private encode(record: RecordData): Uint8Array {
		const name = value(record, 0), type = types[name];
		if (!type) throw new Error('Unsupported R12 DWG entity: ' + name);
		const bytes = new Bytes(new Uint8Array(0x10000), this.encoding); bytes.position = 8;
		let flags = 32;
		if (record.some(p => p[0] === 62)) flags |= 1;
		if (record.some(p => p[0] === 6) && value(record, 6).toUpperCase() !== 'BYLAYER') flags |= 2;
		if (!['LINE', 'POINT', '3DFACE'].includes(name) && number(record, 30) !== 0) flags |= 4;
		if (number(record, 39) !== 0) flags |= 8;
		if (number(record, 67) !== 0) flags |= 64;
		if (number(record, 66) !== 0 || name === 'POLYLINE') flags |= 128;
		if (flags & 64) bytes.write('byte', '0');
		if (flags & 1) bytes.write('byte', value(record, 62));
		if (flags & 2) this.field(record, bytes, false, 6, 'short', 'LTYPE');
		if (flags & 4) bytes.write('double', value(record, 30));
		if (flags & 8) bytes.write('double', value(record, 39));
		let handleNumber = parseInt(value(record, 5, '0'), 16);
		if (!handleNumber || this.writtenHandles.has(handleNumber)) handleNumber = this.nextHandle++;
		this.writtenHandles.add(handleNumber);
		const handle = handleNumber.toString(16);
		const hex = handle.length % 2 ? '0' + handle : handle;
		bytes.write('byte', String(hex.length / 2));
		for (let i = 0; i < hex.length; i += 2) bytes.write('byte', String(parseInt(hex.slice(i, i + 2), 16)));
		const opts = this.geometry(name, record, bytes, false, 0, flags);
		if (bytes.position + 2 > 65535) throw new Error('R12 entity record exceeds 65535 bytes.');
		bytes.data[0] = type; bytes.data[1] = flags;
		bytes.view.setUint16(2, bytes.position + 2, true);
		bytes.view.setInt16(4, this.tables.get('LAYER')?.findIndex(r => value(r, 2) === value(record, 8, '0')) ?? 0, true);
		bytes.view.setUint16(6, opts, true);
		return checked(bytes.data.subarray(0, bytes.position));
	}
	private patchSequenceAddresses(records: RecordData[], encoded: Uint8Array[], base: number): void {
		let offset = base, begin = base;
		for (let i = 0; i < records.length; i++) {
			const name = value(records[i], 0), bytes = encoded[i];
			if (name === 'POLYLINE' || name === 'INSERT') begin = offset;
			if (name === 'SEQEND') {
				const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
				view.setUint32(bytes.length - 6, begin, true);
				view.setUint16(bytes.length - 2, CRC.applyCrc8(0xc0c1, bytes.subarray(0, -2)), true);
			}
			offset += bytes.length;
		}
	}
	private decode(data: Uint8Array, strict: boolean, warn: (message: string) => void): RecordData[] {
		const result: RecordData[] = [];
		for (let offset = 0; offset < data.length;) {
			if (offset + 4 > data.length) throw new Error('Truncated R12 entity header.');
			const view = new DataView(data.buffer, data.byteOffset + offset, data.length - offset), size = view.getUint16(2, true);
			if (size < 10 || offset + size > data.length) throw new Error('Invalid R12 entity record size at ' + offset);
			const raw = data.subarray(offset, offset + size); offset += size;
			if (this.checkCrc && CRC.applyCrc8(0xc0c1, raw.subarray(0, -2)) !== view.getUint16(size - 2, true)) throw new Error('R12 entity CRC mismatch.');
			const type = raw[0] & 127; if (raw[0] & 128) continue;
			const name = Object.keys(types).find(n => types[n] === type);
			if (!name) { const message = 'Unsupported R12 DWG entity type ' + type; if (strict) throw new Error(message); warn(message); continue; }
			const record: RecordData = [[0, name]], bytes = new Bytes(raw.subarray(0, -2), this.encoding); bytes.position = 8;
			const flags = raw[1], opts = view.getUint16(6, true);
			record.push([8, value(this.tables.get('LAYER')?.[view.getUint16(4, true)] ?? [], 2, '0')]);
			try {
				let extra = 0;
				if (flags & 64) { extra = Number(bytes.read('byte')); record.push([67, '1']); }
				if (extra & 2) { const length = Number(bytes.read('short')); bytes.position += length; warn('R12 extended entity data is not retained.'); }
				if (flags & 1) this.field(record, bytes, true, 62, 'byte');
				if (flags & 2) this.field(record, bytes, true, 6, 'short', 'LTYPE');
				if (flags & 4 && !['LINE', 'POINT', '3DFACE'].includes(name)) this.field(record, bytes, true, 30, 'double');
				if (flags & 8) this.field(record, bytes, true, 39, 'double');
				if (flags & 32) {
					const length = Number(bytes.read('byte')); let handle = '';
					for (let i = 0; i < length; i++) handle += Number(bytes.read('byte')).toString(16).padStart(2, '0');
					record.push([5, handle]);
				}
				if (extra & 4) bytes.read('short');
				if (name === 'POLYLINE' && opts & 0x8000) throw new Error('R12 overflow polylines are unsupported.');
				this.geometry(name, record, bytes, true, opts, flags);
				if (bytes.position > raw.length - 2) throw new Error('Truncated R12 ' + name + ' record.');
				result.push(record);
			} catch (error) { if (strict) throw error; warn(String(error)); }
		}
		return result;
	}
	read(data: Uint8Array, strict: boolean, warn: (message: string) => void, checkCrc = false): CadDocument {
		this.checkCrc = checkCrc;
		if (data.length < 0x6bf) throw new Error('Truncated R12 DWG header.');
		const view = new DataView(data.buffer, data.byteOffset, data.length);
		const range = (start: number, size: number) => {
			if (start < 0 || size < 0 || start + size > data.length) throw new Error('Invalid R12 DWG section bounds.');
			return data.subarray(start, start + size);
		};
		const crcPosition = view.getUint32(20, true) - 18;
		if (crcPosition !== 0x6bd && crcPosition !== 0x6bb) throw new Error('Unsupported R12 header layout.');
		if (this.checkCrc && CRC.applyCrc8(0xc0c1, data.subarray(0, crcPosition)) !== view.getUint16(crcPosition, true)) throw new Error('R12 header CRC mismatch.');
		for (const [name, header] of Object.entries(tableHeaders)) {
			const size = view.getUint16(header, true), count = view.getUint16(header + 2, true), start = view.getUint32(header + 6, true);
			const records: RecordData[] = []; this.tables.set(name, records);
			if (count && size < 35) throw new Error('Invalid R12 table record size.');
			const table = range(start, count * size);
			for (let i = 0; i < count; i++) {
				const raw = table.subarray(i * size, (i + 1) * size);
				if (this.checkCrc && CRC.applyCrc8(0xc0c1, raw.subarray(0, -2)) !== new DataView(raw.buffer, raw.byteOffset).getUint16(size - 2, true)) throw new Error('R12 ' + name + ' CRC mismatch.');
				const end = raw.subarray(1, 33).indexOf(0), record: RecordData = [[0, name], [2, decodeCadString(raw.subarray(1, end < 0 ? 33 : end + 1), this.encoding)], [70, String(raw[0] & 127)]];
				if (name === 'BLOCK') {
					let blockName = value(record, 2);
					if (/^\*[A-Z]$/i.test(blockName) || records.some(r => value(r, 2) === blockName)) blockName += i;
					record[1][1] = blockName;
				}
				const bytes = new Bytes(raw, this.encoding); bytes.position = 35;
				if (name === 'BLOCK') this.blockOffsets.push(bytes.view.getUint32(35, true) & 0x3fffffff);
				if (name === 'LAYER') { this.field(record, bytes, true, 62, 'short'); this.field(record, bytes, true, 6, 'short', 'LTYPE'); }
				if (name === 'STYLE') {
					for (const c of [40, 41, 50]) this.field(record, bytes, true, c, 'double');
					this.field(record, bytes, true, 71, 'byte'); this.field(record, bytes, true, 42, 'double');
					record.push([3, decodeCadString(raw.subarray(68, 132), this.encoding).replace(/\0.*$/, '')], [4, decodeCadString(raw.subarray(132, 196), this.encoding).replace(/\0.*$/, '')]);
				}
				if (name === 'LTYPE') {
					record.push([3, decodeCadString(raw.subarray(35, 83), this.encoding).replace(/\0.*$/, '')], [72, String(raw[83])], [73, String(raw[84])]);
					bytes.position = 85; this.field(record, bytes, true, 40, 'double');
					for (let j = 0; j < Math.min(raw[84], 12); j++) this.field(record, bytes, true, 49, 'double');
				}
				if (!(raw[0] & 128)) records.push(record); else records.push([[0, name], [2, '']]);
			}
		}
		// LAYER references precede LTYPE on disk; resolve them after all tables exist.
		for (const record of this.tables.get('LAYER') ?? []) {
			const i = (this.tables.get('LAYER') ?? []).indexOf(record), h = tableHeaders.LAYER;
			const p = view.getUint32(h + 6, true) + i * view.getUint16(h, true) + 37;
			const ref = value(this.tables.get('LTYPE')?.[view.getUint16(p, true)] ?? [], 2, 'CONTINUOUS');
			const pair = record.find(p => p[0] === 6); if (pair) pair[1] = ref;
		}
		const model = this.decode(range(view.getUint32(20, true), view.getUint32(24, true) - view.getUint32(20, true)), strict, warn);
		const blockStart = view.getUint32(28, true), blockSize = view.getUint32(32, true) & 0x3fffffff;
		const blocks: RecordData[] = [];
		for (let i = 0; i < this.blockOffsets.length; i++) {
			const start = this.blockOffsets[i], end = i + 1 < this.blockOffsets.length ? this.blockOffsets[i + 1] : blockSize;
			if (!value(this.tables.get('BLOCK')?.[i] ?? [], 2)) continue;
			const records = this.decode(range(blockStart + start, end - start), strict, warn);
			const begin = records.find(r => value(r, 0) === 'BLOCK');
			if (begin) {
				for (let p = begin.length - 1; p >= 0; p--) if (begin[p][0] === 2) begin.splice(p, 1);
				begin.push([2, value(this.tables.get('BLOCK')![i], 2)]); blocks.push(...records);
			}
		}
		const pairs: Pair[] = [[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1009'], [9, '$DWGCODEPAGE'], [3, 'ANSI_1252']];
		for (const [name, offset, codes, type] of headerFields) {
			const bytes = new Bytes(data); bytes.position = offset; pairs.push([9, name]);
			for (const code of codes) pairs.push([code, bytes.read(type)]);
		}
		pairs.push([0, 'ENDSEC'], [0, 'SECTION'], [2, 'TABLES']);
		for (const [name, records] of this.tables) {
			if (!['LAYER', 'LTYPE', 'STYLE', 'APPID'].includes(name)) continue;
			pairs.push([0, 'TABLE'], [2, name], [70, String(records.length)], ...records.filter(r => value(r, 2)).flat(), [0, 'ENDTAB']);
		}
		pairs.push([0, 'ENDSEC'], [0, 'SECTION'], [2, 'BLOCKS'], ...blocks.flat(), [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES'], ...model.flat(), [0, 'ENDSEC'], [0, 'EOF']);
		const document = DxfReader.readFromStream(encodeCadString(pairs.map(([c, v]) => c + '\n' + v + '\n').join(''), this.encoding));
		document.header.version = ACadVersion.AC1009;
		originalHeaders.set(document, data.slice(0, crcPosition)); return document;
	}
	write(document: CadDocument, notification?: NotificationEventHandler): Uint8Array {
		const chunks: string[] = [];
		DxfWriter.writeToStream({ write: (v: string) => chunks.push(v) }, document, false, undefined, notification);
		const lines = chunks.join('').split(/\r?\n/), records: RecordData[] = [];
		let current: RecordData = [];
		for (let i = 0; i + 1 < lines.length; i += 2) {
			const code = Number(lines[i]), v = lines[i + 1];
			if (code === 0) { if (current.length) records.push(current); current = []; }
			current.push([code, v]);
		}
		if (current.length) records.push(current);
		if (records.some(r => r.some(p => p[0] >= 1000))) notification?.(this,
			new NotificationEventArgs('R12 DWG extended entity data is not retained.', NotificationType.NotSupported));
		this.nextHandle = Math.max(0, ...records.flat().filter(p => p[0] === 5).map(p => parseInt(p[1], 16) || 0)) + 1;
		const sections = new Map<string, RecordData[]>(); let section = '', table = '';
		for (const record of records) {
			const name = value(record, 0);
			if (name === 'SECTION') { section = value(record, 2); sections.set(section, []); }
			else if (name === 'TABLE') { table = value(record, 2); this.tables.set(table, []); }
			else if (name === 'ENDTAB') table = '';
			else if (name !== 'ENDSEC' && name !== 'EOF') { if (table) this.tables.get(table)!.push(record); else sections.get(section)?.push(record); }
		}
		const blockRecords = sections.get('BLOCKS') ?? [], blocks = blockRecords.filter(r => value(r, 0) === 'BLOCK'); this.tables.set('BLOCK', blocks);
		this.tables.set('LTYPE', (this.tables.get('LTYPE') ?? []).filter(r => !['BYLAYER', 'BYBLOCK'].includes(value(r, 2).toUpperCase())));
		const template = r12Template(), tv = new DataView(template.buffer), header = template.slice(0, 0x6cf), hv = new DataView(header.buffer);
		const original = originalHeaders.get(document); if (original) header.set(original);
		hv.setUint16(17, 205, true); hv.setUint32(20, header.length, true);
		const headerRecord = records.find(r => value(r, 0) === 'SECTION' && value(r, 2) === 'HEADER') ?? [];
		for (const [name, offset, codes, type] of headerFields) {
			const start = headerRecord.findIndex(p => p[0] === 9 && p[1] === name);
			if (start < 0) continue;
			let end = start + 1; while (end < headerRecord.length && headerRecord[end][0] !== 9) end++;
			const record = headerRecord.slice(start + 1, end), bytes = new Bytes(header); bytes.position = offset;
			for (const code of codes) bytes.write(type, value(record, code, '0'));
		}
		const result: Uint8Array[] = [header]; let position = header.length;
		const append = (b: Uint8Array) => { result.push(b); position += b.length; };
		const entities = sections.get('ENTITIES') ?? [], encodedEntities = entities.map(r => this.encode(r));
		this.patchSequenceAddresses(entities, encodedEntities, header.length);
		const entityData = concat(encodedEntities);
		append(entityData); hv.setUint32(24, position, true); append(template.subarray(0x6cf, 0x6df));
		const order = Object.entries(tableHeaders).sort((a, b) => tv.getUint32(a[1] + 6, true) - tv.getUint32(b[1] + 6, true));
		const blockBytes: Uint8Array[] = [];
		for (const record of blockRecords) {
			if (value(record, 0) === 'BLOCK') this.blockOffsets.push(blockBytes.reduce((sum, b) => sum + b.length, 0));
			blockBytes.push(this.encode(record));
		}
		for (const [name, h] of order) {
			const oldStart = tv.getUint32(h + 6, true), size = tv.getUint16(h, true), oldCount = tv.getUint16(h + 2, true);
			append(template.subarray(oldStart - 16, oldStart)); hv.setUint32(h + 6, position, true);
			const rows = this.tables.get(name);
			if (rows && ['BLOCK', 'LAYER', 'STYLE', 'LTYPE', 'APPID'].includes(name)) {
				if (rows.length > 32767) throw new Error('R12 table exceeds 32767 records.');
				hv.setUint16(h + 2, rows.length, true);
				for (let i = 0; i < rows.length; i++) {
					const row = rows[i], raw = new Uint8Array(size - 2), bytes = new Bytes(raw, this.encoding);
					if (encodeCadString(value(row, 2), this.encoding).length > 31) throw new Error('R12 table names must fit in 31 bytes.');
					raw[0] = number(row, 70); raw.set(encodeCadString(value(row, 2), this.encoding).subarray(0, 31), 1); bytes.position = 33; bytes.write('short', '-1');
					if (name === 'BLOCK') { bytes.write('long', String(this.blockOffsets[i])); bytes.write('short', '0'); bytes.write('short', '0'); }
					if (name === 'LAYER') { this.field(row, bytes, false, 62, 'short'); this.field(row, bytes, false, 6, 'short', 'LTYPE'); }
					if (name === 'STYLE') {
						for (const c of [40, 41, 50]) this.field(row, bytes, false, c, 'double');
						this.field(row, bytes, false, 71, 'byte'); this.field(row, bytes, false, 42, 'double');
						raw.set(encodeCadString(value(row, 3), this.encoding).subarray(0, 63), 68); raw.set(encodeCadString(value(row, 4), this.encoding).subarray(0, 63), 132);
					}
					if (name === 'LTYPE') {
						raw.set(encodeCadString(value(row, 3), this.encoding).subarray(0, 47), 35); bytes.position = 83;
						this.field(row, bytes, false, 72, 'byte'); this.field(row, bytes, false, 73, 'byte'); this.field(row, bytes, false, 40, 'double');
						const dashes = row.filter(p => p[0] === 49); if (dashes.length > 12) throw new Error('R12 linetypes support at most 12 dashes.');
						for (const [, dash] of dashes) bytes.write('double', dash);
					}
					append(checked(raw));
				}
			} else append(template.subarray(oldStart, oldStart + size * oldCount));
			append(template.subarray(oldStart + size * oldCount, oldStart + size * oldCount + 16));
		}
		const oldBlock = tv.getUint32(28, true);
		append(template.subarray(oldBlock - 16, oldBlock)); hv.setUint32(28, position, true);
		this.patchSequenceAddresses(blockRecords, blockBytes, position);
		const encodedBlocks = concat(blockBytes); append(encodedBlocks); hv.setUint32(32, 0x40000000 + encodedBlocks.length, true);
		append(template.subarray(oldBlock, oldBlock + 16));
		// No extra-entity overflow section is needed; records are written inline.
		const oldExtraEnd = template.length - 170;
		append(template.subarray(oldBlock + 16, oldExtraEnd));
		hv.setUint32(36, position - 16, true);
		const auxStart = position;
		const aux = template.slice(oldExtraEnd); const av = new DataView(aux.buffer);
		hv.setBigUint64(0x4ee, BigInt(this.nextHandle), true); av.setBigUint64(38, BigInt(this.nextHandle), true);
		av.setUint32(20, header.length, true); av.setUint32(24, header.length + entityData.length, true);
		av.setUint32(28, hv.getUint32(28, true), true); av.setUint32(32, hv.getUint32(36, true), true);
		const auxTables = ['BLOCK', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'VPORT', 'APPID', 'DIMSTYLE', 'VX'];
		for (let i = 0; i < auxTables.length; i++) {
			const h = tableHeaders[auxTables[i]], p = 48 + i * 10;
			av.setUint16(p + 2, hv.getUint16(h, true), true); av.setUint16(p + 4, hv.getUint16(h + 2, true), true);
			av.setUint32(p + 6, hv.getUint32(h + 6, true), true);
		}
		av.setUint32(aux.length - 22, auxStart, true);
		av.setUint16(aux.length - 18, CRC.applyCrc8(0xc0c1, aux.subarray(16, aux.length - 18)), true);
		hv.setUint16(0x6bd, CRC.applyCrc8(0xc0c1, header.subarray(0, 0x6bd)), true);
		append(aux); return concat(result);
	}
}
