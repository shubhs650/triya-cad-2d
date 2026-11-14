import { Layer } from '../../Tables/Layer.js';
import { LineType } from '../../Tables/LineType.js';
import { Material } from '../../Objects/Material.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { NotificationType } from '../NotificationEventHandler.js';
import { CadTableEntryTemplate } from './CadTableEntryTemplate.js';

export class CadLayerTemplate extends CadTableEntryTemplate<Layer> {
	layerControlHandle: number = 0;

	plotStyleHandle: number = 0;

	materialHandle: number = 0;

	lineTypeHandle: number | null = null;

	lineTypeName: string | null = null;

	trueColorName: string | null = null;

	constructor(entry?: Layer) {
		super(entry ?? new Layer());
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);

		// The layer's plot style name (DWG R2000+; the DXF reader sets 390 on the layer itself):
		// upstream read the handle and dropped it.
		if (this.plotStyleHandle) this.cadObject.plotStyleName = this.plotStyleHandle;

		// The colour's name (DXF 430), a colour-book colour's `BOOK$COLOR`: upstream read it and dropped it.
		if (this.trueColorName) this.cadObject.trueColorName = this.trueColorName;

		// The layer's material (DXF 347, DWG R2007+): upstream looked it up and dropped it.
		const material = builder.tryGetCadObject<Material>(this.materialHandle);
		if (material instanceof Material) {
			this.cadObject.material = material;
		}

		const lineType = this.getTableReference(builder, this.lineTypeHandle, this.lineTypeName ?? '', LineType);
		if (lineType) {
			this.cadObject.lineType = lineType;
		} else {
			builder.notify(`Linetype with handle ${this.lineTypeHandle} could not be found for layer ${this.cadObject.name}`, NotificationType.Warning);
		}
	}
}
