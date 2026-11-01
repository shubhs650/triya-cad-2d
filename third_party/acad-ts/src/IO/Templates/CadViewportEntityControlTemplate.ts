import { ViewportEntityHeader } from '../../Tables/ViewportEntityHeader.js';
import { ViewportEntityControl } from '../../Tables/Collections/ViewportEntityControl.js';
import { CadTableTemplate } from './CadTableTemplate.js';


export class CadViewportEntityControlTemplate extends CadTableTemplate<ViewportEntityHeader> {
	constructor() {
		super(new ViewportEntityControl());
	}
}
