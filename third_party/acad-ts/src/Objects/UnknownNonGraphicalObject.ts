import { NonGraphicalObject } from './NonGraphicalObject.js';
import { DxfClass } from '../Classes/DxfClass.js';
import { ObjectType } from '../Types/ObjectType.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import type { CadDocument } from '../CadDocument.js';
import type { CadObject } from '../CadObject.js';
import { DwgRawObjectData, DxfRawCode, IRawCadObject, registerRawOwnedObjects } from './RawObjectData.js';

type DxfClassLookupResult = { result: DxfClass | null; found: boolean };

export class UnknownNonGraphicalObject extends NonGraphicalObject implements IRawCadObject {
	override get objectType(): ObjectType {
		return ObjectType.UNDEFINED;
	}

	override get objectName(): string {
		if (!this.dxfClass) {
			return this.rawDxfName ?? 'UNKNOWN';
		}
		return this.dxfClass.dxfName;
	}

	rawDxfName: string | null = null;

	rawDxfCodes: DxfRawCode[] | null = null;

	rawDwgData: DwgRawObjectData | null = null;

	readonly rawOwnedObjects: CadObject[] = [];

	override get subclassMarker(): string {
		if (!this.dxfClass) {
			return DxfSubclassMarker.entity;
		}
		return this.dxfClass.cppClassName;
	}

	readonly dxfClass: DxfClass | null;

	constructor(dxfClass: DxfClass | DxfClassLookupResult | null) {
		super();
		this.dxfClass = dxfClass instanceof DxfClass ? dxfClass : dxfClass?.result ?? null;
	}

	override getDxfClass(): DxfClass | null {
		return this.dxfClass;
	}

	override assignDocument(doc: CadDocument): void {
		super.assignDocument(doc);
		registerRawOwnedObjects(this, doc);
	}
}
