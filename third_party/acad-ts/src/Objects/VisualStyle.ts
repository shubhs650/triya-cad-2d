import { NonGraphicalObject } from './NonGraphicalObject.js';
import { Color } from '../Color.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ObjectType } from '../Types/ObjectType.js';
import { EdgeStyleModel } from './EdgeStyleModel.js';
import { FaceColorMode } from './FaceColorMode.js';
import { FaceLightingModelType } from './FaceLightingModelType.js';
import { FaceLightingQualityType } from './FaceLightingQualityType.js';
import { FaceModifierType } from './FaceModifierType.js';

export class VisualStyle extends NonGraphicalObject {
	constructor(name?: string) {
		super(name);
	}

	brightness: number = 0;
	color: Color = Color.byLayer;
	description: string = '';
	displaySettings: number = 0;

	edgeApplyStyleFlag: number = 0;
	private _edgeColorValue: Color = Color.byBlock;
	get edgeColor(): number { return this._edgeColorValue.getApproxIndex(); }
	set edgeColor(value: number) { this._edgeColorValue = new Color(value); }
	get edgeColorValue(): Color { return this._edgeColorValue; }
	set edgeColorValue(value: Color) { this._edgeColorValue = value; }
	edgeCreaseAngle: number = 0;
	edgeIntersectionColor: Color = Color.byLayer;
	edgeIntersectionLineType: number = 0;
	edgeIsolineCount: number = 0;
	edgeJitter: number = 0;
	edgeModifiers: number = 0;
	edgeObscuredColor: Color = Color.byLayer;
	edgeObscuredLineType: number = 0;
	edgeOverhang: number = 0;
	edgeSilhouetteColor: Color = Color.byLayer;
	edgeSilhouetteWidth: number = 0;
	edgeStyle: number = 0;
	edgeStyleModel: EdgeStyleModel = EdgeStyleModel.NoEdges;
	edgeWidth: number = 0;

	faceColorMode: FaceColorMode = FaceColorMode.NoColor;
	faceLightingModel: FaceLightingModelType = FaceLightingModelType.Invisible;
	faceLightingQuality: FaceLightingQualityType = FaceLightingQualityType.NoLighting;
	faceModifiers: FaceModifierType = FaceModifierType.None;
	faceOpacityLevel: number = 0;
	faceSpecularLevel: number = 0;
	faceStyleMonoColor: Color = Color.byLayer;

	haloGap: number = 0;
	internalFlag: boolean = false;

	override get objectName(): string { return DxfFileToken.objectVisualStyle; }
	override get objectType(): ObjectType { return ObjectType.UNLISTED; }

	opacityLevel: number = 0;
	precisionFlag: boolean = false;
	rasterFile: string = '';
	shadowType: number = 0;

	override get subclassMarker(): string { return DxfSubclassMarker.visualStyle; }

	type: number = 0;

	/** DWG operation codes and version-specific properties retained during rewrites. */
	dwgLightingModel: number = 2;
	dwgLegacyUnknown: number = 0;
	dwgPropertyOperations: number[] = [];
	dwgExtendedProperties: { value: number | boolean | string | Color; operation: number }[] = [];

	override clone(): VisualStyle {
		const clone = super.clone() as VisualStyle;
		clone.dwgPropertyOperations = [...this.dwgPropertyOperations];
		clone.dwgExtendedProperties = this.dwgExtendedProperties.map(property => ({ ...property }));
		return clone;
	}

	static readonly defaultName = '2dWireframe';
}
