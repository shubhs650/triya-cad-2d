import { Dimension } from './Dimension.js';
import { DimensionType } from './DimensionType.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { BoundingBox } from '../Math/BoundingBox.js';
import { XYZ } from '../Math/XYZ.js';
import { ObjectType } from '../Types/ObjectType.js';

/**
 * Jogged radius dimension (DXF `LARGE_RADIAL_DIMENSION`, subclass `AcDbRadialDimensionLarge`).
 * The definition point (10) is the arc's centre, 15 the chord point on the arc, 13 the displaced
 * centre the dimension line starts from and 14 the jog point.
 */
export class DimensionRadialLarge extends Dimension {
	/** DXF 15: the point on the arc. */
	chordPoint: XYZ = new XYZ(0, 0, 0);
	/** DXF 13: the displaced centre the dimension line starts from. */
	overrideCenter: XYZ = new XYZ(0, 0, 0);
	/** DXF 14: the jog point. */
	jogPoint: XYZ = new XYZ(0, 0, 0);
	/** DXF 40. */
	leaderLength: number = 0;

	override get measurement(): number {
		const d = Dimension.subtractPoints(this.chordPoint, this.definitionPoint);
		return Math.sqrt(d.dot(d));
	}

	override get objectName(): string { return DxfFileToken.entityLargeRadialDimension; }
	override get objectType(): ObjectType { return ObjectType.UNLISTED; }
	override get subclassMarker(): string { return DxfSubclassMarker.radialDimensionLarge; }

	constructor() {
		// AutoCAD stores type 9 in 70 for a jogged radius dimension (169 = 9 | 32 | 128).
		super(9 as DimensionType);
	}

	override applyTransform(transform: unknown): void {
		super.applyTransform(transform);
		this.chordPoint = this.applyTransformToPoint(transform, this.chordPoint);
		this.overrideCenter = this.applyTransformToPoint(transform, this.overrideCenter);
		this.jogPoint = this.applyTransformToPoint(transform, this.jogPoint);
	}

	override getBoundingBox(): BoundingBox {
		return BoundingBox.fromPoints([this.definitionPoint, this.chordPoint, this.overrideCenter, this.jogPoint]);
	}
}
