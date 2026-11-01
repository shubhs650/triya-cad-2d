import { DxfSectionWriterBase } from './DxfSectionWriterBase.js';
import { IDxfStreamWriter } from './IDxfStreamWriter.js';
import { CadDocument } from '../../../CadDocument.js';
import { CadObjectHolder } from '../CadObjectHolder.js';
import { DxfWriterConfiguration } from '../DxfWriterConfiguration.js';
import { DxfFileToken } from '../../../DxfFileToken.js';
import { DxfCode } from '../../../DxfCode.js';
import { DxfReferenceType } from '../../../Types/DxfReferenceType.js';
import { CadHeader } from '../../../Header/CadHeader.js';
import { CadSystemVariable } from '../../../CadSystemVariable.js';
import { ACadVersion } from '../../../ACadVersion.js';
import { GroupCodeValue } from '../../../GroupCodeValue.js';
import { GroupCodeValueType } from '../../../GroupCodeValueType.js';

export class DxfHeaderSectionWriter extends DxfSectionWriterBase {
  // R11/R12 header vocabulary; later variables may also use incompatible codes.
  private static readonly r12Variables = new Set(`
    $ACADVER $INSBASE $EXTMIN $EXTMAX $LIMMIN $LIMMAX $ORTHOMODE $REGENMODE
    $FILLMODE $QTEXTMODE $MIRRTEXT $DRAGMODE $LTSCALE $OSMODE $ATTMODE $TEXTSIZE
    $TRACEWID $TEXTSTYLE $CLAYER $CELTYPE $CECOLOR $DIMSCALE $DIMASZ $DIMEXO
    $DIMDLI $DIMRND $DIMDLE $DIMEXE $DIMTP $DIMTM $DIMTXT $DIMCEN $DIMTSZ
    $DIMTOL $DIMLIM $DIMTIH $DIMTOH $DIMSE1 $DIMSE2 $DIMTAD $DIMZIN $DIMBLK
    $DIMASO $DIMSHO $DIMPOST $DIMAPOST $DIMALT $DIMALTD $DIMALTF $DIMLFAC
    $DIMTOFL $DIMTVP $DIMTIX $DIMSOXD $DIMSAH $DIMBLK1 $DIMBLK2 $DIMSTYLE
    $DIMCLRD $DIMCLRE $DIMCLRT $DIMTFAC $DIMGAP $LUNITS $LUPREC $SKETCHINC
    $FILLETRAD $AUNITS $AUPREC $MENU $ELEVATION $PELEVATION $THICKNESS $LIMCHECK
    $BLIPMODE $CHAMFERA $CHAMFERB $SKPOLY $TDCREATE $TDUPDATE $TDINDWG $TDUSRTIMER
    $USRTIMER $ANGBASE $ANGDIR $PDMODE $PDSIZE $PLINEWID $COORDS $SPLFRAME
    $SPLINETYPE $SPLINESEGS $ATTDIA $ATTREQ $HANDLING $HANDSEED $SURFTAB1
    $SURFTAB2 $SURFTYPE $SURFU $SURFV $UCSNAME $UCSORG $UCSXDIR $UCSYDIR
    $PUCSNAME $PUCSORG $PUCSXDIR $PUCSYDIR $USERI1 $USERI2 $USERI3 $USERI4
    $USERI5 $USERR1 $USERR2 $USERR3 $USERR4 $USERR5 $WORLDVIEW $SHADEDGE
    $SHADEDIF $TILEMODE $MAXACTVP $PLIMCHECK $PEXTMIN $PEXTMAX $PLIMMIN
    $PLIMMAX $UNITMODE $VISRETAIN $PLINEGEN $PSLTSCALE
  `.trim().split(/\s+/));
  public get sectionName(): string {
    return DxfFileToken.headerSection;
  }

  public get header(): CadHeader {
    return this._document.header;
  }

  public constructor(
    writer: IDxfStreamWriter,
    document: CadDocument,
    holder: CadObjectHolder,
    configuration: DxfWriterConfiguration
  ) {
    super(writer, document, holder, configuration);
  }

  /**
   * R12 leaves the made-up handles out (see writeCommonObjectData), so it writes the seed they
   * were made up from, and reopening makes up the same ones. Once an object has been added after
   * reading, the seed must cover it, and the made-up handles move on the next read.
   */
  private _handleSeed(): number {
    const range = this._document.madeUpHandles;
    if (this.version > ACadVersion.AC1009 || range == null) return this._document.header.handleSeed;
    for (const obj of this._document.getCadObjects()) {
      if (obj.handle > range.last) return this._document.header.handleSeed;
    }
    return range.first - 1;
  }

  protected writeSection(): void {
    const map: Map<string, CadSystemVariable> = CadHeader.getHeaderMap();

    for (const [key, item] of map) {
      if (this.version <= ACadVersion.AC1009 && !DxfHeaderSectionWriter.r12Variables.has(key)) continue;
      if (!this.configuration.writeAllHeaderVariables && !this.configuration.headerVariables.has(key)) {
        continue;
      }

      if ((item.referenceType & DxfReferenceType.Ignored) !== 0) {
        continue;
      }

      if (item.getValue(this.header) === null || item.getValue(this.header) === undefined) {
        continue;
      }
      // An unset single-character flag ($LOFTNORMALS, $DWFFRAME, ...) reads as ''; writing it
      // under a numeric code would read back as "0", so a drawing that never had it keeps it out.
      if (item.getValue(this.header) === '' && item.dxfCodes.every((c) => GroupCodeValue.transformValue(c as number) !== GroupCodeValueType.String)) {
        continue;
      }


      this._writer.write(DxfCode.CLShapeText, key);

      if (key === '$HANDSEED') {
        this._writer.write(DxfCode.Handle, this._handleSeed());
        continue;
      }

      if (key === '$CECOLOR') {
        this._writer.write(62, this._document.header.currentEntityColor.getApproxIndex());
        continue;
      }

      for (const csv of item.dxfCodes) {
        const value = item.getSystemValue(csv, this._document.header);

        if (value === null || value === undefined) {
          continue;
        }

        this._writer.write(csv as number, value);
      }
    }
  }
}
