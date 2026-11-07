import { Entity } from '../../Entities/Entity.js';
import { BookColor } from '../../Objects/BookColor.js';
import { Material } from '../../Objects/Material.js';
import { Layer } from '../../Tables/Layer.js';
import { LineType } from '../../Tables/LineType.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { NotificationType } from '../NotificationEventHandler.js';
import { CadTemplateT } from './CadTemplate[T].js';
import { ProxyGeometryReader } from '../ProxyGeometryReader.js';

export class CadEntityTemplate extends CadTemplateT<Entity> {
	bookColorName: string | null = null;

	colorHandle: number | null = null;

	entityMode: number = 0;

	/** DXF 67 = 1: in paper space, for an entity that states no owner (R12). */
	isPaperSpace: boolean = false;

	layerHandle: number | null = null;

	layerName: string | null = null;

	lineTypeHandle: number | null = null;

	lineTypeName: string | null = null;

	ltypeFlags: number | null = null;

	materialHandle: number | null = null;

	/** DWG R2007+ material flags: 00 ByLayer, 01 ByBlock, 11 the handle above. */
	materialFlags: number | null = null;

	nextEntity: number | null = null;

	prevEntity: number | null = null;
	proxyGraphics: Uint8Array | null = null;

	constructor(entity: Entity) {
		super(entity);
	}

	setUnlinkedReferences(): void {
		if (this.layerName && this.layerName.length > 0) {
			this.cadObject.layer = new Layer(this.layerName);
		}

		if (this.lineTypeName && this.lineTypeName.length > 0) {
			this.cadObject.lineType = new LineType(this.lineTypeName);
		}
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);

		const layer = this.getTableReference(builder, this.layerHandle, this.layerName ?? '', Layer);
		if (layer) {
			this.cadObject.layer = layer;
		} else if (this.layerName && this.layerName.length > 0) {
			builder.notify(
				`Layer ${this.layerName} not found in the LAYER table, created for ${this.cadObject.constructor.name} with handle ${this.cadObject.handle}`,
				NotificationType.Warning,
			);
			this.cadObject.layer = builder.layers.tryAdd(new Layer(this.layerName));
		}

		switch (this.ltypeFlags) {
			case 0:
				this.lineTypeName = LineType.byLayerName;
				break;
			case 1:
				this.lineTypeName = LineType.byBlockName;
				break;
			case 2:
				this.lineTypeName = LineType.continuousName;
				break;
		}

		const ltype = this.getTableReference(builder, this.lineTypeHandle, this.lineTypeName ?? '', LineType);
		if (ltype) {
			this.cadObject.lineType = ltype;
		} else if (this.lineTypeName?.toUpperCase() === LineType.byBlockName.toUpperCase()) {
			// R12 files have no BYBLOCK LTYPE record, yet an entity names it in 6: it means ByBlock, as
			// BYLAYER means ByLayer (the default an entity already has). The document adds the entry.
			this.cadObject.lineType = LineType.byBlock;
		}

		const color = builder.tryGetCadObject<BookColor>(this.colorHandle);
		if (color) {
			this.cadObject.bookColor = color;
		} else if (this.bookColorName && this.bookColorName.length > 0 &&
			builder.documentToBuild != null &&
			builder.documentToBuild.colors != null) {
			const bookColor = builder.documentToBuild.colors.tryGet(this.bookColorName);
			if (bookColor) {
				this.cadObject.bookColor = bookColor;
			}
		}

		// The entity's material (DXF 347; DWG R2007+ by handle, or by flag for ByBlock): upstream
		// kept the handle and never assigned it, so every entity read without its material.
		const material = builder.tryGetCadObject<Material>(this.materialHandle);
		if (material instanceof Material) {
			this.cadObject.material = material;
		} else if (this.materialFlags === 1) {
			const byBlock = builder.findCadObject('material:BYBLOCK', o => o instanceof Material && o.name.toUpperCase() === 'BYBLOCK');
			if (byBlock instanceof Material) this.cadObject.material = byBlock;
		}

		if (this.proxyGraphics != null && !builder.ignoreProxyGraphics) {
			this.cadObject.proxyGeometries.push(...ProxyGeometryReader.readGeometries(this.proxyGraphics));
		}
	}
}

export class CadEntityTemplateT<T extends Entity = Entity> extends CadEntityTemplate {
	declare cadObject: T;

	constructor(entity: T) {
		super(entity);
	}
}
