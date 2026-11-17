import { NonGraphicalObject } from './NonGraphicalObject.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ImageDisplayQuality } from './ImageDisplayQuality.js';

export class RasterVariables extends NonGraphicalObject {
	classVersion: number = 0;
	displayQuality: ImageDisplayQuality = ImageDisplayQuality.High;
	/** DXF 70, IMAGEFRAME: 0 frames off, 1 shown and plotted, 2 shown but not plotted. */
	isDisplayFrameShown: number = 0;

	override get objectName(): string {
		return DxfFileToken.objectRasterVariables;
	}

	override get subclassMarker(): string {
		return DxfSubclassMarker.rasterVariables;
	}

	units: number = 0;
}

export { ImageDisplayQuality } from './ImageDisplayQuality.js';
