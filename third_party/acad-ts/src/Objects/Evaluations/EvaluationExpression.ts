import { CadObject } from '../../CadObject.js';
import { DxfSubclassMarker } from '../../DxfSubclassMarker.js';
import { ObjectType } from '../../Types/ObjectType.js';
import type { DwgRawObjectData, DxfRawCode, IRawCadObject } from '../RawObjectData.js';

export abstract class EvaluationExpression extends CadObject implements IRawCadObject {
	// A DXF read keeps the group codes for the DXF writer, whose field writer drops data.
	rawDxfCodes: DxfRawCode[] | null = null;
	rawDxfName: string | null = null;
	rawDwgData: DwgRawObjectData | null = null;
	readonly rawOwnedObjects: CadObject[] = [];

	id: number = 0;

	override get objectType(): ObjectType { return ObjectType.UNLISTED; }
	override get subclassMarker(): string { return DxfSubclassMarker.evalGraphExpr; }

	value98: number = 0;
	value99: number = 0;
}
