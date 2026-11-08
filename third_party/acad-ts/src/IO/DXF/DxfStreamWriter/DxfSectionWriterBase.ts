import { IDxfStreamWriter } from './IDxfStreamWriter.js';
import { CadDocument } from '../../../CadDocument.js';
import { CadObjectHolder } from '../CadObjectHolder.js';
import { DxfWriterConfiguration } from '../DxfWriterConfiguration.js';
import { DxfCode } from '../../../DxfCode.js';
import { DxfFileToken } from '../../../DxfFileToken.js';
import { DxfSubclassMarker } from '../../../DxfSubclassMarker.js';
import { DxfClassMap } from '../../../DxfClassMap.js';
import { DxfReferenceType } from '../../../Types/DxfReferenceType.js';
import { ACadVersion } from '../../../ACadVersion.js';
import { CadFileFormat } from '../../CadFileFormat.js';
import { CadObject } from '../../../CadObject.js';
import { CadValue } from '../../../CadValue.js';
import { CadValueType } from '../../../CadValueType.js';
import { Entity } from '../../../Entities/Entity.js';
import { EntityPlotStyleType } from '../../../Header/EntityPlotStyleType.js';
import { Arc } from '../../../Entities/Arc.js';
import { Circle } from '../../../Entities/Circle.js';
import { DimensionAligned } from '../../../Entities/DimensionAligned.js';
import { DimensionLinear } from '../../../Entities/DimensionLinear.js';
import { DimensionRadius } from '../../../Entities/DimensionRadius.js';
import { DimensionDiameter } from '../../../Entities/DimensionDiameter.js';
import { DimensionAngular2Line } from '../../../Entities/DimensionAngular2Line.js';
import { DimensionAngular3Pt } from '../../../Entities/DimensionAngular3Pt.js';
import { DimensionArc } from '../../../Entities/DimensionArc.js';
import { DimensionRadialLarge } from '../../../Entities/DimensionRadialLarge.js';
import { DimensionOrdinate } from '../../../Entities/DimensionOrdinate.js';
import { Dimension } from '../../../Entities/Dimension.js';
import { Ellipse } from '../../../Entities/Ellipse.js';
import { Face3D } from '../../../Entities/Face3D.js';
import { Hatch , HatchBoundaryPath, HatchBoundaryPathPolyline, HatchBoundaryPathEdge, HatchBoundaryPathLine, HatchBoundaryPathArc, HatchBoundaryPathEllipse, HatchBoundaryPathSpline} from '../../../Entities/Hatch.js';
import { HatchPattern } from '../../../Entities/HatchPattern.js';
import { Insert } from '../../../Entities/Insert.js';
import { CellOverrideFlags, CellType, TableEntity, type CellBorder, type TableEntityCell } from '../../../Entities/TableEntity.js';
import { Leader } from '../../../Entities/Leader.js';
import { Line } from '../../../Entities/Line.js';
import { LwPolyline } from '../../../Entities/LwPolyline.js';
import { Mesh } from '../../../Entities/Mesh.js';
import { MLine } from '../../../Entities/MLine.js';
import { MText } from '../../../Entities/MText.js';
import { MultiLeader } from '../../../Entities/MultiLeader.js';
import { MultiLeaderObjectContextData , LeaderRoot, LeaderLine} from '../../../Objects/MultiLeaderObjectContextData.js';
import { Ole2Frame } from '../../../Entities/Ole2Frame.js';
import { PdfUnderlay } from '../../../Entities/PdfUnderlay.js';
import { Point } from '../../../Entities/Point.js';
import { Polyline2D } from '../../../Entities/Polyline2D.js';
import { Polyline3D } from '../../../Entities/Polyline3D.js';
import { PolyfaceMesh } from '../../../Entities/PolyfaceMesh.js';
import { PolygonMesh } from '../../../Entities/PolygonMesh.js';
import { SmoothSurfaceType } from '../../../Entities/SmoothSurfaceType.js';
import { Ray } from '../../../Entities/Ray.js';
import { Shape } from '../../../Entities/Shape.js';
import { Solid } from '../../../Entities/Solid.js';
import { Spline } from '../../../Entities/Spline.js';
import { TextEntity } from '../../../Entities/TextEntity.js';
import { Tolerance } from '../../../Entities/Tolerance.js';
import { Vertex } from '../../../Entities/Vertex.js';
import { Vertex2D } from '../../../Entities/Vertex2D.js';
import { Vertex3D } from '../../../Entities/Vertex3D.js';
import { VertexFaceMesh } from '../../../Entities/VertexFaceMesh.js';
import { VertexFaceRecord } from '../../../Entities/VertexFaceRecord.js';
import { PolygonMeshVertex } from '../../../Entities/PolygonMeshVertex.js';
import { Viewport } from '../../../Entities/Viewport.js';
import { XLine } from '../../../Entities/XLine.js';
import { CadImage } from '../../../Entities/CadWipeoutBase.js';
import { RasterImage } from '../../../Entities/RasterImage.js';
import { Wipeout } from '../../../Entities/Wipeout.js';
import { Seqend } from '../../../Entities/Seqend.js';
import { ModelerGeometry } from '../../../Entities/ModelerGeometry.js';
import { Surface } from '../../../Entities/Surface.js';
import { ProxyEntity } from '../../../Entities/ProxyEntity.js';
import { ProxyGeometryWriter } from '../../ProxyGeometryWriter.js';
import { Region } from '../../../Entities/Region.js';
import { CadBody } from '../../../Entities/CadBody.js';
import { Solid3D } from '../../../Entities/Solid3D.js';
import { AttributeBase } from '../../../Entities/AttributeBase.js';
import { AttributeEntity } from '../../../Entities/AttributeEntity.js';
import { AttributeDefinition } from '../../../Entities/AttributeDefinition.js';
import { AttributeType } from '../../../Entities/AttributeType.js';
import { DimensionStyle } from '../../../Tables/DimensionStyle.js';
import { BlockRecord } from '../../../Tables/BlockRecord.js';
import { Transparency } from '../../../Transparency.js';
import { Color } from '../../../Color.js';
import { IHandledCadObject } from '../../../IHandledCadObject.js';
import { IVector } from '../../../Math/IVector.js';
import { ExtendedDataDictionary } from '../../../XData/ExtendedDataDictionary.js';
import { ExtendedDataRecord } from '../../../XData/ExtendedDataRecord.js';
import { ExtendedDataBinaryChunk } from '../../../XData/ExtendedDataBinaryChunk.js';
import { ExtendedDataControlString } from '../../../XData/ExtendedDataControlString.js';
import { ExtendedDataInteger16 } from '../../../XData/ExtendedDataInteger16.js';
import { ExtendedDataInteger32 } from '../../../XData/ExtendedDataInteger32.js';
import { ExtendedDataReal } from '../../../XData/ExtendedDataReal.js';
import { ExtendedDataScale } from '../../../XData/ExtendedDataScale.js';
import { ExtendedDataDistance } from '../../../XData/ExtendedDataDistance.js';
import { ExtendedDataDisplacement } from '../../../XData/ExtendedDataDisplacement.js';
import { ExtendedDataDirection } from '../../../XData/ExtendedDataDirection.js';
import { ExtendedDataCoordinate } from '../../../XData/ExtendedDataCoordinate.js';
import { ExtendedDataWorldCoordinate } from '../../../XData/ExtendedDataWorldCoordinate.js';
import { IExtendedDataHandleReference } from '../../../XData/IExtendedDataHandleReference.js';
import { ExtendedDataString } from '../../../XData/ExtendedDataString.js';
import { ExtendedDataLayer } from '../../../XData/ExtendedDataLayer.js';
import { NotificationEventHandler, NotificationEventArgs, NotificationType } from '../../NotificationEventHandler.js';
import { DxfMap } from '../../../DxfMap.js';
import { BoundaryPathFlags } from '../../../Entities/BoundaryPathFlags.js';
import { UnknownEntity } from '../../../Entities/UnknownEntity.js';
import type { IRawCadObject } from '../../../Objects/RawObjectData.js';
import { MathHelper } from '../../../Math/MathHelper.js';
import { XYZ } from '../../../Math/XYZ.js';
import { XY } from '../../../Math/XY.js';
import { AcisTextCodec } from '../../AcisTextCodec.js';
import { LineWeightType } from '../../../Types/LineWeightType.js';

export abstract class DxfSectionWriterBase {
  public onNotification: NotificationEventHandler | null = null;

  public abstract get sectionName(): string;

  public get version(): ACadVersion {
    return this._document.header.version;
  }

  public holder: CadObjectHolder;

  public configuration: DxfWriterConfiguration;

  protected _writer: IDxfStreamWriter;
  protected _document: CadDocument;

  public constructor(
    writer: IDxfStreamWriter,
    document: CadDocument,
    holder: CadObjectHolder,
    configuration: DxfWriterConfiguration
  ) {
    this._writer = writer;
    this._document = document;
    this.holder = holder;
    this.configuration = configuration;
  }

  public write(): void {
    this._writer.write(DxfCode.Start, DxfFileToken.beginSection);
    this._writer.write(DxfCode.SymbolTableName, this.sectionName);

    this.writeSection();

    this._writer.write(DxfCode.Start, DxfFileToken.endSection);
  }

