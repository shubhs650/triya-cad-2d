import { TableStyle } from '../../Objects/TableStyle.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { CadTemplate } from './CadTemplate.js';
import { CadCellStyleTemplate } from './CadTableEntityTemplate.js';

export class CadTableStyleTemplate extends CadTemplate<TableStyle> {
	cellStyleTemplates: CadCellStyleTemplate[] = [];

	currentCellStyleTemplate!: CadCellStyleTemplate;
	tableCellStyleTemplate: CadCellStyleTemplate | null = null;

	constructor(tableStyle?: TableStyle) {
		super(tableStyle ?? new TableStyle());
	}

	createCurrentCellStyleTemplate(): CadCellStyleTemplate {
		this.currentCellStyleTemplate = new CadCellStyleTemplate();
		this.cellStyleTemplates.push(this.currentCellStyleTemplate);
		return this.currentCellStyleTemplate;
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);
		const tableStyle = this.cadObject as TableStyle;
		this.tableCellStyleTemplate?.build(builder);

		// The DXF TABLESTYLE body lists its cell styles without ids, as data, title, header.
		const legacy = [3, 1, 2];
		for (const [index, item] of this.cellStyleTemplates.entries()) {
			item.build(builder);
			switch (item.cellStyle.id || legacy[index]) {
				case 1: tableStyle.titleCellStyle = item.cellStyle; break;
				case 2: tableStyle.headerCellStyle = item.cellStyle; break;
				case 3: tableStyle.dataCellStyle = item.cellStyle; break;
			}
			if (!tableStyle.cellStyles.includes(item.cellStyle)) {
				tableStyle.cellStyles.push(item.cellStyle);
			}
		}
	}
}
