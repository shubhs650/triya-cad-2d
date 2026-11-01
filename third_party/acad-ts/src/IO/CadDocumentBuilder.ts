import { ACadVersion } from '../ACadVersion.js';
import { CadDocument } from '../CadDocument.js';
import { CadObject } from '../CadObject.js';
import { UnknownEntity } from '../Entities/UnknownEntity.js';
import { CadDictionary } from '../Objects/CadDictionary.js';
import { UnknownNonGraphicalObject } from '../Objects/UnknownNonGraphicalObject.js';
import { addRawOwnedObject } from '../Objects/RawObjectData.js';
import { XRecord } from '../Objects/XRecrod.js';
import { AppId } from '../Tables/AppId.js';
import { BlockRecord } from '../Tables/BlockRecord.js';
import { DimensionStyle } from '../Tables/DimensionStyle.js';
import { Layer } from '../Tables/Layer.js';
import { LineType } from '../Tables/LineType.js';
import { TableEntry } from '../Tables/TableEntry.js';
import { TextStyle } from '../Tables/TextStyle.js';
import { UCS } from '../Tables/UCS.js';
import { View } from '../Tables/View.js';
import { VPort } from '../Tables/VPort.js';
import { Table } from '../Tables/Collections/Table.js';
import { AppIdsTable } from '../Tables/Collections/AppIdsTable.js';
import { BlockRecordsTable } from '../Tables/Collections/BlockRecordsTable.js';
import { DimensionStylesTable } from '../Tables/Collections/DimensionStylesTable.js';
import { LayersTable } from '../Tables/Collections/LayersTable.js';
import { LineTypesTable } from '../Tables/Collections/LineTypesTable.js';
import { TextStylesTable } from '../Tables/Collections/TextStylesTable.js';
import { UCSTable } from '../Tables/Collections/UCSTable.js';
import { ViewsTable } from '../Tables/Collections/ViewsTable.js';
import { VPortsTable } from '../Tables/Collections/VPortsTable.js';
import { NotificationEventHandler, NotificationEventArgs, NotificationType } from './NotificationEventHandler.js';
import { ICadObjectTemplate } from './Templates/ICadObjectTemplate.js';
import { ICadDictionaryTemplate } from './Templates/ICadDictionaryTemplate.js';
import { ICadTableEntryTemplate } from './Templates/ICadTableEntryTemplate.js';
import { ICadTableTemplate } from './Templates/ICadTableTemplate.js';
import { CadTemplate } from './Templates/CadTemplate.js';
import { CadFileDataStorage } from '../DataStorage/CadFileDataStorage.js';
import { CadObjectData, ProgressEventArgs, ProgressEventHandler, ReadStage } from './ProgressEventHandler.js';
import { ModelerGeometry } from '../Entities/ModelerGeometry.js';

export abstract class CadDocumentBuilder {
	onNotification: NotificationEventHandler | null = null;
	onProgress: ProgressEventHandler | null = null;

	appIds: AppIdsTable = new AppIdsTable();
	blockRecords: BlockRecordsTable = new BlockRecordsTable();
	dataStorage: CadFileDataStorage | null = null;
	dimensionStyles: DimensionStylesTable = new DimensionStylesTable();
	documentToBuild: CadDocument;
	initialHandSeed: number = 0;

	abstract get keepUnknownEntities(): boolean;
	abstract get keepUnknownNonGraphicalObjects(): boolean;
	abstract get ignoreProxyGraphics(): boolean;

	layers: LayersTable = new LayersTable();
	lineTypesTable: LineTypesTable = new LineTypesTable();
	textStyles: TextStylesTable = new TextStylesTable();
	ucSs: UCSTable = new UCSTable();
	version: ACadVersion;
	views: ViewsTable = new ViewsTable();
	vPorts: VPortsTable = new VPortsTable();

	protected cadObjects: Map<number, CadObject> = new Map();
	protected cadObjectsTemplates: Map<number, ICadObjectTemplate> = new Map();
	protected dictionaryTemplates: Map<number, ICadDictionaryTemplate> = new Map();
	protected tableEntryTemplates: Map<number, ICadTableEntryTemplate> = new Map();
	protected tableTemplates: Map<number, ICadTableTemplate> = new Map();
	protected templatesMap: Map<number, ICadObjectTemplate> = new Map();
	protected unassignedObjects: ICadObjectTemplate[] = [];

	constructor(version: ACadVersion, document: CadDocument) {
		this.version = version;
		this.documentToBuild = document;
	}

	addTemplate(template: ICadObjectTemplate): void {
		this.notifyProgress(ReadStage.Read, template.cadObject);
		if (!this._addToMap(template)) {
			return;
		}

		const handle = template.cadObject.handle;

		if (this._isDictionaryTemplate(template)) {
			this.dictionaryTemplates.set(handle, template);
		} else if (this._isTableTemplate(template)) {
			this.tableTemplates.set(handle, template);
		} else if (this._isTableEntryTemplate(template)) {
			this.tableEntryTemplates.set(handle, template);
		} else {
			this.cadObjectsTemplates.set(handle, template);
		}
	}

