import { CadObject } from '../../CadObject.js';
import { Entity } from '../../Entities/Entity.js';
import { Viewport } from '../../Entities/Viewport.js';
import { Layer } from '../../Tables/Layer.js';
import { UCS } from '../../Tables/UCS.js';
import { VisualStyle } from '../../Objects/VisualStyle.js';
import { XYZ } from '../../Math/XYZ.js';
import { XY } from '../../Math/XY.js';
import { ACadVersion } from '../../ACadVersion.js';
import { ExtendedDataControlString } from '../../XData/ExtendedDataControlString.js';
import { ExtendedDataCoordinate } from '../../XData/ExtendedDataCoordinate.js';
import { ExtendedDataInteger16 } from '../../XData/ExtendedDataInteger16.js';
import { ExtendedDataReal } from '../../XData/ExtendedDataReal.js';
import { ExtendedDataString } from '../../XData/ExtendedDataString.js';
import { ViewportStatusFlags } from '../../Entities/ViewportStatusFlags.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { NotificationType } from '../NotificationEventHandler.js';
import { CadEntityTemplateT } from './CadEntityTemplate.js';

export class CadViewportTemplate extends CadEntityTemplateT<Viewport> {
	viewportHeaderHandle: number | null = null;

	boundaryHandle: number | null = null;

	namedUcsHandle: number | null = null;

	baseUcsHandle: number | null = null;

	visualStyleHandle: number | null = null;

	viewportId: number | null = null;

	blockHandle: number | null = null;

	frozenLayerHandles: Set<number> = new Set();

	sunHandle: number | null = null;

	constructor(entity?: Viewport) {
		super(entity ?? new Viewport());
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);

		if (this.viewportId != null) {
			this.cadObject.id = this.viewportId;
		}

		if (builder.version < ACadVersion.AC1012) {
			this._readR12View();
		}

		const sun = builder.tryGetCadObject<CadObject>(this.sunHandle);
		if (sun) {
			this.cadObject.sun = sun;
			sun.owner ??= this.cadObject;
			if (this.cadObject.document != null && sun.document == null) {
				this.cadObject.document.registerCollection(sun);
			}
		}

		const entity = builder.tryGetCadObject<Entity>(this.boundaryHandle);
		if (entity) {
			this.cadObject.boundary = entity;
		} else if (this.boundaryHandle != null && this.boundaryHandle > 0) {
			builder.notify(`Boundary ${this.boundaryHandle} not found for viewport ${this.cadObject.handle}`, NotificationType.Warning);
		}

		const applyUcs = (ucs: UCS): void => {
			this.cadObject.ucsPerViewport = true;
			this.cadObject.ucsOrigin = new XYZ(ucs.origin.x, ucs.origin.y, ucs.origin.z);
			this.cadObject.ucsXAxis = new XYZ(ucs.xAxis.x, ucs.xAxis.y, ucs.xAxis.z);
			this.cadObject.ucsYAxis = new XYZ(ucs.yAxis.x, ucs.yAxis.y, ucs.yAxis.z);
			this.cadObject.ucsOrthographicType = ucs.orthographicType;
			this.cadObject.elevation = ucs.elevation;
		};

		const baseUcs = builder.tryGetCadObject<UCS>(this.baseUcsHandle);
		if (baseUcs) {
			applyUcs(baseUcs);
		} else if (this.baseUcsHandle != null && this.baseUcsHandle > 0) {
			builder.notify(`Base ucs ${this.baseUcsHandle} not found for viewport ${this.cadObject.handle}`, NotificationType.Warning);
		}

		const namedUcs = builder.tryGetCadObject<UCS>(this.namedUcsHandle);
		if (namedUcs) {
			applyUcs(namedUcs);
		} else if (this.namedUcsHandle != null && this.namedUcsHandle > 0) {
			builder.notify(`Named ucs ${this.namedUcsHandle} not found for viewport ${this.cadObject.handle}`, NotificationType.Warning);
		}

		const visualStyle = builder.tryGetCadObject<VisualStyle>(this.visualStyleHandle);
		if (visualStyle) {
			this.cadObject.visualStyle = visualStyle;
		} else if (this.visualStyleHandle != null && this.visualStyleHandle > 0) {
			builder.notify(`Visual style ${this.visualStyleHandle} not found for viewport ${this.cadObject.handle}`, NotificationType.Warning);
		}

