import { Surface } from './Surface.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { DxfClass } from '../Classes/DxfClass.js';
import { ACadVersion } from '../ACadVersion.js';
import { ProxyFlags } from '../Classes/ProxyFlags.js';

export class SweptSurface extends Surface {
	override getDxfClass(): DxfClass {
		const definition = new DxfClass();
		definition.cppClassName = this.subclassMarker;
		definition.dxfName = this.objectName;
		definition.dwgVersion = 26 as ACadVersion;
		definition.itemClassId = 498;
		definition.proxyFlags = 0 as ProxyFlags;
		return definition;
	}
	override get objectName(): string { return DxfFileToken.entitySweptSurface; }
	override get subclassMarker(): string { return DxfSubclassMarker.sweptSurface; }
}
