export class Color {
	public static get black(): Color { return new Color(250); }
	public static get blue(): Color { return new Color(5); }
	public static get byBlock(): Color { return Color._fromIndex(0); }
	public static get byEntity(): Color { return Color._fromIndex(257); }
	public static get byLayer(): Color { return Color._fromIndex(256); }
	public static get cyan(): Color { return new Color(4); }
	public static get darkGray(): Color { return new Color(8); }
	public static get default(): Color { return new Color(7); }
	public static get green(): Color { return new Color(3); }
	public static get lightGray(): Color { return new Color(9); }
	public static get magenta(): Color { return new Color(6); }
	public static get red(): Color { return new Color(1); }
	public static get yellow(): Color { return new Color(2); }

	public get b(): number { return this.getRgb()[2]; }
	public get g(): number { return this.getRgb()[1]; }
	public get r(): number { return this.getRgb()[0]; }

	public get index(): number { return this.isTrueColor ? -1 : this._color; }

	public get isByBlock(): boolean { return this.index === 0; }
	public get isByLayer(): boolean { return this.index === 256; }
	public get isTrueColor(): boolean { return this._color > 257 || this._color < 0; }

	public get trueColor(): number { return this.isTrueColor ? (this._color ^ (1 << 30)) : -1; }

	private static readonly _maxTrueColor = 0b0001_0000_0000_0000_0000_0000_0000;
	private static readonly _trueColorFlag = 0b0100_0000_0000_0000_0000_0000_0000_0000;

