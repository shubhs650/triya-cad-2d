import { Entity } from '../../Entities/Entity.js';
import { ExtendedDataLayer } from '../../XData/ExtendedDataLayer.js';
import type { Layer } from '../../Tables/Layer.js';
import { CadTemplate } from '../Templates/CadTemplate.js';
import { CadObject } from '../../CadObject.js';
import { CadDictionary } from '../../Objects/CadDictionary.js';
import { CadEntityTemplate } from '../Templates/CadEntityTemplate.js';
import { CadBlockRecordTemplate } from '../Templates/CadBlockRecordTemplate.js';
import { CadPolyLineTemplate } from '../Templates/CadPolyLineTemplate.js';
import { CadInsertTemplate } from '../Templates/CadInsertTemplate.js';
import { Vertex } from '../../Entities/Vertex.js';
import { Seqend } from '../../Entities/Seqend.js';
import { AttributeEntity } from '../../Entities/AttributeEntity.js';
import { BlockRecord } from '../../Tables/BlockRecord.js';
import { ACadVersion } from '../../ACadVersion.js';
import { CadDocument } from '../../CadDocument.js';
import { DxfReaderConfiguration } from './DxfReaderConfiguration.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { NotificationType } from '../NotificationEventHandler.js';
import { ICadOwnerTemplate } from '../Templates/ICadOwnerTemplate.js';

export class DxfDocumentBuilder extends CadDocumentBuilder {
	public override get ignoreProxyGraphics(): boolean { return this.configuration.ignoreProxyGraphics; }
  public configuration: DxfReaderConfiguration;

  public override get keepUnknownEntities(): boolean {
    return this.configuration.keepUnknownEntities;
  }

  public override get keepUnknownNonGraphicalObjects(): boolean {
    return this.configuration.keepUnknownNonGraphicalObjects;
  }

  public modelSpaceEntities: Set<Entity> = new Set<Entity>();

  public modelSpaceTemplate: CadBlockRecordTemplate | null = null;

  public orphanTemplates: CadTemplate[] = [];

  public constructor(version: ACadVersion, document: CadDocument, configuration: DxfReaderConfiguration) {
    super(version, document);
    this.configuration = configuration;
  }

  /** The model space record made up because the file has none (an R12 file with no BLOCKS). */
  public madeUpModelSpace: BlockRecord | null = null;

  /** 1003 xdata records whose layer had no handle yet when they were read. */
  public unnumberedXDataLayers: [ExtendedDataLayer, Layer][] = [];

  public override buildDocument(): void {
    if (this.modelSpaceTemplate === null) {
      const record = BlockRecord.modelSpace;
      this.madeUpModelSpace = record;
      this.blockRecords.add(record);
      this.modelSpaceTemplate = new CadBlockRecordTemplate(record);
      this.addTemplate(this.modelSpaceTemplate);
    }

    this.createMissingHandles();

    for (const [record, layer] of this.unnumberedXDataLayers) record.value = layer.handle;

    for (const entity of this.modelSpaceEntities) {
      this.modelSpaceTemplate!.ownedObjectsHandlers.add(entity.handle);
    }

    this.registerTables();

    this.buildTables();

    this.buildDictionaries();

    for (const template of this.orphanTemplates) {
      this._assignOwner(template);
    }

    super.buildDocument();

    // A made-up entity handle can collide with one the document's own tables take when they are
    // registered (a file with no $HANDSEED numbers from 0), and the document then renumbers the
    // entity; keep the record's owned handles naming its entities.
    for (const record of this.documentToBuild.blockRecords) {
      const owned = record.ownedObjectHandles;
      if (owned.some((h) => this.documentToBuild.getCadObject(h)?.owner !== record)) {
        record.ownedObjectHandles = [...record.entities].map((e) => e.handle);
      }
    }

    if (this.configuration.createDefaults) {
      this.documentToBuild.createDefaults();
    }
  }

  public buildEntities(): Entity[] {
    const entities: Entity[] = [];

    for (const item of this.cadObjectsTemplates.values()) {
      if (item instanceof CadEntityTemplate) {
        item.build(this);
        item.setUnlinkedReferences();
      }
    }

    for (const item of this.cadObjectsTemplates.values()) {
      if (item instanceof CadEntityTemplate && item.cadObject.owner === null) {
        item.cadObject.handle = 0;
        entities.push(item.cadObject);
      }
    }

    return entities;
  }

  private _assignOwner(template: CadTemplate): void {
    if (template.cadObject.owner !== null || template.cadObject instanceof CadDictionary || !template.ownerHandle) {
      return;
    }

    const ownerResult = this.tryGetObjectTemplate(template.ownerHandle);
    if (ownerResult) {
      const owner = ownerResult;
      if (owner instanceof CadBlockRecordTemplate && template.cadObject instanceof Entity) {
        // The entries should be assigned in the blocks or entities section
      } else if (owner instanceof CadPolyLineTemplate && template.cadObject instanceof Vertex) {
        owner.ownedObjectsHandlers.add(template.cadObject.handle);
      } else if (owner instanceof CadPolyLineTemplate && template.cadObject instanceof Seqend) {
        owner.seqendHandle = template.cadObject.handle;
      } else if (owner instanceof CadInsertTemplate && template.cadObject instanceof AttributeEntity) {
        owner.ownedObjectsHandlers.add(template.cadObject.handle);
      } else if (owner instanceof CadInsertTemplate && template.cadObject instanceof Seqend) {
        owner.seqendHandle = template.cadObject.handle;
      } else {
        const genericOwner = owner as CadTemplate & Partial<ICadOwnerTemplate>;
        if (genericOwner.ownedObjectsHandlers instanceof Set) {
          genericOwner.ownedObjectsHandlers.add(template.cadObject.handle);
        } else {
          this.notify(`Owner ${owner.constructor.name} with handle ${template.ownerHandle} assignation not implemented for ${template.cadObject.constructor.name} with handle ${template.cadObject.handle}`, NotificationType.Warning);
        }
      }
    } else {
      this.notify(`Owner ${template.ownerHandle} not found for ${template.constructor.name} with handle ${template.cadObject.handle}`, NotificationType.Warning);
    }
  }
}