	buildDocument(): void {
		for (const template of this.tableEntryTemplates.values()) {
			template.build(this);
		}

		for (const template of this.cadObjectsTemplates.values()) {
			(template as CadTemplate).build(this);
		}

		this._attachRawOwnedObjects();
	}

	/**
	 * An object owned by an unknown object is referenced only from the owner's raw payload, so no
	 * collection registers it and the writers never reach it. Attach it to its raw owner instead.
	 */
	private _attachRawOwnedObjects(): void {
		const ownedByXRecords: CadObject[] = [];
		for (const template of this.templatesMap.values()) {
			const child = template.cadObject;
			const ownerHandle = (template as CadTemplate).ownerHandle;
			if (child.document != null || ownerHandle == null || ownerHandle === 0) {
				continue;
			}

			const owner = this.tryGetCadObject<CadObject>(ownerHandle);
			if ((owner instanceof UnknownNonGraphicalObject || owner instanceof UnknownEntity) && owner.xDictionary !== child) {
				addRawOwnedObject(owner, child);
			} else if (owner instanceof XRecord && owner.entries.some(e => e.value === child && e.code >= 350 && e.code <= 369)) {
				// Owned through an XRECORD's soft/hard owner entry (tables' DATATABLE, for example).
				child.owner ??= owner;
				ownedByXRecords.push(child);
			}
		}

		// An XRECORD joins the document only with its own owner, which may be a raw object
		// registered above; register what it owns once it is in.
		let pending = ownedByXRecords;
		let progress = true;
		while (pending.length > 0 && progress) {
			progress = false;
			pending = pending.filter(child => {
				const doc = (child.owner as CadObject).document;
				if (child.document != null) {
					return false;
				}
				if (doc == null) {
					return true;
				}
				doc.registerCollection(child);
				progress = true;
				return false;
			});
		}
	}

	buildDataStorage(): void {
		if (this.dataStorage === null) return;

		for (const record of this.dataStorage.records) {
			const idColumn = record.columns.get(CadFileDataStorage.acDbDsId);
			const dataColumn = record.columns.get(CadFileDataStorage.asmData);
			if (!idColumn || !dataColumn) continue;

			const handle = idColumn.handle;
			const data = dataColumn.data;
			if (data === null) continue;

			const geometry = this.tryGetCadObject<ModelerGeometry>(handle);
			if (geometry instanceof ModelerGeometry) {
				geometry.acisData = data;
			} else {
				this.notify(`ModelerGeometry with handle ${handle} not found in the document`, NotificationType.Warning);
			}
		}
	}

	buildTable<T extends TableEntry>(table: Table<T>): void {
		const template = this.tableTemplates.get(table.handle);
		if (template) {
			template.build(this);
		} else {
			this.notify(`Table ${table.objectName} not found in the document`, NotificationType.Warning);
		}
	}

	buildTables(): void {
		this.buildTable(this.appIds);
		this.buildTable(this.textStyles);
		this.buildTable(this.lineTypesTable);
		this.buildTable(this.layers);
		this.buildTable(this.ucSs);
		this.buildTable(this.views);
		this.buildTable(this.blockRecords);
		this.buildTable(this.dimensionStyles);
		this.buildTable(this.vPorts);
	}

	getObjectTemplate<T extends CadTemplate>(handle: number): T | null {
		const template = this.templatesMap.get(handle);
		if (template) {
			return template as unknown as T;
		}
		return null;
	}

	notify(message: string, notificationType: NotificationType = NotificationType.None, exception: Error | null = null): void {
		this.onNotification?.(this, new NotificationEventArgs(message, notificationType, exception));
	}

	notifyProgress(stage: ReadStage, cadObject: CadObject): void {
		this.onProgress?.(this, new ProgressEventArgs(stage, new CadObjectData(cadObject)));
	}

	registerTables(): void {
		this.documentToBuild.registerCollection(this.appIds);
		this.documentToBuild.registerCollection(this.textStyles);
		this.documentToBuild.registerCollection(this.lineTypesTable);
		this.documentToBuild.registerCollection(this.layers);
		this.documentToBuild.registerCollection(this.ucSs);
		this.documentToBuild.registerCollection(this.views);
		this.documentToBuild.registerCollection(this.blockRecords);
		this.documentToBuild.registerCollection(this.dimensionStyles);
		this.documentToBuild.registerCollection(this.vPorts);
	}

	tryGetCadObject<T extends CadObject>(handle: number | null | undefined): T | null {
		if (handle == null || handle === 0) {
			return null;
		}

		const obj = this.cadObjects.get(handle);
		if (obj) {
			if (obj instanceof UnknownEntity && !this.keepUnknownEntities) {
				return null;
			}

			if (obj instanceof UnknownNonGraphicalObject && !this.keepUnknownNonGraphicalObjects) {
				return null;
			}

			return obj as unknown as T;
		}

		return null;
	}

