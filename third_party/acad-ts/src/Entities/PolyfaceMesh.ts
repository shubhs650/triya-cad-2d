import { Polyline } from './Polyline.js';
import type { CadDocument } from '../CadDocument.js';
import { CadObject } from '../CadObject.js';
import { CadObjectCollection } from '../CadObjectCollection.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import type { BoundingBox } from '../Math/BoundingBox.js';
import { ObjectType } from '../Types/ObjectType.js';
import { PolylineFlags } from './PolylineFlags.js';
import { VertexFaceMesh } from './VertexFaceMesh.js';
import { VertexFaceRecord } from './VertexFaceRecord.js';

export class PolyfaceMesh extends Polyline {
	faces: VertexFaceRecord[] = [];

	override get flags(): PolylineFlags {
		return super.flags | PolylineFlags.PolyfaceMesh;
	}
	override set flags(value: PolylineFlags) {
		super.flags = value;
	}

	override get objectName(): string {
		return DxfFileToken.entityPolyline;
	}

	override get objectType(): ObjectType {
		return ObjectType.POLYLINE_PFACE;
	}

	override get subclassMarker(): string {
		return DxfSubclassMarker.polyfaceMesh;
	}

	override clone(): CadObject {
		const clone = super.clone() as PolyfaceMesh;
		clone.faces = this.faces.map(f => f.clone() as VertexFaceRecord);
		return clone;
	}
	override getBoundingBox(): BoundingBox | null {
		return super.getBoundingBox();
	}

	/** @internal Faces are held like vertices (see Polyline). */
	override assignHeldChildren(doc: CadDocument): void {
		super.assignHeldChildren(doc);
		for (const face of this.faces) {
			if (face.document == null) face.assignDocument(doc);
		}
	}

	/** @internal */
	override unassignDocument(): void {
		for (const face of this.faces) face.unassignDocument();
		super.unassignDocument();
	}
}
