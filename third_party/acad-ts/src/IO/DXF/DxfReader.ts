import { CadReaderBase } from '../CadReaderBase.js';
import { DxfReaderConfiguration } from './DxfReaderConfiguration.js';
import { DxfAcdsDataSectionReader } from './DxfStreamReader/DxfAcdsDataSectionReader.js';
import { DxfDocumentBuilder } from './DxfDocumentBuilder.js';
import { IDxfStreamReader } from './DxfStreamReader/IDxfStreamReader.js';
import { DxfTextReader } from './DxfStreamReader/DxfTextReader.js';
import { DxfBinaryReader } from './DxfStreamReader/DxfBinaryReader.js';
import { DxfBinaryReaderAC1009 } from './DxfStreamReader/DxfBinaryReaderAC1009.js';
import { DxfTablesSectionReader } from './DxfStreamReader/DxfTablesSectionReader.js';
import { DxfBlockSectionReader } from './DxfStreamReader/DxfBlockSectionReader.js';
import { DxfEntitiesSectionReader } from './DxfStreamReader/DxfEntitiesSectionReader.js';
import { DxfObjectsSectionReader } from './DxfStreamReader/DxfObjectsSectionReader.js';
import { CadDocument } from '../../CadDocument.js';
import { CadSummaryInfo } from '../../CadSummaryInfo.js';
import { CadHeader } from '../../Header/CadHeader.js';
import { CadSystemVariable } from '../../CadSystemVariable.js';
import { CadUtils } from '../../CadUtils.js';
import { ACadVersion } from '../../ACadVersion.js';
import { DxfCode } from '../../DxfCode.js';
import { DxfFileToken } from '../../DxfFileToken.js';
import { DxfMap } from '../../DxfMap.js';
import { DxfClassCollection } from '../../Classes/DxfClassCollection.js';
import { DxfClass } from '../../Classes/DxfClass.js';
import { ProxyFlags } from '../../Classes/ProxyFlags.js';
import { GroupCodeValue, GroupCodeValueType } from '../../GroupCodeValue.js';
import { Entity } from '../../Entities/Entity.js';
import { NotificationEventHandler, NotificationType } from '../NotificationEventHandler.js';
import { CadNotSupportedException } from '../../Exceptions/CadNotSupportedException.js';
import { getDecoderEncodingLabel } from '../TextEncoding.js';

export class DxfReader extends CadReaderBase<DxfReaderConfiguration> {
  private _version: ACadVersion = ACadVersion.Unknown;
  private _sawR13Sections = false;
  private _builder!: DxfDocumentBuilder;
  private _reader!: IDxfStreamReader;

  private get fileStream(): Uint8Array {
    return this._fileStream instanceof Uint8Array
      ? this._fileStream
      : new Uint8Array(this._fileStream);
  }

  public constructor(stream: Uint8Array, notification?: NotificationEventHandler) {
    super(stream, notification);
    this.configuration = new DxfReaderConfiguration();
  }

  public isBinary(): boolean {
    return DxfReader.isBinaryStream(this.fileStream);
  }

  public static isBinaryStream(stream: Uint8Array, resetPos: boolean = false): boolean {
    const sentinelBytes = DxfBinaryReader.sentinelBytes;
    if (stream.length < sentinelBytes.length) {
      return false;
    }

    for (let i = 0; i < sentinelBytes.length; i++) {
      if (stream[i] !== sentinelBytes[i]) {
        return false;
      }
    }

    return true;
  }

  public static readFromStream(stream: Uint8Array, notification?: NotificationEventHandler): CadDocument {
    const reader = new DxfReader(stream, notification);
    const doc = reader.read();
    reader.dispose();
    return doc;
  }

  public static readFromStreamWithConfig(
    stream: Uint8Array,
    configuration: DxfReaderConfiguration,
    notification?: NotificationEventHandler
  ): CadDocument {
    const reader = new DxfReader(stream, notification);
    reader.configuration = configuration;
    const doc = reader.read();
    reader.dispose();
    return doc;
  }