  protected writeCadValue(value: CadValue): void {
    this._writer.write(93, value.flags);
    this._writer.write(90, value.valueType as number);

    // An empty or unknown value, or one the reader kept no data for (a date's binary chunk), has
    // no data to write; writing a placeholder would read back as a value.
    const valueType = value.isEmpty || value.value == null ? CadValueType.Unknown : value.valueType;
    switch (valueType) {
      case CadValueType.Unknown:
        break;
      case CadValueType.Double:
        this._writer.write(140, Number(value.value));
        break;
      case CadValueType.Date:
        if (this.version >= ACadVersion.AC1021 && value.value instanceof Date) {
          // A SYSTEMTIME, as the reader and the DWG writer encode it.
          const date = value.value;
          const bytes = new Uint8Array(16);
          const view = new DataView(bytes.buffer);
          [date.getFullYear(), date.getMonth() + 1, date.getDay(), date.getDate(), date.getHours(),
            date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
            .forEach((part, i) => view.setInt16(i * 2, part, true));
          this._writer.write(92, bytes.length);
          this._writer.write(310, bytes);
        } else {
          this._writer.write(91, 0);
        }
        break;
      case CadValueType.General:
      case CadValueType.String:
        this.writeLongTextValue(1, 2, value.value as string);
        break;
      case CadValueType.Point2D:
      case CadValueType.Point3D:
        this._writer.writeVector(11, value.value as IVector);
        break;
      case CadValueType.Long:
        this._writer.write(91, Number(value.value));
        break;
      case CadValueType.Handle: {
        const handleObj = value.value as IHandledCadObject;
        if (handleObj) {
          this._writer.writeHandle(330, handleObj);
        }
        break;
      }
      case CadValueType.Buffer:
      case CadValueType.ResultBuffer:
        this._writer.write(91, 0);
        break;
    }

    if (this.version >= ACadVersion.AC1021) {
      // Unit type, format string and formatted value (AutoCAD 2007 and later).
      this._writer.write(94, value.units as number);
      this._writer.write(300, value.format ?? '');
      this._writer.write(302, value.formattedValue ?? '');
    }

    this._writer.write(304, DxfFileToken.valueEnd);
  }

  static isMadeUpHandle(document: CadDocument, handle: number): boolean {
    const range = document.madeUpHandles;
    return range != null && handle >= range.first && handle <= range.last;
  }

  /**
   * In R12, whether the reader added the object as a default the file did not have. Reopening
   * adds it again.
   */
  protected isBuiltDefault(cadObject: CadObject): boolean {
    const range = this._document.madeUpHandles;
    return this.version <= ACadVersion.AC1009 && range != null && range.added.has(cadObject.handle);
  }

  protected writeCommonObjectData(cadObject: CadObject): void {
    if (this.version <= ACadVersion.AC1009) {
      // A handle the reader made up was not in the file; written, it would stop being made up
      // on reopening and move every other made-up handle.
      if (DxfSectionWriterBase.isMadeUpHandle(this._document, cadObject.handle)) return;
      if (cadObject instanceof DimensionStyle) {
        // An R12 DIMSTYLE keeps its handle in 105 (5 is DIMBLK), as ezdxf writes it and the reader
        // reads it. write() drops codes from 80 up for R12, so this one is written raw.
        this._writer.writeRaw(DxfCode.DimVarHandle, cadObject.handle);
      } else {
        this._writer.write(DxfCode.Handle, cadObject.handle);
      }
      return;
    }
    if (cadObject instanceof DimensionStyle) {
      this._writer.write(DxfCode.DimVarHandle, cadObject.handle);
    } else {
      this._writer.write(DxfCode.Handle, cadObject.handle);
    }

    if (cadObject.xDictionary !== null) {
      this._writer.write(DxfCode.ControlString, DxfFileToken.dictionaryToken);
      this._writer.write(DxfCode.HardOwnershipId, cadObject.xDictionary.handle);
      this._writer.write(DxfCode.ControlString, "}");
      this.holder.objects.push(cadObject.xDictionary);
    }

    cadObject.cleanReactors();
    if (cadObject.reactors.length > 0) {
      this._writer.write(DxfCode.ControlString, DxfFileToken.reactorsToken);
      for (const reactor of cadObject.reactors) {
        this._writer.write(DxfCode.SoftPointerId, reactor.handle);
      }
      this._writer.write(DxfCode.ControlString, "}");
    }

    this._writer.write(DxfCode.SoftPointerId, cadObject.owner!.handle);
  }

  protected writeExtendedData(xdata: ExtendedDataDictionary | null): void {
    if (xdata === null || !this.configuration.writeXData) {
      return;
    }

    for (const [appId, edataCollection] of xdata) {
      this._writer.write(DxfCode.ExtendedDataRegAppName, appId.name);

      for (const record of edataCollection.records) {
        if (record instanceof ExtendedDataBinaryChunk) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataControlString) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataInteger16) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataInteger32) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataReal) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataScale) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataDistance) {
          this._writer.write(record.code, record.value);
        } else if (record instanceof ExtendedDataDisplacement) {
          this._writer.writeVector(record.code, record.value as IVector);
        } else if (record instanceof ExtendedDataDirection) {
          this._writer.writeVector(record.code, record.value as IVector);
        } else if (record instanceof ExtendedDataCoordinate) {
          this._writer.writeVector(record.code, record.value as IVector);
        } else if (record instanceof ExtendedDataWorldCoordinate) {
          this._writer.writeVector(record.code, record.value as IVector);
        } else if (record instanceof ExtendedDataLayer) {
          // DXF 1003 is the layer name; the reader resolves it back to the layer.
          const layer = record.resolveReference(this._document);
          if (layer) this._writer.write(DxfCode.ExtendedDataLayerName, layer.name);
        } else if (typeof (record as Partial<IExtendedDataHandleReference>).resolveReference === 'function') {
          // A 1005 is written as read, like AutoCAD's save, even when it names no object here.
          this._writer.write(DxfCode.ExtendedDataHandle, (record as Partial<IExtendedDataHandleReference>).value);
        } else if (record instanceof ExtendedDataString) {
          this._writer.write(record.code, record.value);
        } else {
          throw new Error(`ExtendedDataRecord of type ${record.constructor.name} not supported.`);
        }
      }
    }
  }

  protected writeCommonEntityData(entity: Entity): void {
    const map = DxfClassMap.create(Entity);

    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.entity);

    // Keep the explicit R12 layer vocabulary used by the native legacy writer.
    if (this.version <= ACadVersion.AC1009) this._writer.write(8, entity.layer?.name ?? '0');
    else this._writer.writeIfNotDefault(8, entity.layer?.name ?? '0', '0');
    this._writer.writeIfNotDefault(6, entity.lineType?.name ?? 'ByLayer', 'ByLayer');
    // The entity's material (R2007+; AutoCAD writes it only when it is not ByLayer, the default an
    // entity reads without one). Upstream never wrote it, so a save detached every entity from it.
    if (this.version >= ACadVersion.AC1021 && entity.material !== null) {
      this._writer.writeHandle(347, entity.material, map);
    }

    if (entity.bookColor !== null) {
      this._writer.write(62, entity.bookColor.color.getApproxIndex());
      this._writer.writeTrueColor(420, entity.bookColor.color);
      this._writer.write(430, entity.bookColor.name);
    } else if (entity.color.isTrueColor) {
      // AutoCAD writes the nearest ACI before the true colour, for readers that take only 62.
      this._writer.write(62, entity.color.getApproxIndex());
      if (this.version > ACadVersion.AC1009) this._writer.writeTrueColor(420, entity.color);
    } else {
      this._writer.write(62, entity.color.index);
    }

    if (entity.transparency.value >= 0) {
      this._writer.write(440, Transparency.toAlphaValue(entity.transparency));
    }

    this._writer.writeIfNotDefault(48, entity.lineTypeScale, 1, map);
    this._writer.writeIfNotDefault(60, entity.isInvisible ? 1 : 0, 0, map);

    if (entity.owner instanceof BlockRecord) {
      const record = entity.owner as BlockRecord;
      if (record.layout !== null) {
        this._writer.write(67, record.layout.isPaperSpace ? 1 : 0);
      }
    }

    if (this.version >= ACadVersion.AC1015) {
      this._writer.writeIfNotDefault(370, entity.lineWeight, LineWeightType.ByLayer, map);
      // The entity's plot style name; upstream never wrote it. DXF has no group for ByBlock or the
      // dictionary default, which a DWG states by flag.
      if (entity.plotStyleType === EntityPlotStyleType.ByObjectId) {
        this._writer.write(390, entity.plotStyleName, map);
      }
    }
  }

  protected abstract writeSection(): void;

  protected writeLongTextValue(code: number, subcode: number, text: string | null | undefined): void {
    text ??= '';
    while (text.length > 250) {
      this._writer.write(subcode, text.substring(0, 250));
      text = text.substring(250);
    }
    this._writer.write(code, text);
  }

  protected notify(message: string, notificationType: NotificationType = NotificationType.None, ex?: Error): void {
    if (this.onNotification) {
      this.onNotification(this, new NotificationEventArgs(message, notificationType, ex));
    }
  }

  // =====================================================
  // Entity writing methods (from DxfSectionWriterBase.Entities.cs)
  // =====================================================

  protected writeEntity(entity: Entity): void {
    if (this.version <= ACadVersion.AC1009 && entity instanceof LwPolyline) {
      this._writeR12LwPolyline(entity);
      return;
    }
    if (!this._isEntitySupported(entity)) {
      return;
    }
    if (entity instanceof UnknownEntity) {
      this.writeRawObject(entity);
      return;
    }
	const validationErrors = entity.validate(CadFileFormat.DXF, this.version);
	if (validationErrors.length > 0) {
	  this.notify(`Invalid entity ${entity.constructor.name}: ${validationErrors.join(' ')}`, NotificationType.Warning);
	  return;
	}

    this._writer.write(DxfCode.Start, entity.objectName);

    this.writeCommonObjectData(entity);
    this.writeCommonEntityData(entity);

    const map = DxfMap.create(entity.constructor.name);

    if (entity instanceof Arc) {
      this._writeArc(entity, map);
    } else if (entity instanceof Circle) {
      this._writeCircle(entity, map);
    } else if (entity instanceof DimensionLinear) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionAligned) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionRadius) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionDiameter) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionAngular2Line) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionAngular3Pt) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionOrdinate) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionArc) {
      this._writeDimension(entity, map);
    } else if (entity instanceof DimensionRadialLarge) {
      this._writeDimension(entity, map);
    } else if (entity instanceof Ellipse) {
      this._writeEllipse(entity, map);
    } else if (entity instanceof Face3D) {
      this._writeFace3D(entity, map);
    } else if (entity instanceof Hatch) {
      this._writeHatch(entity, map);
    } else if (entity instanceof TableEntity) {
      this._writeTableEntity(entity, map);
    } else if (entity instanceof Insert) {
      this._writeInsert(entity, map);
    } else if (entity instanceof Leader) {
      this._writeLeader(entity, map);
    } else if (entity instanceof Line) {
      this._writeLine(entity, map);
    } else if (entity instanceof LwPolyline) {
      this._writeLwPolyline(entity, map);
    } else if (entity instanceof Mesh) {
      this._writeMesh(entity, map);
    } else if (entity instanceof MLine) {
      this._writeMLine(entity, map);
    } else if (entity instanceof MText) {
      this._writeMText(entity, map);
    } else if (entity instanceof MultiLeader) {
      this._writeMultiLeader(entity, map);
    } else if (entity instanceof Ole2Frame) {
      this._writeOle2Frame(entity, map);
    } else if (entity instanceof PdfUnderlay) {
      this._writePdfUnderlay(entity, map);
    } else if (entity instanceof Point) {
      this._writePoint(entity, map);
    } else if (entity instanceof Polyline2D) {
      this._writePolyline(entity, map);
    } else if (entity instanceof Polyline3D) {
      this._writePolyline(entity, map);
    } else if (entity instanceof PolyfaceMesh) {
      this._writePolyline(entity, map);
    } else if (entity instanceof PolygonMesh) {
      this._writePolyline(entity, map);
    } else if (entity instanceof Ray) {
      this._writeRay(entity, map);
    } else if (entity instanceof Shape) {
      this._writeShape(entity, map);
    } else if (entity instanceof ProxyEntity) {
      this._writeProxyEntity(entity);
    } else if (entity instanceof Region || entity instanceof Solid3D || entity instanceof CadBody) {
      this._writeModelerGeometry(entity);
    } else if (entity instanceof Solid) {
      this._writeSolid(entity, map);
    } else if (entity instanceof Spline) {
      this._writeSpline(entity, map);
    } else if (entity instanceof AttributeBase) {
      this._writeAttributeBase(entity, map);
    } else if (entity instanceof TextEntity) {
      this._writeTextEntity(entity, map);
    } else if (entity instanceof Tolerance) {
      this._writeTolerance(entity, map);
    } else if (entity instanceof Viewport) {
      this._writeViewport(entity, map);
    } else if (entity instanceof XLine) {
      this._writeXLine(entity, map);
    } else if (entity instanceof RasterImage || entity instanceof Wipeout) {
      this._writeCadImage(entity as CadImage, map);
    } else if (entity instanceof Seqend) {
      // SEQEND has only the common data already written above.
    } else {
      this.notify(`Entity not implemented: ${entity.constructor.name}`, NotificationType.NotImplemented);
    }

    // A POLYLINE or INSERT with attributes wrote its xdata before its children (see
    // _writeOwnerExtendedData); written here it would follow the SEQEND and be read as the SEQEND's.
    if (this._xdataWrittenBy.has(entity)) this._xdataWrittenBy.delete(entity);
    else this.writeExtendedData(entity.extendedData);
  }

  private readonly _xdataWrittenBy = new Set<Entity>();

  /** Writes an entity's xdata ahead of its VERTEX/ATTRIB children, where the record ends. */
  private _writeOwnerExtendedData(entity: Entity): void {
    this.writeExtendedData(entity.extendedData);
    this._xdataWrittenBy.add(entity);
  }

  private _isEntitySupported(entity: Entity): boolean {
    if (this.version < ACadVersion.AC1014 &&
      (entity instanceof CadBody || entity instanceof Region || entity instanceof Solid3D)) return false;
    if (this.version <= ACadVersion.AC1009 &&
      !['LINE', 'CIRCLE', 'ARC', 'POINT', 'TEXT', 'ATTRIB', 'ATTDEF', 'INSERT',
        'POLYLINE', 'VERTEX', 'SEQEND', '3DFACE', 'SOLID', 'TRACE', 'SHAPE', 'DIMENSION', 'VIEWPORT'].includes(entity.objectName)) {
      this.notify(`Entity ${entity.objectName} is not supported by R12 DXF.`, NotificationType.NotImplemented);
      return false;
    }
    if (entity instanceof Surface) return false;
    if (entity instanceof UnknownEntity) {
      if (entity.rawDxfCodes == null && entity.rawDwgData != null) {
        this.notify(`Unknown entity ${entity.objectName} was read from a DWG file and cannot be written to DXF: ${entity.handle}`, NotificationType.NotImplemented);
      }
      return entity.rawDxfCodes != null;
    }
    return true;
  }

  /**
   * Write an object the reader could not map from the group codes it kept, so that a save does
   * not drop it. The handle and owner come from the object; everything else is written as read.
   */
  protected writeRawObject(cadObject: CadObject & IRawCadObject): void {
    this._writer.write(DxfCode.Start, cadObject.objectName);

    let inGroup = false;
    let beforeSubclass = true;
    for (const { code, value } of cadObject.rawDxfCodes!) {
      let output = value;
      if (code === 100) {
        beforeSubclass = false;
      } else if (code === 102) {
        inGroup = String(value).startsWith('{');
      } else if (code === 5 && beforeSubclass) {
        output = cadObject.handle;
      } else if (code === 330 && beforeSubclass && !inGroup && cadObject.owner != null && cadObject.owner.handle !== 0) {
        output = cadObject.owner.handle;
      }
      this._writer.writeRaw(code, output);
    }

    if (cadObject.xDictionary !== null) {
      this.holder.objects.push(cadObject.xDictionary);
    }
    for (const child of cadObject.rawOwnedObjects) {
      if (!(child instanceof Entity)) {
        this.holder.objects.push(child);
      }
    }
  }

  private _writeR12LwPolyline(polyline: LwPolyline): void {
    this._writer.write(0, 'POLYLINE');
    this.writeCommonObjectData(polyline);
    this.writeCommonEntityData(polyline);
    this._writer.write(66, 1);
    this._writer.write(70, polyline.flags);
    this._writer.writeVector(10, new XYZ(0, 0, polyline.elevation));
    this._writer.write(39, polyline.thickness);
    this._writer.writeVector(210, polyline.normal);
    this.writeExtendedData(polyline.extendedData);
    for (const vertex of polyline.vertices) {
      this._writer.write(0, 'VERTEX');
      this._writer.write(8, polyline.layer.name);
      this._writer.writeVector(10, new XYZ(vertex.location.x, vertex.location.y, 0));
      this._writer.write(70, 0);
      this._writer.write(40, polyline.constantWidth || vertex.startWidth);
      this._writer.write(41, polyline.constantWidth || vertex.endWidth);
      this._writer.write(42, vertex.bulge);
    }

    this._writer.write(0, 'SEQEND');
    this._writer.write(8, polyline.layer.name);
  }

  private _writeProxyEntity(proxy: ProxyEntity): void {
    this._writer.write(100, DxfSubclassMarker.proxyEntity);
    this._writer.write(90, proxy.proxyClassId);
    this._writer.write(91, proxy.classId);
    this._writer.write(71, proxy.version);
    this._writer.write(97, proxy.maintenanceVersion);
    this._writer.write(70, proxy.originalDataFormatDxf ? 1 : 0);
    if (proxy.proxyGeometries.length) {
      const graphics = ProxyGeometryWriter.writeGeometries(proxy.proxyGeometries);
      this._writer.write(160, graphics.length);
      this._writer.write(310, graphics);
    }
    this._writer.write(162, proxy.stringData?.length ?? 0);
    if (proxy.stringData?.length) this._writer.write(311, proxy.stringData);
    this._writer.write(161, proxy.binaryData?.length ?? 0);
    if (proxy.binaryData?.length) this._writer.write(310, proxy.binaryData);
    for (const handle of proxy.referencedObjectHandles) this._writer.write(330, handle);
    this._writer.write(94, 0);
  }

  private _writeArc(arc: Arc, map: DxfMap): void {
    this._writeCircle(arc, map);
    const subclass = map.subClasses.get(DxfSubclassMarker.arc)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.arc);
    this._writer.write(50, arc.startAngle, subclass);
    this._writer.write(51, arc.endAngle, subclass);
  }

  private _writeCircle(circle: Circle, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.circle)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.circle);
    this._writer.writeVector(10, circle.center, subclass);
    this._writer.write(40, circle.radius, subclass);
    this._writer.write(39, circle.thickness, subclass);
    this._writer.writeVector(210, circle.normal, subclass);
  }

  private _writeDimension(dim: Dimension, map: DxfMap): void {
    const dimMap = map.subClasses.get(DxfSubclassMarker.dimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.dimension);

    this._writer.write(2, dim.block?.name ?? '', dimMap);
    this._writer.writeVector(10, dim.definitionPoint, dimMap);
    this._writer.writeVector(11, dim.textMiddlePoint, dimMap);
    this._writer.writeVector(12, dim.insertionPoint, dimMap);
    this._writer.write(70, dim.flags, dimMap);
    this._writer.write(71, dim.attachmentPoint, dimMap);
    this._writer.write(72, dim.lineSpacingStyle, dimMap);
    this._writer.write(41, dim.lineSpacingFactor, dimMap);
    if (this.version >= ACadVersion.AC1021) {
      this._writer.write(74, dim.flipArrow1, dimMap);
      this._writer.write(75, dim.flipArrow2, dimMap);
    }
    this._writer.write(42, dim.measurement, dimMap);
    this._writer.write(1, dim.text, dimMap);
    this._writer.write(53, dim.textRotation, dimMap);
    this._writer.write(51, dim.horizontalDirection, dimMap);
    this._writer.writeVector(210, dim.normal, dimMap);
    this._writer.write(3, dim.style?.name ?? '', dimMap);

    if (dim instanceof DimensionAligned) {
      this._writeDimensionAligned(dim, map);
    }
    if (dim instanceof DimensionLinear) {
      this._writeDimensionLinear(dim, map);
    }
    if (dim instanceof DimensionRadius) {
      this._writeDimensionRadius(dim, map);
    }
    if (dim instanceof DimensionDiameter) {
      this._writeDimensionDiameter(dim, map);
    }
    if (dim instanceof DimensionAngular2Line) {
      this._writeDimensionAngular2Line(dim, map);
    }
    if (dim instanceof DimensionAngular3Pt) {
      this._writeDimensionAngular3Pt(dim, map);
    }
    if (dim instanceof DimensionArc) {
      this._writeDimensionArc(dim, map);
    }
    if (dim instanceof DimensionRadialLarge) {
      this._writeDimensionRadialLarge(dim, map);
    }
    if (dim instanceof DimensionOrdinate) {
      this._writeDimensionOrdinate(dim, map);
    }
  }

  private _writeDimensionAligned(dim: DimensionAligned, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.alignedDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.alignedDimension);
    this._writer.writeVector(13, dim.firstPoint, subclass);
    this._writer.writeVector(14, dim.secondPoint, subclass);
    // The oblique angle of the extension lines is optional and only stated when set (DXF
    // reference, DIMENSION: "Linear dimension types with an oblique angle have an optional
    // group code 52"), as AutoCAD writes it, in degrees.
    if (dim.extLineRotation !== 0) this._writer.write(52, MathHelper.radToDegRoundTrip(dim.extLineRotation));
  }

  private _writeDimensionLinear(dim: DimensionLinear, map: DxfMap): void {
    this._writeDimensionAligned(dim, map);
    const subclass = map.subClasses.get(DxfSubclassMarker.linearDimension);
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.linearDimension);
    this._writer.write(50, dim.rotation, subclass);
  }

  private _writeDimensionRadius(dim: DimensionRadius, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.radialDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.radialDimension);
    this._writer.writeVector(15, dim.angleVertex, subclass);
    this._writer.write(40, dim.leaderLength, subclass);
  }

  private _writeDimensionDiameter(dim: DimensionDiameter, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.diametricDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.diametricDimension);
    this._writer.writeVector(15, dim.angleVertex, subclass);
    this._writer.write(40, dim.leaderLength, subclass);
  }

  private _writeDimensionAngular2Line(dim: DimensionAngular2Line, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.angular2LineDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.angular2LineDimension);
    this._writer.writeVector(13, dim.firstPoint, subclass);
    this._writer.writeVector(14, dim.secondPoint, subclass);
    this._writer.writeVector(15, dim.angleVertex, subclass);
    this._writer.writeVector(16, dim.dimensionArc, subclass);
  }

  private _writeDimensionAngular3Pt(dim: DimensionAngular3Pt, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.angular3PointDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.angular3PointDimension);
    this._writer.writeVector(13, dim.firstPoint, subclass);
    this._writer.writeVector(14, dim.secondPoint, subclass);
    this._writer.writeVector(15, dim.angleVertex, subclass);
  }

  private _writeDimensionArc(dim: DimensionArc, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.arcDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.arcDimension);
    this._writer.writeVector(13, dim.firstPoint, subclass);
    this._writer.writeVector(14, dim.secondPoint, subclass);
    this._writer.writeVector(15, dim.center, subclass);
    this._writer.write(70, dim.isPartial ? 1 : 0, subclass);
    this._writer.write(40, dim.startAngle, subclass);
    this._writer.write(41, dim.endAngle, subclass);
    this._writer.write(71, dim.hasLeader ? 1 : 0, subclass);
    // AutoCAD writes both leader points whether or not 71 says there is a leader.
    this._writer.writeVector(16, dim.leaderPoint1, subclass);
    this._writer.writeVector(17, dim.leaderPoint2, subclass);
  }

  private _writeDimensionRadialLarge(dim: DimensionRadialLarge, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.radialDimensionLarge)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.radialDimensionLarge);
    this._writer.writeVector(13, dim.overrideCenter, subclass);
    this._writer.writeVector(14, dim.jogPoint, subclass);
    this._writer.writeVector(15, dim.chordPoint, subclass);
    this._writer.write(40, dim.leaderLength, subclass);
  }

  private _writeDimensionOrdinate(dim: DimensionOrdinate, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.ordinateDimension)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.ordinateDimension);
    this._writer.writeVector(13, dim.featureLocation, subclass);
    this._writer.writeVector(14, dim.leaderEndpoint, subclass);
  }

  private _writeEllipse(ellipse: Ellipse, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.ellipse)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.ellipse);
    this._writer.writeVector(10, ellipse.center, subclass);
    this._writer.writeVector(11, ellipse.majorAxisEndPoint, subclass);
    this._writer.writeVector(210, ellipse.normal, subclass);
    this._writer.write(40, ellipse.radiusRatio, subclass);
    this._writer.write(41, ellipse.startParameter, subclass);
    this._writer.write(42, ellipse.endParameter, subclass);
  }

  private _writeFace3D(face: Face3D, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.face3d)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.face3d);
    this._writer.writeVector(10, face.firstCorner, subclass);
    this._writer.writeVector(11, face.secondCorner, subclass);
    this._writer.writeVector(12, face.thirdCorner, subclass);
    this._writer.writeVector(13, face.fourthCorner, subclass);
    this._writer.write(70, face.flags, subclass);
  }

  private _writeHatch(hatch: Hatch, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.hatch)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.hatch);

    this._writer.write(10, 0, subclass);
    this._writer.write(20, 0, subclass);
    this._writer.write(30, hatch.elevation, subclass);
    this._writer.writeVector(210, hatch.normal, subclass);

    this._writer.write(2, hatch.pattern?.name, subclass);
    this._writer.write(70, hatch.isSolid ? 1 : 0, subclass);
    this._writer.write(71, hatch.isAssociative ? 1 : 0, subclass);

    this._writer.write(91, hatch.paths.length);

    for (const path of hatch.paths) {
      this._writeBoundaryPath(path);
    }

    this._writer.write(75, hatch.style, subclass);
    this._writer.write(76, hatch.patternType, subclass);

    // AutoCAD writes the pattern of a SOLID hatch too (one line at 45 degrees); keep whatever was read.
    if (hatch.pattern?.lines.length > 0) {
      this._writer.write(52, hatch.patternAngle, subclass);
      this._writer.write(41, hatch.patternScale, subclass);
      this._writer.write(77, hatch.isDouble ? 1 : 0, subclass);

      this._writer.write(78, hatch.pattern.lines.length);
      for (const line of hatch.pattern.lines) {
        this._writer.write(53, MathHelper.radToDegRoundTrip(line.angle));
        this._writer.write(43, line.basePoint.x);
        this._writer.write(44, line.basePoint.y);
        this._writer.write(45, line.offset.x);
        this._writer.write(46, line.offset.y);
        this._writer.write(79, line.dashLengths.length);
        for (const dash of line.dashLengths) {
          this._writer.write(49, dash);
        }
      }
    }

    if (hatch.pixelSize !== 0 || hatch.paths.some(path => (path.flags & BoundaryPathFlags.Derived) !== 0)) {
      this._writer.write(47, hatch.pixelSize, subclass);
    }

    this._writer.write(98, hatch.seedPoints.length);
    for (const pt of hatch.seedPoints) {
      this._writer.write(10, pt.x);
      this._writer.write(20, pt.y);
    }

    if (this.version > ACadVersion.AC1015 && hatch.gradientColor && !hatch.pattern?.lines.length) {
      this._writer.write(450, hatch.gradientColor.enabled ? 1 : 0);
      this._writer.write(451, hatch.gradientColor.reserved);
      this._writer.write(460, hatch.gradientColor.angle);
      this._writer.write(461, hatch.gradientColor.shift);
      this._writer.write(452, hatch.gradientColor.isSingleColorGradient ? 1 : 0);
      this._writer.write(462, hatch.gradientColor.colorTint);
      this._writer.write(453, hatch.gradientColor.colors.length);
      for (const gc of hatch.gradientColor.colors) {
        this._writer.write(463, gc.value);
        this._writer.write(63, gc.color.getApproxIndex());
        if (gc.color.isTrueColor) this._writer.writeTrueColor(421, gc.color);
      }
      this._writer.write(470, hatch.gradientColor.name ?? '');
    }
  }

  private _writeBoundaryPath(path: HatchBoundaryPath): void {
    this._writer.write(92, path.flags as number);

    if ((path.flags & BoundaryPathFlags.Polyline) !== 0) {
      for (const edge of path.edges) {
        if (edge instanceof HatchBoundaryPathPolyline) {
          this._writePolylineBoundary(edge);
        }
      }
    } else {
      this._writer.write(93, path.edges.length);
      for (const edge of path.edges) {
        this._writeBoundaryEdge(edge);
      }
    }

    this._writer.write(97, path.entities.length);
    for (const entity of path.entities) {
      this._writer.write(330, entity.handle);
    }
  }

  private _writePolylineBoundary(polyline: HatchBoundaryPathPolyline): void {
    const hasBulge = polyline.vertices.some(v => v.z !== 0);
    this._writer.write(72, hasBulge ? 1 : 0);
    this._writer.write(73, polyline.isClosed ? 1 : 0);
    this._writer.write(93, polyline.vertices.length);
    for (const v of polyline.vertices) {
      this._writer.write(10, v.x);
      this._writer.write(20, v.y);
      if (hasBulge) {
        this._writer.write(42, v.z);
      }
    }
  }

  private _writeHatchBoundaryAngles(startAngle: number, endAngle: number): void {
    // Written as read: an edge may end past 360 degrees (start 348.7, end 472.9), and wrapping it
    // changed the stored angle. Only -0 is written as 0.
    const degrees = (angle: number): number => {
      const value = MathHelper.radToDegRoundTrip(angle);
      return Object.is(value, -0) ? 0 : value;
    };

    this._writer.write(50, degrees(startAngle));
    this._writer.write(51, degrees(endAngle));
  }

  private _writeBoundaryEdge(edge: HatchBoundaryPathEdge): void {
    if (edge instanceof HatchBoundaryPathLine) {
      this._writer.write(72, 1);
      this._writer.write(10, edge.start.x);
      this._writer.write(20, edge.start.y);
      this._writer.write(11, edge.end.x);
      this._writer.write(21, edge.end.y);
    } else if (edge instanceof HatchBoundaryPathArc) {
      this._writer.write(72, 2);
      this._writer.write(10, edge.center.x);
      this._writer.write(20, edge.center.y);
      this._writer.write(40, edge.radius);
      this._writeHatchBoundaryAngles(edge.startAngle, edge.endAngle);
      this._writer.write(73, edge.counterClockWise ? 1 : 0);
    } else if (edge instanceof HatchBoundaryPathEllipse) {
      this._writer.write(72, 3);
      this._writer.write(10, edge.center.x);
      this._writer.write(20, edge.center.y);
      this._writer.write(11, edge.majorAxisEndPoint.x);
      this._writer.write(21, edge.majorAxisEndPoint.y);
      this._writer.write(40, edge.minorToMajorRatio);
      this._writeHatchBoundaryAngles(edge.startAngle, edge.endAngle);
      this._writer.write(73, edge.counterClockWise ? 1 : 0);
    } else if (edge instanceof HatchBoundaryPathSpline) {
      this._writer.write(72, 4);
      this._writer.write(94, edge.degree);
      this._writer.write(73, edge.isRational ? 1 : 0);
      this._writer.write(74, edge.isPeriodic ? 1 : 0);
      this._writer.write(95, edge.knots.length);
      this._writer.write(96, edge.controlPoints.length);
      for (const k of edge.knots) {
        this._writer.write(40, k);
      }
      for (const cp of edge.controlPoints) {
        this._writer.write(10, cp.x);
        this._writer.write(20, cp.y);
        if (edge.isRational) {
          this._writer.write(42, cp.z);
        }
      }
      if (edge.fitPoints.length > 0) {
        this._writer.write(97, edge.fitPoints.length);
        for (const fp of edge.fitPoints) {
          this._writer.write(11, fp.x);
          this._writer.write(21, fp.y);
        }
      }
      this._writer.write(12, edge.startTangent.x);
      this._writer.write(22, edge.startTangent.y);
      this._writer.write(13, edge.endTangent.x);
      this._writer.write(23, edge.endTangent.y);
    }
  }

  private _writeInsert(insert: Insert, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.insert)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.insert);

    this._writer.write(66, insert.hasAttributes ? 1 : 0);
    this._writer.write(2, insert.block?.name ?? '', subclass);
    this._writer.writeVector(10, insert.insertPoint, subclass);
    this._writer.write(41, insert.xScale, subclass);
    this._writer.write(42, insert.yScale, subclass);
    this._writer.write(43, insert.zScale, subclass);
    this._writer.write(50, insert.rotation, subclass);
    this._writer.write(70, insert.columnCount, subclass);
    this._writer.write(71, insert.rowCount, subclass);
    this._writer.write(44, insert.columnSpacing, subclass);
    this._writer.write(45, insert.rowSpacing, subclass);
    this._writer.writeVector(210, insert.normal, subclass);
    if (insert.hasAttributes) this._writeOwnerExtendedData(insert);

    for (const att of insert.attributes) {
      this.writeEntity(att);
    }

    if (insert.hasAttributes && insert.attributes.seqend) {
      this.writeEntity(insert.attributes.seqend);
    }
  }

  // ACAD_TABLE as AutoCAD writes it (DXF reference, ACAD_TABLE): the block reference, the table
  // header, the table-wide overrides as read (DEC-043), the row heights, the column widths and
  // then every cell, row by row.
  private _writeTableEntity(table: TableEntity, map: DxfMap): void {
    const insert = map.subClasses.get(DxfSubclassMarker.insert)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.insert);
    this._writer.write(2, table.block?.name ?? '', insert);
    this._writer.writeVector(10, table.insertPoint, insert);
    // AutoCAD writes no scale, rotation or normal for a table; keep any a table has.
    if (table.xScale !== 1) this._writer.write(41, table.xScale, insert);
    if (table.yScale !== 1) this._writer.write(42, table.yScale, insert);
    if (table.zScale !== 1) this._writer.write(43, table.zScale, insert);
    if (table.rotation !== 0) this._writer.write(50, table.rotation, insert);
    if (table.normal.x !== 0 || table.normal.y !== 0 || table.normal.z !== 1) {
      this._writer.writeVector(210, table.normal, insert);
    }

    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.tableEntity);
    if (this.version >= ACadVersion.AC1024) {
      this._writer.write(280, table.version);
    }
    this._writer.writeHandle(342, table.style);
    this._writer.writeHandle(343, table.block);
    this._writer.writeVector(11, table.horizontalDirection);
    this._writer.write(90, table.valueFlag);
    this._writer.write(91, table.rows.length);
    this._writer.write(92, table.columns.length);
    if (table.tableOverrideDxfCodes.length > 0) {
      for (const { code, value } of table.tableOverrideDxfCodes) {
        this._writer.writeRaw(code, value);
      }
    } else {
      // No override values are kept (a table built in memory or read from DWG), so state none:
      // a flag bit with no value would, for example, suppress the title row.
      for (const code of [93, 94, 95, 96]) {
        this._writer.write(code, 0);
      }
    }
    for (const row of table.rows) {
      this._writer.write(141, row.height);
    }
    for (const column of table.columns) {
      this._writer.write(142, column.width);
    }
    for (const row of table.rows) {
      for (const cell of row.cells) {
        this._writeTableEntityCell(cell);
      }
    }
  }

  // Before AutoCAD 2007 a cell carries its override flags in 177 (a 16-bit word) and its text in
  // 1; from 2007 on the flags are in 91 and the value in a CELL_VALUE block. Each override value
  // follows only when its flag is set, in the order AutoCAD writes them.
  private _writeTableEntityCell(cell: TableEntityCell): void {
    const r2007Plus = this.version >= ACadVersion.AC1021;
    const flags = cell.overrideFlags;
    const style = cell.styleOverride;
    const content = cell.content ?? cell.contents[0] ?? null;

    this._writer.write(171, cell.type);
    this._writer.write(172, cell.edgeFlags);
    this._writer.write(173, cell.mergedValue);
    this._writer.write(174, cell.autoFit ? 1 : 0);
    this._writer.write(175, cell.borderWidth);
    this._writer.write(176, cell.borderHeight);
    if (r2007Plus) {
      this._writer.write(91, flags);
    } else {
      this._writer.write(177, (flags << 16) >> 16);
    }
    this._writer.write(178, cell.virtualEdgeFlag);
    this._writer.write(145, cell.rotation);

    if (cell.type === CellType.Block) {
      this._writer.writeHandle(340, cell.value ?? content?.blockRecord ?? null);
      this._writer.write(144, cell.blockScale);
    } else if (!r2007Plus) {
      const value = content?.cadValue.value;
      const text = typeof value === 'string' ? value : content?.cadValue.formattedValue || (value == null ? '' : String(value));
      this.writeLongTextValue(1, 2, text);
    }

    if ((flags & CellOverrideFlags.CellAlignment) !== 0) this._writer.write(170, style.cellAlignment);
    if ((flags & CellOverrideFlags.BackgroundColor) !== 0) this._writer.write(63, style.backgroundColor.getApproxIndex());
    if ((flags & CellOverrideFlags.ContentColor) !== 0) this._writer.write(64, style.contentColor.getApproxIndex());
    if ((flags & CellOverrideFlags.BackgroundFillNone) !== 0) this._writer.write(283, style.isFillColorOn ? 1 : 0);
    if ((flags & CellOverrideFlags.TextStyle) !== 0 && style.textStyle != null) this._writer.write(7, style.textStyle.name);
    if ((flags & CellOverrideFlags.TextHeight) !== 0) this._writer.write(140, style.textHeight);
    const borders: [CellBorder, number, number, CellOverrideFlags, CellOverrideFlags][] = [
      [style.rightBorder, 275, 65, CellOverrideFlags.RightGridLineWeight, CellOverrideFlags.RightGridColor],
      [style.bottomBorder, 276, 66, CellOverrideFlags.BottomGridLineWeight, CellOverrideFlags.BottomGridColor],
      [style.leftBorder, 278, 68, CellOverrideFlags.LeftGridLineWeight, CellOverrideFlags.LeftGridColor],
      [style.topBorder, 279, 69, CellOverrideFlags.TopGridLineWeight, CellOverrideFlags.TopGridColor],
    ];
    for (const [border, lineWeightCode, colorCode, lineWeightFlag, colorFlag] of borders) {
      if ((flags & lineWeightFlag) !== 0) this._writer.write(lineWeightCode, border.lineWeight);
      if ((flags & colorFlag) !== 0) this._writer.write(colorCode, border.color.getApproxIndex());
    }

    if (r2007Plus) {
      this._writer.write(92, 0);
      this._writer.write(301, 'CELL_VALUE');
      let value = content?.cadValue;
      if (value == null) {
        value = new CadValue();
        value.isEmpty = true;
      }
      this.writeCadValue(value);
    }
  }

  private _writeLeader(leader: Leader, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.leader)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.leader);

    this._writer.write(3, leader.style?.name ?? '', subclass);
    this._writer.write(71, leader.arrowHeadEnabled ? 1 : 0, subclass);
    this._writer.write(72, leader.pathType, subclass);
    this._writer.write(73, leader.creationType, subclass);
    this._writer.write(74, leader.hookLineDirection ? 1 : 0, subclass);
    this._writer.write(75, leader.hasHookline ? 1 : 0, subclass);
    this._writer.write(40, leader.textHeight, subclass);
    this._writer.write(41, leader.textWidth, subclass);
    this._writer.write(76, leader.vertices.length);

    for (const v of leader.vertices) {
      this._writer.writeVector(10, v);
    }

    this._writer.write(77, leader.byBlockColor.index, subclass);
    this._writer.writeHandle(340, leader.associatedAnnotation);
    this._writer.writeVector(210, leader.normal, subclass);
    this._writer.writeVector(211, leader.horizontalDirection, subclass);
    this._writer.writeVector(212, leader.blockOffset, subclass);
    this._writer.writeVector(213, leader.annotationOffset, subclass);
  }

  private _writeLine(line: Line, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.line)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.line);
    this._writer.write(39, line.thickness, subclass);
    this._writer.writeVector(10, line.startPoint, subclass);
    this._writer.writeVector(11, line.endPoint, subclass);
    this._writer.writeVector(210, line.normal, subclass);
  }

  private _writeLwPolyline(polyline: LwPolyline, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.lwPolyline)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.lwPolyline);

    this._writer.write(90, polyline.vertices.length);
    this._writer.write(70, polyline.flags, subclass);
    this._writer.write(43, polyline.constantWidth, subclass);
    this._writer.write(38, polyline.elevation, subclass);
    this._writer.write(39, polyline.thickness, subclass);
    this._writer.writeVector(210, polyline.normal, subclass);

    for (const v of polyline.vertices) {
      this._writer.write(10, v.location.x);
      this._writer.write(20, v.location.y);
      this._writer.write(40, v.startWidth);
      this._writer.write(41, v.endWidth);
      this._writer.write(42, v.bulge);
      if (v.id !== 0) {
        this._writer.write(91, v.id);
      }
    }
  }

  private _writeMesh(mesh: Mesh, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.mesh)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.mesh);

    this._writer.write(71, mesh.version, subclass);
    this._writer.write(72, mesh.blendCrease, subclass);
    this._writer.write(91, mesh.subdivisionLevel, subclass);

    this._writer.write(92, mesh.vertices.length);
    for (const v of mesh.vertices) {
      this._writer.writeVector(10, v);
    }

    let faceListSize = 0;
    for (const face of mesh.faces) {
      faceListSize += 1 + face.length;
    }
    this._writer.write(93, faceListSize);
    for (const face of mesh.faces) {
      this._writer.write(90, face.length);
      for (const idx of face) {
        this._writer.write(90, idx);
      }
    }

    this._writer.write(94, mesh.edges.length);
    for (const edge of mesh.edges) {
      this._writer.write(90, edge.start);
      this._writer.write(90, edge.end);
    }

    this._writer.write(95, mesh.edges.length);
    for (const edge of mesh.edges) {
      this._writer.write(140, edge.crease);
    }
  }

  private _writeMLine(mline: MLine, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.mLine)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.mLine);

    this._writer.writeHandle(340, mline.style, subclass);
    this._writer.write(40, mline.scaleFactor, subclass);
    this._writer.write(70, mline.justification, subclass);
    this._writer.write(71, mline.flags, subclass);
    this._writer.write(72, mline.vertices.length);
    this._writer.write(73, mline.style?.elements.length ?? 0);

    this._writer.writeVector(10, mline.startPoint, subclass);
    this._writer.writeVector(210, mline.normal, subclass);

    for (const vertex of mline.vertices) {
      this._writer.writeVector(11, vertex.position);
      this._writer.writeVector(12, vertex.direction);
      this._writer.writeVector(13, vertex.miter);

      for (const segment of vertex.segments) {
        this._writer.write(74, segment.parameters.length);
        for (const p of segment.parameters) {
          this._writer.write(41, p);
        }
        this._writer.write(75, segment.areaFillParameters.length);
        for (const p of segment.areaFillParameters) {
          this._writer.write(42, p);
        }
      }
    }
  }

  private _writeMText(mtext: MText, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.mText)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.mText);

    this._writer.writeVector(10, mtext.insertPoint, subclass);
    this._writer.write(40, mtext.height, subclass);
    this._writer.write(41, mtext.rectangleWidth, subclass);
    this._writer.write(46, mtext.rectangleHeight, subclass);
    this._writer.write(71, mtext.attachmentPoint, subclass);
    this._writer.write(72, mtext.drawingDirection, subclass);

    this.writeLongTextValue(1, 3, mtext.value ?? '');

    this._writer.write(7, mtext.style?.name ?? '', subclass);
    this._writer.writeVector(210, mtext.normal, subclass);
    this._writer.writeVector(11, mtext.alignmentPoint, subclass);
    this._writer.write(73, mtext.lineSpacingStyle, subclass);
    this._writer.write(44, mtext.lineSpacing, subclass);
    if (this.version >= ACadVersion.AC1018 && mtext.backgroundFillFlags !== 0) {
      this._writer.write(90, mtext.backgroundFillFlags, subclass);
      if ((mtext.backgroundFillFlags & 0x11) !== 0) {
      this._writer.writeCmColor(63, mtext.backgroundColor, subclass);
      this._writer.write(45, mtext.backgroundScale, subclass);
      if (mtext.backgroundColor.isTrueColor) this._writer.writeTrueColor(421, mtext.backgroundColor);
      this._writer.write(441, mtext.backgroundTransparency);
      }
    }

    // R2018 keeps the column settings in an embedded object (DXF reference, MTEXT); AutoCAD
    // writes it after the background groups. Static columns carry no heights.
    const columns = mtext.columnData;
    if (this.version >= ACadVersion.AC1032 && columns != null && mtext.hasColumns) {
      const direction = mtext.alignmentPoint.getLength() > 0 ? mtext.alignmentPoint : new XYZ(1, 0, 0);
      this._writer.write(101, 'Embedded Object');
      this._writer.write(70, mtext.attachmentPoint);
      this._writer.writeVector(10, direction);
      this._writer.writeVector(11, mtext.insertPoint);
      this._writer.write(40, mtext.rectangleWidth);
      this._writer.write(41, mtext.rectangleHeight);
      this._writer.write(42, mtext.horizontalWidth);
      this._writer.write(43, mtext.verticalHeight);
      this._writer.write(71, columns.columnType);
      this._writer.write(72, columns.columnCount);
      this._writer.write(44, columns.width);
      this._writer.write(45, columns.gutter);
      this._writer.write(73, columns.autoHeight ? 1 : 0);
      this._writer.write(74, columns.flowReversed ? 1 : 0);
      for (const height of columns.heights) {
        this._writer.write(46, height);
      }
    }
  }

  private _writeMultiLeader(mleader: MultiLeader, map: DxfMap): void {
    // AcDbMLeader in AutoCAD's group-code order (DXF reference, MULTILEADER, checked against the
    // acadsharp samples R2000-R2018). Upstream wrote a few groups on the wrong codes and dropped
    // the rest, so a save reset every multileader to its style's defaults.
    const subclass = map.subClasses.get(DxfSubclassMarker.multiLeader)!;
    const b = (value: boolean): number => (value ? 1 : 0);
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.multiLeader);

    if (this.version >= ACadVersion.AC1024) this._writer.write(270, 2);

    this._writer.write(300, 'CONTEXT_DATA{');
    this._writeAnnotContext(mleader.contextData);
    this._writer.write(301, '}');

    this._writer.writeHandle(340, mleader.style);
    this._writer.write(90, mleader.propertyOverrideFlags, subclass);
    this._writer.write(170, mleader.pathType, subclass);
    this._writeMLeaderColor(91, mleader.lineColor);
    this._writer.writeHandle(341, mleader.leaderLineType);
    this._writer.write(171, mleader.leaderLineWeight, subclass);
    this._writer.write(290, b(mleader.enableLanding));
    this._writer.write(291, b(mleader.enableDogleg));
    this._writer.write(41, mleader.landingDistance, subclass);
    this._writer.write(42, mleader.arrowheadSize, subclass);
    this._writer.writeHandle(342, mleader.arrowhead);
    this._writer.write(172, mleader.contentType, subclass);
    this._writer.writeHandle(343, mleader.textStyle);
    this._writer.write(173, mleader.textLeftAttachment, subclass);
    this._writer.write(95, mleader.textRightAttachment, subclass);
    this._writer.write(174, mleader.textAngle, subclass);
    this._writer.write(175, mleader.textAlignment, subclass);
    this._writeMLeaderColor(92, mleader.textColor);
    this._writer.write(292, b(mleader.textFrame));
    this._writer.writeHandle(344, mleader.blockContentId);
    this._writeMLeaderColor(93, mleader.blockContentColor);
    this._writer.writeVector(10, mleader.blockContentScale, subclass);
    this._writer.write(43, mleader.blockContentRotation, subclass);
    this._writer.write(176, mleader.blockContentConnection, subclass);
    this._writer.write(293, b(mleader.enableAnnotationScale));
    for (const att of mleader.blockAttributes) {
      this._writer.writeHandle(330, att.attributeDefinition);
      this._writer.write(177, att.index);
      this._writer.write(44, att.width);
      this._writer.write(302, att.text);
    }
    this._writer.write(294, b(mleader.textDirectionNegative));
    this._writer.write(178, b(mleader.textAligninIPE));
    this._writer.write(179, mleader.textAttachmentPoint, subclass);
    this._writer.write(45, mleader.scaleFactor, subclass);
    if (this.version >= ACadVersion.AC1024) {
      this._writer.write(271, mleader.textAttachmentDirection, subclass);
      this._writer.write(272, mleader.textBottomAttachment, subclass);
      this._writer.write(273, mleader.textTopAttachment, subclass);
    }
    if (this.version >= ACadVersion.AC1027) {
      this._writer.write(295, b(mleader.extendedToText));
    }
  }

  // Multileader colours are 32-bit AcCmColor values (0xC0 ByLayer, 0xC1 index, 0xC2 RGB). The DXF
  // reader keeps some of them as the raw integer, which is written back unchanged.
  private _writeMLeaderColor(code: number, color: Color): void {
    this._writer.write(code, color.toCmValue());
  }

  private _writeAnnotContext(contextData: MultiLeaderObjectContextData): void {
    const ctxMap = DxfClassMap.create(MultiLeaderObjectContextData);
    const b = (value: boolean): number => (value ? 1 : 0);
    this._writer.write(40, contextData.scaleFactor, ctxMap);
    this._writer.writeVector(10, contextData.contentBasePoint, ctxMap);
    this._writer.write(41, contextData.textHeight, ctxMap);
    this._writer.write(140, contextData.arrowheadSize, ctxMap);
    this._writer.write(145, contextData.landingGap, ctxMap);
    this._writer.write(174, contextData.textLeftAttachment, ctxMap);
    this._writer.write(175, contextData.textRightAttachment, ctxMap);
    this._writer.write(176, contextData.textAlignment, ctxMap);
    this._writer.write(177, contextData.blockContentConnection, ctxMap);
    this._writer.write(290, b(contextData.hasTextContents));

    if (contextData.hasTextContents) {
      this._writer.write(304, contextData.textLabel ?? '');
      this._writer.writeVector(11, contextData.textNormal, ctxMap);
      this._writer.writeHandle(340, contextData.textStyle);
      this._writer.writeVector(12, contextData.textLocation, ctxMap);
      this._writer.writeVector(13, contextData.direction, ctxMap);
      this._writer.write(42, contextData.textRotation, ctxMap);
      this._writer.write(43, contextData.boundaryWidth, ctxMap);
      this._writer.write(44, contextData.boundaryHeight, ctxMap);
      this._writer.write(45, contextData.lineSpacingFactor, ctxMap);
      this._writer.write(170, contextData.lineSpacing, ctxMap);
      this._writeMLeaderColor(90, contextData.textColor);
      this._writer.write(171, contextData.textAttachmentPoint, ctxMap);
      this._writer.write(172, contextData.flowDirection, ctxMap);
      this._writeMLeaderColor(91, contextData.backgroundFillColor);
      this._writer.write(141, contextData.backgroundScaleFactor, ctxMap);
      this._writer.write(92, contextData.backgroundTransparency, ctxMap);
      this._writer.write(291, b(contextData.backgroundFillEnabled));
      this._writer.write(292, b(contextData.backgroundMaskFillOn));
      this._writer.write(173, contextData.columnType, ctxMap);
      this._writer.write(293, b(contextData.textHeightAutomatic));
      this._writer.write(142, contextData.columnWidth, ctxMap);
      this._writer.write(143, contextData.columnGutter, ctxMap);
      this._writer.write(294, b(contextData.columnFlowReversed));
      for (const size of contextData.columnSizes) {
        this._writer.write(144, size);
      }
      this._writer.write(295, b(contextData.wordBreak));
    }

    this._writer.write(296, b(contextData.hasContentsBlock));
    if (contextData.hasContentsBlock) {
      this._writer.writeHandle(341, contextData.blockContent);
      this._writer.writeVector(14, contextData.blockContentNormal, ctxMap);
      this._writer.writeVector(15, contextData.blockContentLocation, ctxMap);
      this._writer.writeVector(16, contextData.blockContentScale, ctxMap);
      this._writer.write(46, contextData.blockContentRotation, ctxMap);
      this._writeMLeaderColor(93, contextData.blockContentColor);
    }

    this._writer.writeVector(110, contextData.basePoint, ctxMap);
    this._writer.writeVector(111, contextData.baseDirection, ctxMap);
    this._writer.writeVector(112, contextData.baseVertical, ctxMap);
    this._writer.write(297, b(contextData.normalReversed));

    for (const root of contextData.leaderRoots) {
      this._writer.write(302, 'LEADER{');
      this._writeLeaderRoot(root);
      this._writer.write(303, '}');
    }

    if (this.version >= ACadVersion.AC1024) {
      this._writer.write(272, contextData.textBottomAttachment, ctxMap);
      this._writer.write(273, contextData.textTopAttachment, ctxMap);
    }
  }

  private _writeLeaderRoot(root: LeaderRoot): void {
    this._writer.write(290, root.contentValid ? 1 : 0);
    this._writer.write(291, root.unknown ? 1 : 0);
    this._writer.writeVector(10, root.connectionPoint);
    this._writer.writeVector(11, root.direction);
    for (const pair of root.breakStartEndPointsPairs) {
      this._writer.writeVector(12, pair.startPoint);
      this._writer.writeVector(13, pair.endPoint);
    }
    this._writer.write(90, root.leaderIndex);
    this._writer.write(40, root.landingDistance);

    for (const line of root.lines) {
      this._writer.write(304, 'LEADER_LINE{');
      this._writeLeaderLine(line);
      this._writer.write(305, '}');
    }

    if (this.version >= ACadVersion.AC1024) {
      this._writer.write(271, root.textAttachmentDirection);
    }
  }

  private _writeLeaderLine(line: LeaderLine): void {
    for (const pt of line.points) {
      this._writer.writeVector(10, pt);
    }
    for (const info of line.breakInfoEntries) {
      this._writer.write(90, info.segmentIndex);
      for (const pair of info.startEndPoints) {
        this._writer.writeVector(11, pair.startPoint);
        this._writer.writeVector(12, pair.endPoint);
      }
    }
    this._writer.write(91, line.index);
    if (this.version >= ACadVersion.AC1024) {
      this._writer.write(170, line.pathType);
      this._writeMLeaderColor(92, line.lineColor);
      this._writer.writeHandle(340, line.lineType);
      this._writer.write(171, line.lineWeight);
      this._writer.write(40, line.arrowheadSize);
      this._writer.writeHandle(341, line.arrowhead);
      this._writer.write(93, line.overrideFlags);
    }
  }

  private _writeOle2Frame(ole: Ole2Frame, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.ole2Frame)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.ole2Frame);
    this._writer.write(70, ole.version, subclass);
    this._writer.write(3, ole.sourceApplication, subclass);
    this._writer.writeVector(10, ole.upperLeftCorner, subclass);
    this._writer.writeVector(11, ole.lowerRightCorner, subclass);
    this._writer.write(71, ole.oleObjectType);
    this._writer.write(72, ole.isPaperSpace ? 1 : 0);
    this._writer.write(73, 3);
    this._writer.write(90, ole.binaryData.length);
    for (let offset = 0; offset < ole.binaryData.length; offset += 127) {
      this._writer.write(310, ole.binaryData.slice(offset, offset + 127));
    }
    this._writer.write(1, 'OLE');
  }

  private _writePdfUnderlay(underlay: PdfUnderlay, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.underlay)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.underlay);
    this._writer.writeHandle(340, underlay.definition, subclass);
    this._writer.writeVector(10, underlay.insertPoint, subclass);
    this._writer.write(41, underlay.xScale, subclass);
    this._writer.write(42, underlay.yScale, subclass);
    this._writer.write(43, underlay.zScale, subclass);
    this._writer.write(50, underlay.rotation, subclass);
    // The normal and the clip boundary follow the DXF reference (UNDERLAY): 210 after the
    // rotation, stated only when it is not +Z as AutoCAD does, and the clip as repeated 11/21
    // pairs after the fade, with no count (two points are a rectangle's corners).
    const n = underlay.normal;
    if (n.x !== 0 || n.y !== 0 || n.z !== 1) this._writer.writeVector(210, n, subclass);
    this._writer.write(280, underlay.flags, subclass);
    this._writer.write(281, underlay.contrast, subclass);
    this._writer.write(282, underlay.fade, subclass);
    for (const v of underlay.clipBoundaryVertices) {
      this._writer.write(11, v.x);
      this._writer.write(21, v.y);
    }
  }

  private _writePoint(point: Point, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.point)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.point);
    this._writer.writeVector(10, point.location, subclass);
    this._writer.write(39, point.thickness, subclass);
    this._writer.writeVector(210, point.normal, subclass);
    this._writer.write(50, point.rotation, subclass);
  }

  private _writePolyline(polyline: Polyline2D | Polyline3D | PolyfaceMesh | PolygonMesh, map: DxfMap): void {
    this._writer.write(DxfCode.Subclass, polyline.subclassMarker);
    this._writer.write(66, 1);
    this._writer.write(70, polyline.flags);
    this._writer.writeVector(10, new XYZ(0, 0, polyline.elevation));
    this._writer.write(39, polyline.thickness);
    this._writer.write(40, polyline.startWidth);
    this._writer.write(41, polyline.endWidth);
    this._writer.writeVector(210, polyline.normal);
    if (polyline instanceof PolygonMesh) {
      this._writer.write(71, polyline.mVertexCount);
      this._writer.write(72, polyline.nVertexCount);
      this._writer.write(73, polyline.mSmoothSurfaceDensity);
      this._writer.write(74, polyline.nSmoothSurfaceDensity);
      this._writer.write(75, polyline.smoothSurface);
    } else if (polyline instanceof PolyfaceMesh) {
      this._writer.write(71, polyline.vertices.length);
      this._writer.write(72, polyline.faces.length);
    } else if (polyline.smoothSurface !== SmoothSurfaceType.NoSmooth) {
      // 75 (optional, default 0) is also the fit type of a spline-fit 2D or 3D polyline;
      // without it a quadratic or Bezier fit reads back as the default cubic.
      this._writer.write(75, polyline.smoothSurface);
    }
    this._writeOwnerExtendedData(polyline);

    for (const vertex of polyline.vertices) {
      if (vertex instanceof Vertex) {
        this._writeVertex(vertex, map);
      }
    }

    if (polyline instanceof PolyfaceMesh) {
      for (const face of polyline.faces) this._writeVertex(face, map);
    }
    this._writeSeqend(polyline.vertices.seqend, map);
  }

  private _writeVertex(vertex: Vertex, map: DxfMap): void {
    this._writer.write(DxfCode.Start, vertex.objectName);
    this.writeCommonObjectData(vertex);
    this.writeCommonEntityData(vertex);

    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.vertex);
    this._writer.write(DxfCode.Subclass, vertex.subclassMarker);
    this._writer.writeVector(10, vertex.location);
    this._writer.write(70, vertex.flags);

    if (vertex instanceof Vertex2D) {
      this._writer.write(40, vertex.startWidth);
      this._writer.write(41, vertex.endWidth);
      this._writer.write(42, vertex.bulge);
      this._writer.write(50, vertex.curveTangent);
    } else if (vertex instanceof VertexFaceRecord) {
      this._writer.write(71, vertex.index1);
      this._writer.write(72, vertex.index2);
      this._writer.write(73, vertex.index3);
      this._writer.write(74, vertex.index4);
    }
  }

  private _writeRay(ray: Ray, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.ray)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.ray);
    this._writer.writeVector(10, ray.startPoint, subclass);
    this._writer.writeVector(11, ray.direction, subclass);
  }

  private _writeShape(shape: Shape, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.shape)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.shape);
    this._writer.writeVector(10, shape.insertionPoint, subclass);
    this._writer.write(40, shape.size, subclass);
    this._writer.write(2, shape.shapeName || shape.shapeIndex, subclass);
    this._writer.write(50, shape.rotation, subclass);
    this._writer.write(41, shape.relativeXScale, subclass);
    this._writer.write(51, shape.obliqueAngle, subclass);
    this._writer.write(39, shape.thickness, subclass);
    this._writer.writeVector(210, shape.normal, subclass);
  }

  private _writeSolid(solid: Solid, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.solid)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.solid);
    this._writer.writeVector(10, solid.firstCorner, subclass);
    this._writer.writeVector(11, solid.secondCorner, subclass);
    this._writer.writeVector(12, solid.thirdCorner, subclass);
    this._writer.writeVector(13, solid.fourthCorner, subclass);
    this._writer.write(39, solid.thickness, subclass);
    this._writer.writeVector(210, solid.normal, subclass);
  }

  private _writeModelerGeometry(geometry: ModelerGeometry): void {
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.modelerGeometry);

    if (this.version >= ACadVersion.AC1027) {
      this._writer.write(290, geometry.guid ? 1 : 0);
      this._writer.write(2, geometry.guid || '{00000000-0000-0000-0000-000000000000}');
      this.holder.modelerGeometries.push(geometry);
    } else {
      this._writer.write(70, geometry.modelerFormatVersion || 1);
      const acisText = geometry.getAcisText();
      if (acisText !== null) {
        for (const line of acisText.split(/\r?\n/)) {
          const encoded = AcisTextCodec.decode(line.replace(/\r+$/, '')) as string;
          for (let offset = 0; offset < encoded.length;) {
            let length = Math.min(255, encoded.length - offset);
            if (offset + length < encoded.length) {
              const space = encoded.lastIndexOf(' ', offset + length - 1);
              if (space > offset) length = space - offset + 1;
            }
            this._writer.write(offset === 0 ? 1 : 3, encoded.substring(offset, offset + length));
            offset += length;
          }
        }
      } else if (geometry.acisData.length > 0) {
        this.notify(
          `Binary ACIS payload for ${geometry.constructor.name} requires DXF R2013 or newer`,
          NotificationType.Warning,
        );
      } else {
        this.notify(`Encrypted SAT not found for ${geometry.objectName}: ${geometry.handle}.`, NotificationType.Warning);
      }
    }

    if (geometry instanceof Solid3D && this.version >= ACadVersion.AC1021) {
      this._writer.write(DxfCode.Subclass, DxfSubclassMarker.solid3D);
      this._writer.write(350, geometry.history?.handle ?? 0);
      if (geometry.history != null) {
        this.holder.objects.push(geometry.history);
      }
    }
  }

  private _writeSpline(spline: Spline, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.spline)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.spline);
    this._writer.writeVector(210, spline.normal, subclass);
    this._writer.write(70, spline.flags, subclass);
    this._writer.write(71, spline.degree, subclass);
    this._writer.write(72, spline.knots.length);
    this._writer.write(73, spline.controlPoints.length);
    this._writer.write(74, spline.fitPoints.length);
    this._writer.write(42, spline.knotTolerance, subclass);
    this._writer.write(43, spline.controlPointTolerance, subclass);
    this._writer.write(44, spline.fitTolerance, subclass);

    if (spline.startTangent) {
      this._writer.writeVector(12, spline.startTangent);
    }
    if (spline.endTangent) {
      this._writer.writeVector(13, spline.endTangent);
    }

    for (const k of spline.knots) {
      this._writer.write(40, k);
    }
    for (let i = 0; i < spline.controlPoints.length; i++) {
      this._writer.writeVector(10, spline.controlPoints[i]);
      if (i < spline.weights.length) {
        this._writer.write(41, spline.weights[i]);
      }
    }
    for (const fp of spline.fitPoints) {
      this._writer.writeVector(11, fp);
    }
  }

  private _writeTextEntity(text: TextEntity, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.text)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.text);

    this._writer.write(39, text.thickness, subclass);
    this._writer.writeVector(10, text.insertPoint, subclass);
    this._writer.write(40, text.height, subclass);
    this._writer.write(1, text.value ?? '', subclass);
    this._writer.write(50, text.rotation, subclass);
    this._writer.write(41, text.widthFactor, subclass);
    this._writer.write(51, text.obliqueAngle, subclass);
    this._writer.write(7, text.style?.name ?? '', subclass);
    this._writer.write(71, text.mirror, subclass);
    this._writer.write(72, text.horizontalAlignment, subclass);
    this._writer.writeVector(11, text.alignmentPoint, subclass);
    this._writer.writeVector(210, text.normal, subclass);

    // TEXT's second AcDbText holds its 73; an attribute has none and goes on to AcDbAttribute.
    if (text instanceof AttributeBase) return;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.text);
    this._writer.write(73, text.verticalAlignment, subclass);
  }

  private _writeTolerance(tolerance: Tolerance, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.tolerance)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.tolerance);
    this._writer.write(3, tolerance.style?.name ?? '', subclass);
    this._writer.writeVector(10, tolerance.insertionPoint, subclass);
    this._writer.write(1, tolerance.text ?? '', subclass);
    this._writer.writeVector(11, tolerance.direction, subclass);
    this._writer.writeVector(210, tolerance.normal, subclass);
  }

  private _writeViewport(viewport: Viewport, map: DxfMap): void {
    // AcDbViewport in AutoCAD's group-code order (DXF reference, VIEWPORT). Upstream wrote the id
    // as 68, snap angle and twist as 50/51 swapped onto twist and zoom, the UCS icon as 72 and the
    // UCS vectors as single groups, and none of the R2000+ settings.
    const subclass = map.subClasses.get(DxfSubclassMarker.viewport)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.viewport);
    this._writer.writeVector(10, viewport.center, subclass);
    this._writer.write(40, viewport.width, subclass);
    this._writer.write(41, viewport.height, subclass);
    this._writer.write(68, viewport.activeStatus, subclass);
    this._writer.write(69, viewport.id, subclass);
    this._writer.writeVector(12, viewport.viewCenter, subclass);
    this._writer.writeVector(13, viewport.snapBase, subclass);
    this._writer.writeVector(14, viewport.snapSpacing, subclass);
    this._writer.writeVector(15, viewport.gridSpacing, subclass);
    this._writer.writeVector(16, viewport.viewDirection, subclass);
    this._writer.writeVector(17, viewport.viewTarget, subclass);
    this._writer.write(42, viewport.lensLength, subclass);
    this._writer.write(43, viewport.frontClipPlane, subclass);
    this._writer.write(44, viewport.backClipPlane, subclass);
    this._writer.write(45, viewport.viewHeight, subclass);
    this._writer.write(50, viewport.snapAngle, subclass);
    this._writer.write(51, viewport.twistAngle, subclass);
    this._writer.write(72, viewport.circleZoomPercent, subclass);

    // R12 names frozen layers in the MVIEW xdata (written with it), not as 331 handles.
    if (this.version > ACadVersion.AC1009) {
      for (const layer of viewport.frozenLayers) {
        this._writer.writeHandle(331, layer);
      }
    }

    this._writer.write(90, viewport.status, subclass);
    this._writer.writeHandle(340, viewport.boundary, subclass);

    if (this.version >= ACadVersion.AC1015) {
      this._writer.write(1, viewport.styleSheetName, subclass);
      this._writer.write(281, viewport.renderMode, subclass);
      this._writer.write(71, viewport.ucsPerViewport ? 1 : 0, subclass);
      this._writer.write(74, viewport.displayUcsIcon ? 1 : 0, subclass);
      this._writer.writeVector(110, viewport.ucsOrigin, subclass);
      this._writer.writeVector(111, viewport.ucsXAxis, subclass);
      this._writer.writeVector(112, viewport.ucsYAxis, subclass);
      this._writer.write(79, viewport.ucsOrthographicType, subclass);
      this._writer.write(146, viewport.elevation, subclass);
    }

    if (this.version >= ACadVersion.AC1018) {
      this._writer.write(170, viewport.shadePlotMode, subclass);
    }

    if (this.version >= ACadVersion.AC1021) {
      this._writer.write(61, viewport.majorGridLineFrequency, subclass);
      this._writer.writeHandle(348, viewport.visualStyle, subclass);
      this._writer.write(292, viewport.useDefaultLighting ? 1 : 0, subclass);
      this._writer.write(282, viewport.defaultLightingType as number, subclass);
      this._writer.write(141, viewport.brightness, subclass);
      this._writer.write(142, viewport.contrast, subclass);
      const ambient = viewport.ambientLightColor;
      if (ambient != null) {
        this._writer.write(63, ambient.isTrueColor ? ambient.getApproxIndex() : ambient.index);
        if (ambient.isTrueColor) {
          this._writer.write(421, ambient.trueColor);
        }
      }
    }

    if (viewport.sun != null) {
      this._writer.writeHandle(361, viewport.sun);
      this.holder.objects.push(viewport.sun);
    }
  }

  private _writeXLine(xline: XLine, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.xLine)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.xLine);
    this._writer.writeVector(10, xline.firstPoint, subclass);
    this._writer.writeVector(11, xline.direction, subclass);
  }

  private _writeCadImage(image: CadImage, map: DxfMap): void {
    const subclass = map.subClasses.get(DxfSubclassMarker.rasterImage)!;
    this._writer.write(DxfCode.Subclass, DxfSubclassMarker.rasterImage);
    this._writer.write(90, image.classVersion, subclass);
    this._writer.writeVector(10, image.insertPoint, subclass);
    this._writer.writeVector(11, image.uVector, subclass);
    this._writer.writeVector(12, image.vVector, subclass);
    this._writer.writeVector(13, image.size, subclass);
    this._writer.writeHandle(340, image.definition, subclass);
    this._writer.write(70, image.flags, subclass);
    this._writer.write(280, image.clippingState, subclass);
    this._writer.write(281, image.brightness, subclass);
    this._writer.write(282, image.contrast, subclass);
    this._writer.write(283, image.fade, subclass);
    this._writer.writeHandle(360, image.definitionReactor, subclass);
    if (image.definitionReactor != null) {
      // The image hard-owns its reactor (360); nothing else queues it for the OBJECTS section.
      this.holder.objects.push(image.definitionReactor);
    }
    this._writer.write(71, image.clipType, subclass);
    this._writer.write(91, image.clipBoundaryVertices.length);
    for (const v of image.clipBoundaryVertices) {
      this._writer.write(14, v.x);
      this._writer.write(24, v.y);
    }
    // Clip mode (inside or outside the boundary) is R2010+, after the boundary.
    if (this.version >= ACadVersion.AC1024) this._writer.write(290, Number(image.clipMode), subclass);
  }

  private _writeSeqend(seqend: Seqend, map: DxfMap): void {
    if (!seqend) return;
    this._writer.write(DxfCode.Start, seqend.objectName);
    this.writeCommonObjectData(seqend);
    this.writeCommonEntityData(seqend);
  }

  private _writeAttributeBase(att: AttributeBase, map: DxfMap): void {
    // AcDbAttribute / AcDbAttributeDefinition in AutoCAD's order (DXF reference, ATTDEF/ATTRIB):
    // version (R2010+) first, lock position (R2007+) after 74, then the multiline text (R2018; older
    // versions keep it in an XRECORD under the extension dictionary).
    this._writeTextEntity(att, map);
    this._writer.write(DxfCode.Subclass, att.subclassMarker);
    if (this.version >= ACadVersion.AC1024) this._writer.write(280, att.version);
    if (att instanceof AttributeDefinition) this._writer.write(3, att.prompt);
    this._writer.write(2, att.tag);
    this._writer.write(70, att.flags);
    this._writer.write(73, 0);
    this._writer.write(74, att.verticalAlignment);
    if (this.version >= ACadVersion.AC1021) this._writer.write(280, att.isReallyLocked ? 1 : 0);
    if (this.version >= ACadVersion.AC1032 && att.attributeType !== AttributeType.SingleLine && att.mText != null) {
      const mtext = att.mText;
      this._writer.write(71, att.attributeType);
      this._writer.write(72, 0);
      this._writer.writeVector(11, att.alignmentPoint);
      this._writer.write(101, 'Embedded Object');
      this._writer.writeVector(10, mtext.insertPoint);
      this._writer.write(40, mtext.height);
      this._writer.write(41, mtext.rectangleWidth);
      this._writer.write(46, mtext.rectangleHeight);
      this._writer.write(71, mtext.attachmentPoint);
      this._writer.write(72, mtext.drawingDirection);
      this.writeLongTextValue(1, 3, mtext.value ?? '');
      this._writer.write(73, mtext.lineSpacingStyle);
      this._writer.write(44, mtext.lineSpacing);
    }
  }
}
