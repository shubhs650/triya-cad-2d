import { DxfSectionReaderBase } from './DxfSectionReaderBase.js';
import { IDxfStreamReader } from './IDxfStreamReader.js';
import { DxfDocumentBuilder } from '../DxfDocumentBuilder.js';
import { DxfCode } from '../../../DxfCode.js';
import { DxfFileToken } from '../../../DxfFileToken.js';
import { DxfSubclassMarker } from '../../../DxfSubclassMarker.js';
import { DxfMap } from '../../../DxfMap.js';
import { Block } from '../../../Blocks/Block.js';
import { BlockEnd } from '../../../Blocks/BlockEnd.js';
import { BlockRecord } from '../../../Tables/BlockRecord.js';
import { CadBlockEntityTemplate } from '../../Templates/CadBlockEntityTemplate.js';
import { CadBlockRecordTemplate } from '../../Templates/CadBlockRecordTemplate.js';
import { CadEntityTemplate } from '../../Templates/CadEntityTemplate.js';
import { ICadOwnerTemplate } from '../../Templates/ICadOwnerTemplate.js';
import { DxfException } from '../../../Exceptions/DxfException.js';
import { NotificationType } from '../../NotificationEventHandler.js';
import { UnknownEntity } from '../../../Entities/UnknownEntity.js';
import type { DxfRawCode } from '../../../Objects/RawObjectData.js';

export class DxfBlockSectionReader extends DxfSectionReaderBase {
  public constructor(reader: IDxfStreamReader, builder: DxfDocumentBuilder) {
    super(reader, builder);
  }

  public override read(): void {
    this._reader.readNext();

    while (this._reader.valueAsString !== DxfFileToken.endSection) {
      try {
        if (this._reader.valueAsString === DxfFileToken.block) {
          this._readBlock();
        } else {
          throw new DxfException(
            `Unexpected token at the BLOCKS table: ${this._reader.valueAsString}`,
            this._reader.position
          );
        }
      } catch (ex) {
        if (!this._builder.configuration.failsafe) {
          throw ex;
        }

        this._builder.notify(
          `Error while reading a block at line ${this._reader.position}`,
          NotificationType.Error,
          ex instanceof Error ? ex : undefined
        );

        while (
          !(this._reader.dxfCode === DxfCode.Start && this._reader.valueAsString === DxfFileToken.endSection) &&
          !(this._reader.dxfCode === DxfCode.Start && this._reader.valueAsString === DxfFileToken.block)
        ) {
          this._reader.readNext();
        }
      }
    }
  }