  public override read(): CadDocument {
    // Full-file reads must start without the default object graph. Otherwise the
    // imported dictionaries are built beside the defaults and their entries are
    // never attached to the document (groups were a visible casualty).
    this._document = new CadDocument(ACadVersion.Unknown, false);
    this._document.summaryInfo = new CadSummaryInfo();
    this._document.classes = new DxfClassCollection();

    this._reader = this._reader ?? this._getReader();

    this._builder = new DxfDocumentBuilder(this._version, this._document, this.configuration);
    this._builder.onNotification = this.onNotificationEvent.bind(this);
    this._builder.onProgress = this.onProgressEvent.bind(this);
	let orphanTablesReader: DxfTablesSectionReader | null = null;

    while (this._reader.valueAsString !== DxfFileToken.endOfFile) {
      if (this._reader.valueAsString === DxfFileToken.tableEntry) {
        if (orphanTablesReader === null) {
          this.triggerNotification('Non-standard DXF: TABLE entry outside TABLES section. Attempting recovery.', NotificationType.Warning);
          orphanTablesReader = new DxfTablesSectionReader(this._reader, this._builder);
        }
        orphanTablesReader.readTable();
        this._reader.readNext();
        continue;
      }
      if (this._reader.valueAsString !== DxfFileToken.beginSection) {
        this._reader.readNext();
        continue;
      } else {
        this._reader.readNext();
      }

      switch (this._reader.valueAsString as string) {
        case DxfFileToken.headerSection:
          this._document.header = this.readHeader();
          this._document.header.document = this._document;
          if (this._document.header.handleSeed === 0) this._document.header.handleSeed = 1;
          this._builder.initialHandSeed = this._document.header.handleSeed;
          break;
        case DxfFileToken.classesSection:
          this._sawR13Sections = true;
          this._document.classes = this._readClasses();
          break;
        case DxfFileToken.tablesSection:
          this._readTablesSection();
          break;
        case DxfFileToken.blocksSection:
          this._readBlocks();
          break;
        case DxfFileToken.entitiesSection:
          this._readEntitiesSection();
          break;
        case DxfFileToken.objectsSection:
          this._sawR13Sections = true;
          this._readObjects();
          break;
        case DxfFileToken.acdsDataSection:
          new DxfAcdsDataSectionReader(this._reader, this._builder).read();
          break;
        default:
          this.triggerNotification(`Section not implemented ${this._reader.valueAsString}`, NotificationType.NotImplemented);
          break;
      }

      this._reader.readNext();
    }

    if (this._document.header === null) {
      this._document.header = new CadHeader(this._document);
    }
    // A DXF with no $ACADVER and no R13 sections (CLASSES, OBJECTS) is R12, as AutoCAD and ezdxf
    // read it: the minimal R12 file is an ENTITIES section and EOF. Left at the header's default
    // version, it was saved as R2018 with objects the file never had.
    if (this._version === ACadVersion.Unknown && !this._sawR13Sections) {
      this._document.header.version = ACadVersion.AC1009;
    }

    // Handles at or above both $HANDSEED and every stated handle are made up while building (R12
    // has no BLOCK_RECORD table, and many R12 files state no handles); an R12 save leaves them out.
    // The builder numbers them on from the higher of the two.
    const firstMadeUp = Math.max(this._document.header.handleSeed, this._builder.maxStatedHandle()) + 1;

    this._builder.buildDocument();
    if (this._document.header.version !== ACadVersion.Unknown && this._document.header.version <= ACadVersion.AC1009) {
      this._builder.addR12PaperSpaceLayout();
    }
		this._builder.buildDataStorage();

    const lastMadeUp = this._document.header.handleSeed - 1;
    if (lastMadeUp >= firstMadeUp) {
      // Made-up handles of objects with no template are defaults the reader added (LTYPE ByLayer
      // when an entity refers to it, *PAPER_SPACE when the file has none, and so on).
      const read = this._builder.readObjects();
      if (this._builder.madeUpModelSpace) read.delete(this._builder.madeUpModelSpace);
      if (this._builder.madeUpPaperSpace) read.delete(this._builder.madeUpPaperSpace);
      const added = new Set<number>();
      for (const obj of this._document.getCadObjects()) {
        if (obj.handle >= firstMadeUp && obj.handle <= lastMadeUp && !read.has(obj)) added.add(obj.handle);
      }
      this._document.madeUpHandles = { first: firstMadeUp, last: lastMadeUp, added };
    }

    return this._document;
  }

