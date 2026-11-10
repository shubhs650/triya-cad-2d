import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ObjectType } from '../Types/ObjectType.js';
import { NonGraphicalObject } from './NonGraphicalObject.js';

export class WipeoutVariables extends NonGraphicalObject {
	/** DXF 70, WIPEOUTFRAME: 0 frames off, 1 shown and plotted, 2 shown but not plotted. */
	displayImageFrame: number = 0;

	override get objectName(): string { return DxfFileToken.objectWipeoutVariables; }
	override get objectType(): ObjectType { return ObjectType.UNLISTED; }
	override get subclassMarker(): string { return DxfSubclassMarker.wipeoutVariables; }
}