	private static readonly _indexRgb: number[][] = [
		[0, 0, 0],
		[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255],
		[0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128],
		[192, 192, 192], [255, 0, 0], [255, 127, 127], [165, 0, 0],
		[165, 82, 82], [127, 0, 0], [127, 63, 63], [76, 0, 0],
		[76, 38, 38], [38, 0, 0], [38, 19, 19], [255, 63, 0],
		[255, 159, 127], [165, 41, 0], [165, 103, 82], [127, 31, 0],
		[127, 79, 63], [76, 19, 0], [76, 47, 38], [38, 9, 0],
		[38, 23, 19], [255, 127, 0], [255, 191, 127], [165, 82, 0],
		[165, 124, 82], [127, 63, 0], [127, 95, 63], [76, 38, 0],
		[76, 57, 38], [38, 19, 0], [38, 28, 19], [255, 191, 0],
		[255, 223, 127], [165, 124, 0], [165, 145, 82], [127, 95, 0],
		[127, 111, 63], [76, 57, 0], [76, 66, 38], [38, 28, 0],
		[38, 33, 19], [255, 255, 0], [255, 255, 127], [165, 165, 0],
		[165, 165, 82], [127, 127, 0], [127, 127, 63], [76, 76, 0],
		[76, 76, 38], [38, 38, 0], [38, 38, 19], [191, 255, 0],
		[223, 255, 127], [124, 165, 0], [145, 165, 82], [95, 127, 0],
		[111, 127, 63], [57, 76, 0], [66, 76, 38], [28, 38, 0],
		[33, 38, 19], [127, 255, 0], [191, 255, 127], [82, 165, 0],
		[124, 165, 82], [63, 127, 0], [95, 127, 63], [38, 76, 0],
		[57, 76, 38], [19, 38, 0], [28, 38, 19], [63, 255, 0],
		[159, 255, 127], [41, 165, 0], [103, 165, 82], [31, 127, 0],
		[79, 127, 63], [19, 76, 0], [47, 76, 38], [9, 38, 0],
		[23, 38, 19], [0, 255, 0], [127, 255, 127], [0, 165, 0],
		[82, 165, 82], [0, 127, 0], [63, 127, 63], [0, 76, 0],
		[38, 76, 38], [0, 38, 0], [19, 38, 19], [0, 255, 63],
		[127, 255, 159], [0, 165, 41], [82, 165, 103], [0, 127, 31],
		[63, 127, 79], [0, 76, 19], [38, 76, 47], [0, 38, 9],
		[19, 38, 23], [0, 255, 127], [127, 255, 191], [0, 165, 82],
		[82, 165, 124], [0, 127, 63], [63, 127, 95], [0, 76, 38],
		[38, 76, 57], [0, 38, 19], [19, 38, 28], [0, 255, 191],
		[127, 255, 223], [0, 165, 124], [82, 165, 145], [0, 127, 95],
		[63, 127, 111], [0, 76, 57], [38, 76, 66], [0, 38, 28],
		[19, 38, 33], [0, 255, 255], [127, 255, 255], [0, 165, 165],
		[82, 165, 165], [0, 127, 127], [63, 127, 127], [0, 76, 76],
		[38, 76, 76], [0, 38, 38], [19, 38, 38], [0, 191, 255],
		[127, 223, 255], [0, 124, 165], [82, 145, 165], [0, 95, 127],
		[63, 111, 127], [0, 57, 76], [38, 66, 76], [0, 28, 38],
		[19, 33, 38], [0, 127, 255], [127, 191, 255], [0, 82, 165],
		[82, 124, 165], [0, 63, 127], [63, 95, 127], [0, 38, 76],
		[38, 57, 76], [0, 19, 38], [19, 28, 38], [0, 63, 255],
		[127, 159, 255], [0, 41, 165], [82, 103, 165], [0, 31, 127],
		[63, 79, 127], [0, 19, 76], [38, 47, 76], [0, 9, 38],
		[19, 23, 38], [0, 0, 255], [127, 127, 255], [0, 0, 165],
		[82, 82, 165], [0, 0, 127], [63, 63, 127], [0, 0, 76],
		[38, 38, 76], [0, 0, 38], [19, 19, 38], [63, 0, 255],
		[159, 127, 255], [41, 0, 165], [103, 82, 165], [31, 0, 127],
		[79, 63, 127], [19, 0, 76], [47, 38, 76], [9, 0, 38],
		[23, 19, 38], [127, 0, 255], [191, 127, 255], [82, 0, 165],
		[124, 82, 165], [63, 0, 127], [95, 63, 127], [38, 0, 76],
		[57, 38, 76], [19, 0, 38], [28, 19, 38], [191, 0, 255],
		[223, 127, 255], [124, 0, 165], [145, 82, 165], [95, 0, 127],
		[111, 63, 127], [57, 0, 76], [66, 38, 76], [28, 0, 38],
		[33, 19, 38], [255, 0, 255], [255, 127, 255], [165, 0, 165],
		[165, 82, 165], [127, 0, 127], [127, 63, 127], [76, 0, 76],
		[76, 38, 76], [38, 0, 38], [38, 19, 38], [255, 0, 191],
		[255, 127, 223], [165, 0, 124], [165, 82, 145], [127, 0, 95],
		[127, 63, 111], [76, 0, 57], [76, 38, 66], [38, 0, 28],
		[38, 19, 33], [255, 0, 127], [255, 127, 191], [165, 0, 82],
		[165, 82, 124], [127, 0, 63], [127, 63, 95], [76, 0, 38],
		[76, 38, 57], [38, 0, 19], [38, 19, 28], [255, 0, 63],
		[255, 127, 159], [165, 0, 41], [165, 82, 103], [127, 0, 31],
		[127, 63, 79], [76, 0, 19], [76, 38, 47], [38, 0, 9],
		[38, 19, 23], [51, 51, 51], [91, 91, 91], [132, 132, 132],
		[173, 173, 173], [214, 214, 214], [255, 255, 255],
	];

	private _color: number;

	constructor(index: number);
	constructor(r: number, g: number, b: number);
	constructor(indexOrR: number, g?: number, b?: number) {
		if (g !== undefined && b !== undefined) {
			// True color constructor from RGB
			const trueColor = Color._getInt24([indexOrR, g, b]);
			this._color = (trueColor | Color._trueColorFlag) >>> 0;
		} else {
			// Index color constructor - clamp to valid range for compatibility with DXF files
			const index = indexOrR;
			if (index < 0 || index > 257) {
				// Use ByLayer (256) as fallback for out-of-range values
				this._color = 256;
			} else {
				this._color = index;
			}
		}
	}

	private static _fromIndex(index: number): Color {
		const c = new Color(0);
		c._color = index;
		return c;
	}

	public static fromTrueColor(color: number): Color {
		const c = new Color(0);
		c._color = (color | Color._trueColorFlag) >>> 0;
		return c;
	}