  public override readHeader(): CadHeader {
    this._reader = this._goToSection(DxfFileToken.headerSection);

    const header = new CadHeader();

    const headerMap: Map<string, CadSystemVariable> = CadHeader.getHeaderMap();

    this._reader.readNext();

    while (this._reader.valueAsString !== DxfFileToken.endSection) {
      const currVar = this._reader.valueAsString;

      if (currVar === null || currVar === undefined || !headerMap.has(currVar)) {
        this._reader.readNext();
        continue;
      }

      const data = headerMap.get(currVar)!;

      const parameters: unknown[] = new Array(data.dxfCodes.length);
      for (let i = 0; i < data.dxfCodes.length; i++) {
        this._reader.readNext();

        if (this._reader.dxfCode === DxfCode.CLShapeText || this._reader.dxfCode === DxfCode.Start) {
          const c = data.dxfCodes[i];
          const g = GroupCodeValue.transformValue(c);
          switch (g) {
            case GroupCodeValueType.Bool:
              parameters[i] = false;
              break;
            case GroupCodeValueType.Byte:
            case GroupCodeValueType.Int16:
            case GroupCodeValueType.Int32:
            case GroupCodeValueType.Int64:
            case GroupCodeValueType.Double:
            case GroupCodeValueType.Point3D:
              parameters[i] = 0;
              break;
            case GroupCodeValueType.None:
            case GroupCodeValueType.String:
            default:
              parameters[i] = undefined;
              break;
          }

          break;
        }

        parameters[i] = this._reader.value;
      }

      try {
        header.setValue(currVar, parameters);

        // R2007+ DXF is UTF-8 whatever the code page (see _getReader).
        if (currVar === '$DWGCODEPAGE' && this._version < ACadVersion.AC1021) {
          this._encoding = getDecoderEncodingLabel(header.codePage);
          this._reader.encoding = this._encoding;
        }
      } catch (ex) {
        this.triggerNotification(
          `Invalid value for header variable ${currVar} | ${parameters[0]}`,
          NotificationType.Warning,
          ex instanceof Error ? ex : undefined
        );
      }

      if (this._reader.dxfCode !== DxfCode.CLShapeText && this._reader.dxfCode !== DxfCode.Start) {
        this._reader.readNext();
      }
    }

    return header;
  }

  public readTablesOnly(): CadDocument {
    this._reader = this._reader ?? this._getReader();

    this._builder = new DxfDocumentBuilder(this._version, this._document, this.configuration);
    this._builder.onNotification = this.onNotificationEvent.bind(this);

    this._readTablesSection();

    this._document.header = new CadHeader(this._document);

    this._builder.registerTables();

    this._builder.buildTables();

    return this._document;
  }

  public readTables(): CadDocument {
    return this.readTablesOnly();
  }

  public readEntitiesOnly(): Entity[] {
    this._reader = this._reader ?? this._getReader();

    this._builder = new DxfDocumentBuilder(this._version, this._document, this.configuration);
    this._builder.onNotification = this.onNotificationEvent.bind(this);

    this._readEntitiesSection();

    return this._builder.buildEntities();
  }

  public readEntities(): Entity[] {
    return this.readEntitiesOnly();
  }

  public getReader(): IDxfStreamReader {
    return this._getReader();
  }

  public override dispose(): void {
    super.dispose();

    if (this.configuration.clearCache) {
      DxfMap.clearCache();
    }
  }

  private _readClasses(): DxfClassCollection {
    this._reader = this._goToSection(DxfFileToken.classesSection);

    const classes = new DxfClassCollection();

    this._reader.readNext();
    while (this._reader.valueAsString !== DxfFileToken.endSection) {
      if (this._reader.valueAsString === DxfFileToken.classEntry) {
        const dxfClass = this._readClass();

        if (dxfClass.classNumber < 500) {
          dxfClass.classNumber = 500 + classes.count;
        }

        classes.tryAdd(dxfClass);
      } else {
        this._reader.readNext();
      }
    }

    return classes;
  }

  private _readClass(): DxfClass {
    const curr = new DxfClass();

    this._reader.readNext();
    while (this._reader.dxfCode !== DxfCode.Start) {
      switch (this._reader.code) {
        case 1:
          curr.dxfName = this._reader.valueAsString;
          break;
        case 2:
          curr.cppClassName = this._reader.valueAsString;
          break;
        case 3:
          curr.applicationName = this._reader.valueAsString;
          break;
        case 90:
          curr.proxyFlags = this._reader.valueAsInt as ProxyFlags;
          break;
        case 91:
          curr.instanceCount = this._reader.valueAsInt;
          break;
        case 280:
          curr.wasZombie = this._reader.valueAsBool;
          break;
        case 281:
          curr.isAnEntity = this._reader.valueAsBool;
          break;
        default:
          break;
      }

      this._reader.readNext();
    }

    return curr;
  }

