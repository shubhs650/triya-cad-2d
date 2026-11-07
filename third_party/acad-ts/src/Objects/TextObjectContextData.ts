import { AnnotScaleObjectContextData } from './AnnotScaleObjectContextData.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { XY } from '../Math/XY.js';

/**
 * The representation of an annotative TEXT (or single-line attribute) at one annotation scale
 * (`ACDB_TEXTOBJECTCONTEXTDATA_CLASS`, AcDbTextObjectContextData), kept in the
 * `ACDB_ANNOTATIONSCALES` dictionary of the entity's `AcDbContextDataManager`. Points are OCS,
 * as the TEXT's own 10 and 11.
 */
export class TextObjectContextData extends AnnotScaleObjectContextData {
	/** DXF 70 after the scale: the horizontal alignment (the TEXT's 72). */
	horizontalMode: number = 0;
	/** DXF 50, radians. */
	rotation: number = 0;
	/** DXF 10/20: the first alignment point. */
	insertionPoint: XY = new XY(0, 0);
	/** DXF 11/21: the second alignment point. */
	alignmentPoint: XY = new XY(0, 0);

	override get objectName(): string {
		return DxfFileToken.textObjectContextData;
	}
}
