import { AcdsSchema } from './AcdsSchema.js';
import { AcdsRecord } from './AcdsRecord.js';
import { AcdsSchemaProperty } from './AcdsSchemaProperty.js';
import { AcdsSchemaPropertyFlags } from './AcdsSchemaPropertyFlags.js';
import { ModelerGeometry } from '../Entities/ModelerGeometry.js';
import { AcdsRecordColumn } from './AcdsRecordColumn.js';

export class CadFileDataStorage {
	static readonly acDb3DSolidAsmData = 'AcDb3DSolid_ASM_Data';
	static readonly acDbDsId = 'AcDbDs::ID';
	static readonly asmData = 'ASM_Data';
	static readonly handleAttribute = 'AcDbDs::HandleAttribute';
	static readonly handleAttributeSchemaName = 'AcDbDs::HandleAttributeSchema';
	static readonly indexable = 'AcDs:Indexable';
	static readonly indexedPropertySchemaName = 'AcDbDs::IndexedPropertySchema';
	static readonly legacy = 'AcDbDs::Legacy';
	static readonly legacySchemaName = 'AcDbDs::LegacySchema';
	static readonly thumbnailData = 'Thumbnail_Data';
	static readonly thumbnailSchema = 'AcDb_Thumbnail_Schema';
	static readonly treatedAsObjectData = 'AcDbDs::TreatedAsObjectData';
	static readonly treatedAsObjectDataSchemaName = 'AcDbDs::TreatedAsObjectDataSchema';
	/** Compatibility alias for earlier readers. */
	static readonly id = CadFileDataStorage.acDbDsId;

	records: AcdsRecord[] = [];
	schemes: AcdsSchema[] = [];

	constructor(geometries?: Iterable<ModelerGeometry>) {
		if (!geometries) return;
		const names = CadFileDataStorage;
		this.addSchema(names.thumbnailSchema, [
			[names.acDbDsId, 10, 8], [names.thumbnailData, 15, 0], [names.treatedAsObjectData, 1, 1],
		]);
		this.addSchema(names.treatedAsObjectDataSchemaName, [[names.treatedAsObjectData, 1, 0]]);
		this.addSchema(names.legacySchemaName, [[names.legacy, 1, 0]]);
		this.addSchema(names.indexedPropertySchemaName, [[names.indexable, 1, 0]]);
		this.addSchema(names.handleAttributeSchemaName, [[names.handleAttribute, 1, 0]]);
		this.addSchema(names.acDb3DSolidAsmData, [[names.acDbDsId, 10, 8], [names.asmData, 15, 0]]);
		for (const geometry of geometries) {
			const record = new AcdsRecord();
			// Use the schema actually built above, rather than upstream's provisional zero index.
			record.index = this.schemes[this.schemes.length - 1].index;
			record.columns.set(CadFileDataStorage.acDbDsId, Object.assign(new AcdsRecordColumn(), {
				name: CadFileDataStorage.acDbDsId, dataType: 10, handle: geometry.handle,
			}));
			record.columns.set(CadFileDataStorage.asmData, Object.assign(new AcdsRecordColumn(), {
				name: CadFileDataStorage.asmData, dataType: 15, data: geometry.acisData,
			}));
			this.records.push(record);
		}
	}

	private addSchema(name: string, properties: [string, number, AcdsSchemaPropertyFlags][]): void {
		const schema = new AcdsSchema();
		schema.index = this.schemes.length;
		schema.name = name;
		schema.properties = properties.map(([name, type, propertyFlags]) =>
			Object.assign(new AcdsSchemaProperty(), { name, type, propertyFlags }));
		this.schemes.push(schema);
	}
}