		for (const handle of this.frozenLayerHandles) {
			const layer = builder.tryGetCadObject<Layer>(handle);
			if (layer) {
				this.cadObject.frozenLayers.push(layer);
			} else {
				builder.notify(`Frozen layer ${handle} not found for viewport ${this.cadObject.handle}`, NotificationType.Warning);
			}
		}
	}

	/**
	 * R12 states only a viewport's frame as groups (10, 40, 41, 68, 69). The view, snap and grid
	 * are in its ACAD xdata after the string MVIEW (DXF R12 reference, VIEWPORT): version, target,
	 * direction, twist, view height, view centre X and Y, lens length, front and back clip, then
	 * the 1070s view mode, circle zoom, fast zoom, UCSICON, snap, grid, snap style and isopair,
	 * the 1040s snap angle, snap base X/Y, snap spacing X/Y and grid spacing X/Y, the hidden-in-plot
	 * 1070, and a nested group of frozen layers. The xdata stays as read, so a save writes it back.
	 */
	private _readR12View(): void {
		let records = null;
		for (const [app, data] of this.cadObject.extendedData) {
			if (app.name.toUpperCase() === 'ACAD') records = data.records;
		}
		const start = records?.findIndex((r) => r instanceof ExtendedDataString && r.value.toUpperCase() === 'MVIEW') ?? -1;
		if (records == null || start < 0) return;

		const points: XYZ[] = [];
		const reals: number[] = [];
		const ints: number[] = [];
		let depth = 0;
		for (const r of records.slice(start + 1)) {
			if (r instanceof ExtendedDataControlString) {
				depth += r.isClosing ? -1 : 1;
				if (depth !== 1) break; // the frozen-layer group, or the end of MVIEW
			} else if (r instanceof ExtendedDataCoordinate) points.push(r.value);
			else if (r instanceof ExtendedDataReal) reals.push(r.value);
			else if (r instanceof ExtendedDataInteger16) ints.push(r.value);
		}
		if (points.length < 2 || reals.length < 7) return;

		const vp = this.cadObject;
		vp.viewTarget = new XYZ(points[0].x, points[0].y, points[0].z);
		vp.viewDirection = new XYZ(points[1].x, points[1].y, points[1].z);
		// xdata reals are stored as they are in memory, so the angles are in radians.
		vp.twistAngle = reals[0];
		vp.viewHeight = reals[1];
		vp.viewCenter = new XY(reals[2], reals[3]);
		vp.lensLength = reals[4];
		vp.frontClipPlane = reals[5];
		vp.backClipPlane = reals[6];
		if (reals.length >= 14) {
			vp.snapAngle = reals[7];
			vp.snapBase = new XY(reals[8], reals[9]);
			vp.snapSpacing = new XY(reals[10], reals[11]);
			vp.gridSpacing = new XY(reals[12], reals[13]);
		}
		if (ints.length >= 10) {
			const [, viewMode, circleZoom, fastZoom, ucsIcon, snap, grid, snapStyle, isoPair, hidden] = ints;
			vp.circleZoomPercent = circleZoom;
			// VIEWMODE bits 1-16 are the status bits of the same meaning; UCSICON bit 1 is on, 2 at origin.
			let status = viewMode & 0x1f;
			if (ucsIcon & 1) status |= ViewportStatusFlags.UcsIconVisibility;
			if (ucsIcon & 2) status |= ViewportStatusFlags.UcsIconAtOrigin;
			if (fastZoom) status |= ViewportStatusFlags.FastZoom;
			if (snap) status |= ViewportStatusFlags.SnapMode;
			if (grid) status |= ViewportStatusFlags.GridMode;
			if (snapStyle) status |= ViewportStatusFlags.IsometricSnapStyle;
			if (hidden) status |= ViewportStatusFlags.HidePlotMode;
			// SNAPISOPAIR: 0 left, 1 top, 2 right.
			if (isoPair === 1) status |= ViewportStatusFlags.IsoPairTop;
			if (isoPair === 2) status |= ViewportStatusFlags.IsoPairRight;
			vp.status = status as ViewportStatusFlags;
		}
	}
}