	tryGetObjectTemplate<T extends ICadObjectTemplate>(handle: number | null | undefined): T | null {
		if (handle == null || handle === 0) {
			return null;
		}

		const template = this.templatesMap.get(handle);
		if (template) {
			return template as unknown as T;
		}

		return null;
	}

	tryGetTableEntry<T extends TableEntry>(name: string, entryType?: abstract new (...args: any[]) => T): T | null {
		if (!name || name.length === 0) {
			return null;
		}

		type TableLookup = { tryGetValue(name: string): TableEntry | null };
		const tables: TableLookup[] = [
			this.appIds,
			this.layers,
			this.lineTypesTable,
			this.ucSs,
			this.views,
			this.dimensionStyles,
			this.textStyles,
			this.vPorts,
			this.blockRecords,
		];

		for (const t of tables) {
			const entry = t.tryGetValue(name);
			if (entry && (!entryType || entry instanceof entryType)) {
				return entry as unknown as T;
			}
		}

		return null;
	}

	protected buildDictionaries(): void {
		for (const dictionaryTemplate of this.dictionaryTemplates.values()) {
			dictionaryTemplate.build(this);
		}

		if (!this.documentToBuild.rootDictionary) {
			const roots: CadDictionary[] = [];
			for (const t of this.dictionaryTemplates.values()) {
				if (t.cadObject instanceof CadDictionary && t.cadObject.owner == null) {
					roots.push(t.cadObject);
				}
			}

			if (roots.length !== 1) {
				this.notify(`The root dictionary could not be found.`, NotificationType.Warning);
			} else {
				this.documentToBuild.rootDictionary = roots[0];
			}
		}

		this.documentToBuild.updateCollections(true, false);
	}

	/** The highest handle a read object stated; before buildDocument, every mapped one did. */
	maxStatedHandle(): number {
		let max = 0;
		for (const handle of this.templatesMap.keys()) if (handle > max) max = handle;
		return max;
	}

	/** The objects read from the file; after buildDocument, every one has its template mapped. */
	readObjects(): Set<CadObject> {
		const objects = new Set<CadObject>();
		for (const template of this.templatesMap.values()) objects.add(template.cadObject);
		return objects;
	}

	protected createMissingHandles(): void {
		let nextHandle = Number.isFinite(this.initialHandSeed) ? this.initialHandSeed : 0;
		let pending = this.unassignedObjects;
		this.unassignedObjects = [];

		while (pending.length > 0) {
			for (const template of pending) {
				nextHandle += 1;
				template.cadObject.handle = nextHandle;
				this.addTemplate(template);
			}

			pending = this.unassignedObjects;
			this.unassignedObjects = [];
		}

		this.initialHandSeed = nextHandle;
	}

	protected registerTable<T extends TableEntry>(table: Table<T> | null, tableConstructor: new () => Table<T>): void {
		if (!table) {
			this.documentToBuild.registerCollection(new tableConstructor());
		} else {
			this.documentToBuild.registerCollection(table);
		}
	}

	private _addToMap(template: ICadObjectTemplate): boolean {
		if (template.cadObject.handle === 0) {
			this._pushUnassigned(template);
			return false;
		}

		if (this.templatesMap.has(template.cadObject.handle)) {
			this.notify(`Repeated handle found ${template.cadObject.handle}.`, NotificationType.Warning);
			template.cadObject.handle = 0;
			this._pushUnassigned(template);
			return false;
		}

		if (template.cadObject.handle > this.initialHandSeed) {
			this.initialHandSeed = template.cadObject.handle;
		}

		this.templatesMap.set(template.cadObject.handle, template);
		this.cadObjects.set(template.cadObject.handle, template.cadObject);
		return true;
	}

	private _pushUnassigned(template: ICadObjectTemplate): void {
		if (!Array.isArray(this.unassignedObjects)) {
			this.unassignedObjects = [];
		}

		try {
			this.unassignedObjects.push(template);
		} catch (e) {
			if (e instanceof RangeError) {
				this.notify('Resetting unassigned object queue due to invalid array length.', NotificationType.Warning, e);
				this.unassignedObjects = [template];
				return;
			}
			throw e;
		}
	}

	private _isDictionaryTemplate(template: ICadObjectTemplate): template is ICadDictionaryTemplate {
		return template.cadObject instanceof CadDictionary;
	}

	private _isTableTemplate(template: ICadObjectTemplate): template is ICadTableTemplate {
		return 'entryHandles' in template;
	}

	private _isTableEntryTemplate(template: ICadObjectTemplate): template is ICadTableEntryTemplate {
		return 'type' in template && 'name' in template && !('entryHandles' in template);
	}
}
