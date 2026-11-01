import { ModelerGeometry } from './ModelerGeometry.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { DxfClass } from '../Classes/DxfClass.js';
import { ACadVersion } from '../ACadVersion.js';
import { ProxyFlags } from '../Classes/ProxyFlags.js';
import { ObjectType } from '../Types/ObjectType.js';

export class Surface extends ModelerGeometry {
	override getDxfClass(): DxfClass {
		const definition = new DxfClass();
		definition.cppClassName = this.subclassMarker;
		definition.dxfName = this.objectName;
		definition.dwgVersion = 26 as ACadVersion;
		definition.itemClassId = 498;
		definition.proxyFlags = 4095 as ProxyFlags;
		return definition;
	}
	override get objectName(): string { return DxfFileToken.entitySurface; }
	override get subclassMarker(): string { return DxfSubclassMarker.surface; }
	override get objectType(): ObjectType { return ObjectType.UNLISTED; }
	uIsolines: number = 0;
	vIsolines: number = 0;
}