	/**
	 * An AcCmEntityColor as DXF states it in one 32-bit group (MLEADERSTYLE 91/93/94, MULTILEADER
	 * 91/92/93 and its context 90/91/93): the high byte is the colour method, 0xC0 ByLayer,
	 * 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI (in the low byte), 0xC8 None. Other methods keep the low
	 * byte as an index, as the DWG reader does.
	 */
	public static fromCmValue(value: number): Color {
		const method = (value >>> 24) & 0xFF;
		if (method === 0xC0) return Color.byLayer;
		if (method === 0xC2) return Color.fromTrueColor(value & 0xFFFFFF);
		if (method === 0xC8) return Color.byEntity;
		return new Color(value & 0xFF);
	}

	/** The fromCmValue value of this colour, as a signed 32-bit integer. */
	public toCmValue(): number {
		if (this.isTrueColor) return (0xC2000000 | (this.trueColor & 0xFFFFFF)) | 0;
		if (this.isByLayer) return 0xC0000000 | 0;
		if (this.isByBlock) return 0xC1000000 | 0;
		if (this.index === 257) return 0xC8000000 | 0;
		return (0xC3000000 | this.index) | 0;
	}

	public static getIndexRGB(index: number): number[] {
		return Color._indexRgb[index];
	}

	// The ACI AutoCAD stores for a true colour (DXF 62 before 420, R2000 and earlier saves): the
	// nearest entry by squared RGB distance over 1–255, lowest index on a tie. AutoCAD picks it
	// from a palette whose hue rows have the values 1, 0.8, 0.6, 0.5 and 0.3 of 255 (ACI 12 =
	// 204,0,0) and greys 51, 80, 105, 130, 190, 255, not from the display values above; this
	// reproduces every 62/420 pair AutoCAD wrote in the ezdxf and ACadSharp sample files.
	private static readonly _approxRgb: number[][] = Color._approxPalette();

	private static _approxPalette(): number[][] {
		const values = [1, 0.8, 0.6, 0.5, 0.3];
		const greys = [51, 80, 105, 130, 190, 255];
		const palette: number[][] = [];
		for (let i = 1; i <= 255; i++) {
			if (i < 10) {
				palette.push(Color._indexRgb[i]);
				continue;
			}
			if (i >= 250) {
				palette.push([greys[i - 250], greys[i - 250], greys[i - 250]]);
				continue;
			}
			const hue = (Math.floor(i / 10) - 1) * 15;
			const v = 255 * values[Math.floor((i % 10) / 2)];
			const min = i % 2 ? v / 2 : 0;
			const f = (hue % 60) / 60;
			const up = min + (v - min) * f;
			const down = v - (v - min) * f;
			const sectors = [[v, up, min], [down, v, min], [min, v, up], [min, down, v], [up, min, v], [v, min, down]];
			palette.push(sectors[Math.floor(hue / 60)].map(Math.floor));
		}
		return palette;
	}

	public static approxIndex(r: number, g: number, b: number): number {
		let best = 1;
		let bestDist = Infinity;
		for (let i = 0; i < Color._approxRgb.length; i++) {
			const [pr, pg, pb] = Color._approxRgb[i];
			const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
			if (dist < bestDist) {
				bestDist = dist;
				best = i + 1;
			}
		}
		return best;
	}

	public equals(other: Color): boolean {
		return this._color === other._color;
	}

	public getApproxIndex(): number {
		if (this.isTrueColor) {
			return Color.approxIndex(this.r, this.g, this.b);
		} else {
			return this.index;
		}
	}

	public getRgb(): number[] {
		if (this.isTrueColor) {
			return this.getTrueColorRgb();
		} else {
			return Color.getIndexRGB(this._color);
		}
	}

	public getTrueColorRgb(): number[] {
		if (this.isTrueColor) {
			return Color._getRGBfromTrueColor(this._color);
		}
		return [0, 0, 0];
	}

	public toString(): string {
		if (this._color === 0) return "ByBlock";
		if (this._color === 256) return "ByLayer";
		if (this.isTrueColor) {
			const parts = this.getTrueColorRgb();
			return `True Color RGB:${parts[0]},${parts[1]},${parts[2]}`;
		}
		return `Indexed Color:${this.index}`;
	}

	private static _getInt24(array: number[]): number {
		return (array[2] | (array[1] << 8) | (array[0] << 16));
	}

	private static _getRGBfromTrueColor(color: number): number[] {
		return [(color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF];
	}
}
