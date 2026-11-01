import { Solid3D } from '../../Entities/Solid3D.js';
import { CadObject } from '../../CadObject.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { CadEntityTemplateT } from './CadEntityTemplate.js';

export class CadSolid3DTemplate extends CadEntityTemplateT<Solid3D> {
	historyHandle: number | null = null;

	constructor(solid?: Solid3D) {
		super(solid ?? new Solid3D());
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);

		const history = builder.tryGetCadObject<CadObject>(this.historyHandle);
		if (history) {
			this.cadObject.history = history;
			history.owner ??= this.cadObject;
			if (this.cadObject.document != null && history.document == null) {
				this.cadObject.document.registerCollection(history);
			}
		}
	}
}
