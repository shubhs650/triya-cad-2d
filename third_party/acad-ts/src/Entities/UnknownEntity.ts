import { Entity } from './Entity.js';
import { DxfClass } from '../Classes/DxfClass.js';
import { ObjectType } from '../Types/ObjectType.js';
import type { BoundingBox } from '../Math/BoundingBox.js';
import type { CadDocument } from '../CadDocument.js';
import type { CadObject } from '../CadObject.js';
import { DwgRawObjectData, DxfRawCode, IRawCadObject, registerRawOwnedObjects } from '../Objects/RawObjectData.js';

type DxfClassLookupResult = { result: DxfClass | null; found: boolean };

export class UnknownEntity extends Entity implements IRawCadObject {
	override get objectType(): ObjectType {
		return ObjectType.UNDEFINED;
	}

	override get objectName(): string {
		return this._objectName || this.rawDxfName || '';
	}

	rawDxfName: string | null = null;

	rawDxfCodes: DxfRawCode[] | null = null;

	rawDwgData: DwgRawObjectData | null = null;

	readonly rawOwnedObjects: CadObject[] = [];

	private _dxfClass: DxfClass | null;

	override get subclassMarker(): string {
		return this._subclassMarker;
	}

	private _objectName: string;
	private _subclassMarker: string;

	constructor(dxfClass?: DxfClass | DxfClassLookupResult | null) {
		super();
		const resolvedClass = dxfClass instanceof DxfClass
			? dxfClass
			: dxfClass?.result ?? null;
		this._dxfClass = resolvedClass;
		if (resolvedClass) {
			this._objectName = resolvedClass.dxfName || '';
			this._subclassMarker = resolvedClass.cppClassName || '';
		} else {
			this._objectName = '';
			this._subclassMarker = '';
		}
	}

	override getDxfClass(): DxfClass | null {
		return this._dxfClass;
	}

	override assignDocument(doc: CadDocument): void {
		super.assignDocument(doc);
		registerRawOwnedObjects(this, doc);
	}

	override applyTransform(transform: unknown): void {
		// No-op
	}

	override getBoundingBox(): BoundingBox | null {
		return null;
	}
}
