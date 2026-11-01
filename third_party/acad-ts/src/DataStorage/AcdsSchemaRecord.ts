import { SchemaRecordFlags } from './SchemaRecordFlags.js';

export class AcdsSchemaRecord {
	static readonly typeSizes = [0, 0, 2, 1, 2, 4, 8, 1, 2, 4, 8, 4, 8, 0, 0, 0];
	flags: SchemaRecordFlags = SchemaRecordFlags.None;
	nameIndex: number = 0;
	type: number = 0;
	typeSize: number = 0;
	unknown1: number = 0;
	unknown2: number = 0;
	values: Uint8Array[] = [];
	id: number = 0;
	index: number = 0;
	name: string = '';
	value291: number = 0;
}
