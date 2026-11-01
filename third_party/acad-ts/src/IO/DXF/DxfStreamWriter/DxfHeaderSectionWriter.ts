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

      this._writer.write(DxfCode.CLShapeText, key);

      if (key === '$HANDSEED') {
        this._writer.write(DxfCode.Handle, this._document.header.handleSeed);
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
