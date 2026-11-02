import { Entity } from './Entity.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { BoundingBox } from '../Math/BoundingBox.js';
import { ObjectType } from '../Types/ObjectType.js';
import { XYZ } from '../Math/XYZ.js';

export class Solid extends Entity {
	firstCorner: XYZ = new XYZ(0, 0, 0);

	fourthCorner: XYZ = new XYZ(0, 0, 0);

	normal: XYZ = new XYZ(0, 0, 1);

	/**
	 * A TRACE: the same data as a SOLID (DXF reference, TRACE), kept apart so that a TRACE
	 * is written back as one.
	 */
	isTrace: boolean = false;

	override get objectName(): string {
		return this.isTrace ? DxfFileToken.entityTrace : DxfFileToken.entitySolid;
	}

	override get objectType(): ObjectType {
		return this.isTrace ? ObjectType.TRACE : ObjectType.SOLID;
	}

	secondCorner: XYZ = new XYZ(0, 0, 0);

	override get subclassMarker(): string {
		return DxfSubclassMarker.solid;
	}

	thickness: number = 0.0;

	thirdCorner: XYZ = new XYZ(0, 0, 0);

	constructor(first?: XYZ, second?: XYZ, third?: XYZ, fourth?: XYZ) {
		super();
		if (first) this.firstCorner = first;
		if (second) this.secondCorner = second;
		if (third) {
			this.thirdCorner = third;
			this.fourthCorner = fourth ?? third;
		}
	}

	override applyTransform(transform: unknown): void {
		this.firstCorner = this.applyTransformToPoint(transform, this.firstCorner);
		this.secondCorner = this.applyTransformToPoint(transform, this.secondCorner);
		this.thirdCorner = this.applyTransformToPoint(transform, this.thirdCorner);
		this.fourthCorner = this.applyTransformToPoint(transform, this.fourthCorner);
		this.normal = this.applyTransformToVector(transform, this.normal).normalize();
	}

	override getBoundingBox(): BoundingBox {
		return BoundingBox.fromPoints([
			this.firstCorner,
			this.secondCorner,
			this.thirdCorner,
			this.fourthCorner,
		]);
	}
}
