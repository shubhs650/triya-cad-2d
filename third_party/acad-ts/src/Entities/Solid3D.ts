import { ModelerGeometry } from './ModelerGeometry.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ObjectType } from '../Types/ObjectType.js';
import type { CadDocument } from '../CadDocument.js';
import type { CadObject } from '../CadObject.js';

export class Solid3D extends ModelerGeometry {
	override get objectType(): ObjectType {
		return ObjectType.SOLID3D;
	}

	override get objectName(): string {
		return DxfFileToken.entity3DSolid;
	}

	override get subclassMarker(): string {
		return DxfSubclassMarker.solid3D;
	}

	/** The solid's history object (DXF 350 in AcDb3dSolid, R2007+). acad-ts does not map it; it is kept raw. */
	public history: CadObject | null = null;

	override assignDocument(doc: CadDocument): void {
		super.assignDocument(doc);
		if (this.history != null && this.history.document == null) {
			doc.registerCollection(this.history);
		}
	}
}