  private _readTablesSection(): void {
    this._reader = this._goToSection(DxfFileToken.tablesSection);

    const reader = new DxfTablesSectionReader(this._reader, this._builder);

    reader.read();
  }

  private _readBlocks(): void {
    this._reader = this._goToSection(DxfFileToken.blocksSection);

    const reader = new DxfBlockSectionReader(this._reader, this._builder);

    reader.read();
  }

  private _readEntitiesSection(): void {
    this._reader = this._goToSection(DxfFileToken.entitiesSection);

    const reader = new DxfEntitiesSectionReader(this._reader, this._builder);

    reader.read();
  }

  private _readObjects(): void {
    this._reader = this._goToSection(DxfFileToken.objectsSection);

    const reader = new DxfObjectsSectionReader(this._reader, this._builder);

    reader.read();
  }

  private _getReader(): IDxfStreamReader {
    this._version = ACadVersion.Unknown;
    this._encoding = getDecoderEncodingLabel('ANSI_1252');

    const stream = this.fileStream;
    const isBinary = DxfReader.isBinaryStream(stream);
    let isAC1009Format = false;

    if (isBinary && stream.length > DxfBinaryReader.sentinelBytes.length + 1) {
      const offset = DxfBinaryReader.sentinelBytes.length;
      // Both formats normally begin with group 0 (SECTION). R12 stores one
      // code byte, so the next byte is 'S'; R13+ stores the zero high byte.
      // Comments use FF E7 03 in R12 and E7 03 in the modern encoding.
      const first = stream[offset], second = stream[offset + 1];
      isAC1009Format = first === 0xFF || (second !== 0 && !(first === 0xE7 && second === 0x03));
    }

    const tmpReader = this._createReader(isBinary, isAC1009Format);

    if (!tmpReader.find(DxfFileToken.headerSection)) {
      this.triggerNotification('Header section not found, using a generic reader.', NotificationType.Warning);

      this._version = ACadVersion.Unknown;
      tmpReader.start();
      return tmpReader;
    }

    while (tmpReader.valueAsString !== DxfFileToken.endSection) {
      if (tmpReader.valueAsString === '$ACADVER') {
        tmpReader.readNext();
        this._version = CadUtils.getVersionFromName(tmpReader.valueAsString);

        if (this._version < ACadVersion.AC1002) {
          if (this._version === ACadVersion.Unknown) {
            throw new CadNotSupportedException();
          } else {
            throw new CadNotSupportedException(this._version);
          }
        }
      } else if (tmpReader.valueAsString === '$DWGCODEPAGE') {
        tmpReader.readNext();
        this._encoding = getDecoderEncodingLabel(tmpReader.valueAsString);
        tmpReader.encoding = this._encoding;
      }

      tmpReader.readNext();
    }

    if (this._version === ACadVersion.Unknown) {
      this.triggerNotification('Dxf version not found, using a generic reader.', NotificationType.Warning);
    }

    // AutoCAD writes DXF as UTF-8 from R2007; $DWGCODEPAGE still names the drawing's code page.
    if (this._version >= ACadVersion.AC1021) {
      this._encoding = 'utf-8';
    }

    return this._createReader(isBinary, isAC1009Format);
  }

  private _goToSection(sectionName: string): IDxfStreamReader {
    this._reader = this._reader ?? this._getReader();

    if (this._reader.valueAsString === sectionName) {
      return this._reader;
    }

    this._reader.find(sectionName);

    return this._reader;
  }

  private _createReader(isBinary: boolean, isAC1009Format: boolean): IDxfStreamReader {
    const stream = this.fileStream;
    let reader: IDxfStreamReader;

    if (isBinary) {
      if (isAC1009Format) {
        reader = new DxfBinaryReaderAC1009(stream);
      } else {
        reader = new DxfBinaryReader(stream);
      }
    } else {
      reader = new DxfTextReader(stream);
    }

    reader.encoding = this._encoding;
    return reader;
  }

  protected createDefaultConfiguration(): DxfReaderConfiguration { return new DxfReaderConfiguration(); }
}
