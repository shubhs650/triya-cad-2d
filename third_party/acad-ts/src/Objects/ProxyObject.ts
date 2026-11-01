import { NonGraphicalObject } from './NonGraphicalObject.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ACadVersion } from '../ACadVersion.js';
import { DxfClass } from '../Classes/DxfClass.js';
import type { DwgRawObjectData, DxfRawCode, IRawCadObject } from './RawObjectData.js';
import type { CadObject } from '../CadObject.js';

export class ProxyObject extends NonGraphicalObject implements IRawCadObject {
	/** DXF group codes as read, when the reader keeps them (`keepRawDxfPassthroughObjects`): the DXF writer has no field writer for this type. */
	rawDxfCodes: DxfRawCode[] | null = null;
	rawDxfName: string | null = null;
	rawDwgData: DwgRawObjectData | null = null;
	readonly rawOwnedObjects: CadObject[] = [];

	get classId(): number {
		return this.dxfClass?.classNumber ?? 0;
	}

	get drawingFormat(): number {
		return (this.version as number) | (this.maintenanceVersion << 16);
	}

	dxfClass: DxfClass | null = null;
	maintenanceVersion: number = 0;

	override get objectName(): string {
		return DxfFileToken.objectProxyObject;
	}

	originalDataFormatDxf: boolean = false;
	readonly proxyClassId: number = 499;
	binaryData: Uint8Array | null = null;
	data: Uint8Array | null = null;

	override get subclassMarker(): string {
		return DxfSubclassMarker.proxyObject;
	}

	version: ACadVersion = ACadVersion.Unknown;
}