  private _readBlock(): void {
    // The header is recorded in case the block turns out to have no name and no record (below).
    const keepUnreachable = this._builder.configuration.keepUnreachableObjects;
    const header: DxfRawCode[] = [];
    if (keepUnreachable) {
      this._reader.recorder = header;
    }
    this._reader.readNext();

    const map = DxfMap.create(Block);

    const blckEntity = new Block();
    const template = new CadBlockEntityTemplate(blckEntity);

    let name: string | null = null;
    let record: BlockRecord | null = null;
    let recordTemplate: CadBlockRecordTemplate | null = null;

    while (this._reader.dxfCode !== DxfCode.Start) {
      switch (this._reader.code as number) {
        case 2:
        case 3:
          name = this._reader.valueAsString;
          if (name.toUpperCase() === '$MODEL_SPACE') {
            name = BlockRecord.modelSpaceName;
          } else if (name.toUpperCase() === '$PAPER_SPACE') {
            name = BlockRecord.paperSpaceName;
          }

          if (record === null) {
            record = this._builder.tryGetTableEntry<BlockRecord>(name);
            if (record) {
              record.blockEntity = blckEntity;
            } else {
              this._builder.notify(
                `Block record [${name}] not found at line ${this._reader.position}`,
                NotificationType.Warning
              );
            }
          }
          break;
        case 330:
          if (record === null) {
            record = this._builder.tryGetCadObject<BlockRecord>(this._reader.valueAsHandle);
            if (record) {
              record.blockEntity = blckEntity;
            } else {
              this._builder.notify(
                `Block record with handle [${this._reader.valueAsString}] not found at line ${this._reader.position}`,
                NotificationType.Warning
              );
            }
          }
          break;
        default:
          if (!this.tryAssignCurrentValue(template.cadObject, map.subClasses.get(DxfSubclassMarker.blockBegin))) {
            const isExtendedData = { value: false };
            this.readCommonEntityCodes(template, isExtendedData, map);
            if (isExtendedData.value) {
              continue;
            }
          }
          break;
      }

      this._reader.readNext();
    }
    this._reader.recorder = null;
    header.pop(); // the next record's type code

    if (record === null && !name && keepUnreachable) {
      // A block record cannot have an empty name, and no INSERT can name this block, so nothing
      // reaches it. Keep it as read, like a DWG object no reference reaches.
      this._readUnreachableBlock(header);
      return;
    }

    if (record === null) {
      record = new BlockRecord(name ?? '');
      record.blockEntity = blckEntity;
      recordTemplate = new CadBlockRecordTemplate(record);

      this._builder.addTemplate(recordTemplate);
      this._builder.blockRecords.add(record);

      if (recordTemplate.cadObject.name.toUpperCase() === BlockRecord.modelSpaceName.toUpperCase()) {
        this._builder.modelSpaceTemplate = recordTemplate;
      }
    } else {
      recordTemplate = this._builder.tryGetObjectTemplate<CadBlockRecordTemplate>(record.handle);
      if (!recordTemplate) {
        recordTemplate = new CadBlockRecordTemplate(record);
      }
    }

    recordTemplate.blockEntityTemplate = template;

    while (this._reader.valueAsString !== DxfFileToken.endBlock) {
      let entityTemplate: CadEntityTemplate | null = null;

      try {
        entityTemplate = this.readEntity();
      } catch (ex) {
        if (!this._builder.configuration.failsafe) {
          throw ex;
        }

        this._builder.notify(
          `Error while reading a block with name ${record.name} at line ${this._reader.position}`,
          NotificationType.Error,
          ex instanceof Error ? ex : undefined
        );

        while (this._reader.dxfCode !== DxfCode.Start) {
          this._reader.readNext();
        }
      }

      if (entityTemplate === null) {
        continue;
      }

      this._builder.addTemplate(entityTemplate);

      if (entityTemplate.ownerHandle === null) {
        recordTemplate.referenceTemplates.add(entityTemplate);
      } else {
        const owner = this._builder.tryGetObjectTemplate<ICadOwnerTemplate>(entityTemplate.ownerHandle);
        if (owner) {
        owner.ownedObjectsHandlers.add(entityTemplate.cadObject.handle);
        } else {
          this._builder.orphanTemplates.push(entityTemplate);
        }
      }
    }

    this._readBlockEnd(record.blockEnd);
    this._builder.addTemplate(template);
  }

  /** The block's header is read; keep it, its entities and its ENDBLK as raw entities. */
  private _readUnreachableBlock(header: DxfRawCode[]): void {
    const kept = [this._rawEntity(DxfFileToken.block, header)];
    while (this._reader.valueAsString !== DxfFileToken.endSection) {
      const type = this._reader.valueAsString;
      const raw: DxfRawCode[] = [];
      this._reader.recorder = raw;
      try {
        do {
          this._reader.readNext();
        } while (this._reader.dxfCode !== DxfCode.Start);
      } finally {
        this._reader.recorder = null;
      }
      raw.pop();
      kept.push(this._rawEntity(type, raw));
      if (type === DxfFileToken.endBlock) {
        break;
      }
    }

    for (const entity of kept) {
      if (entity.handle === 0) {
        this._builder.notify(`Block with no name and no handle is not kept: ${entity.objectName}`, NotificationType.Warning);
        continue;
      }
      this._builder.unreachableObjects.push(entity);
    }
  }

  private _rawEntity(name: string, raw: DxfRawCode[]): UnknownEntity {
    const entity = new UnknownEntity(null);
    entity.rawDxfName = name;
    entity.rawDxfCodes = raw;
    const handle = raw.find((c) => c.code === 5)?.value;
    entity.handle = typeof handle === 'number' ? handle : parseInt(String(handle ?? '0'), 16) || 0;
    return entity;
  }

  private _readBlockEnd(block: BlockEnd): void {
    const map = DxfMap.create(BlockEnd);
    const template = new CadEntityTemplate(block);

    if (this._reader.dxfCode === DxfCode.Start) {
      this._reader.readNext();
    }

    while (this._reader.dxfCode !== DxfCode.Start) {
      if (!this.tryAssignCurrentValue(template.cadObject, map.subClasses.get(DxfSubclassMarker.blockEnd))) {
        const isExtendedData = { value: false };
        this.readCommonEntityCodes(template, isExtendedData, map);
        if (isExtendedData.value) {
          continue;
        }
      }

      this._reader.readNext();
    }

    this._builder.addTemplate(template);
  }
}
