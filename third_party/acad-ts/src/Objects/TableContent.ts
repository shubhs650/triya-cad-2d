import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ObjectType } from '../Types/ObjectType.js';

import { FormattedTableData } from './LinkedData.js';
import { TableStyle } from './TableStyle.js';
import type { DwgRawObjectData, DxfRawCode, IRawCadObject } from './RawObjectData.js';
import type { CadObject } from '../CadObject.js';

export class TableContent extends FormattedTableData implements IRawCadObject {
	/** DXF group codes as read, when the reader keeps them (`keepRawDxfPassthroughObjects`): the DXF writer has no field writer for this type. */
	rawDxfCodes: DxfRawCode[] | null = null;
	rawDxfName: string | null = null;
	rawDwgData: DwgRawObjectData | null = null;
	readonly rawOwnedObjects: CadObject[] = [];

	override get objectType(): ObjectType { return ObjectType.UNLISTED; }
	override get objectName(): string { return DxfFileToken.objectTableContent; }
	override get subclassMarker(): string { return DxfSubclassMarker.tableContent; }

	style: TableStyle | null = null;
	styleOverride: unknown = null;
}
