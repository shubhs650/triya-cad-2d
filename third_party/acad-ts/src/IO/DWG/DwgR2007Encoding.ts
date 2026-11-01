/** R2007 page protection, as specified in ODA DWG specification chapter 5. */
const MASK = 0xffffffffffffffffn;
const normalTable: bigint[] = [];
const mirroredTable: bigint[] = [];
for (let i = 0; i < 256; i++) {
	let a = BigInt(i) << 56n, b = BigInt(i);
	for (let j = 0; j < 8; j++) {
		a = ((a << 1n) ^ (a >> 63n ? 0x42f0e1eba9ea3693n : 0n)) & MASK;
		b = (b >> 1n) ^ (b & 1n ? 0x95ac9329ac4bc9b5n : 0n);
	}
	normalTable.push(a); mirroredTable.push(b);
}

export function r2007Seed(length: number, second = false): bigint {
	let seed = (BigInt(length) * 0x343fdn + 0x269ec3n) & MASK;
	if (second) seed = seed * (0x100000000n + 0x343fdn) + BigInt(length) + 0x269ec3n;
	else seed |= seed * (0x343fdn << 32n) + (0x269ec3n << 32n);
	return ~seed & MASK;
}

/** Both CRC variants visit pairs in DWG's prescribed little-endian order. */
export function r2007Order(data: Uint8Array): Uint8Array {
	const result = new Uint8Array(data.length);
	let out = 0;
	for (let p = 0; p < data.length; p += 8) {
		const n = Math.min(8, data.length - p);
		const order = n === 8 ? [6, 7, 4, 5, 2, 3, 0, 1]
			: n >= 4 ? [2, 3, 0, 1, ...Array.from({ length: n - 4 }, (_, i) => i + 4)]
				: Array.from({ length: n }, (_, i) => i);
		for (const i of order) result[out++] = data[p + i];
	}
	return result;
}

export function r2007Crc(data: Uint8Array, seed: bigint, mirrored = false): bigint {
	let crc = seed & MASK;
	for (const b of r2007Order(data)) {
		crc = mirrored ? mirroredTable[Number((crc ^ BigInt(b)) & 255n)] ^ (crc >> 8n)
			: (normalTable[Number((crc >> 56n) ^ BigInt(b))] ^ (crc << 8n)) & MASK;
	}
	return mirrored ? crc : ~crc & MASK;
}

export function r2007Words(values: (number | bigint)[]): Uint8Array {
	const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
	values.forEach((value, i) => view.setBigUint64(i * 8, BigInt(value) & MASK, true));
	return bytes;
}

export function r2007Rotate(value: bigint, control: bigint): bigint {
	const shift = control & 31n;
	return shift ? ((value << shift) | (value >> (64n - shift))) & MASK : value;
}

export class R2007Random {
	private table = new Uint32Array(624);
	private index = 128;
	constructor() {
		this.table[0] = this.table[1] = 0x269ec3;
		for (let i = 2; i < this.table.length; i++) {
			const v = this.table[i - 1];
			this.table[i] = Math.imul((v >>> 30) ^ v, 0x6c078965) + i;
		}
	}
	next(): bigint {
		this.index = (this.index + 2) % 624;
		return BigInt(this.table[this.index]) | BigInt(this.table[this.index + 1]) << 32n;
	}
	encodeZero(): bigint { return this.next() & 0xf7df7df7df7df7dfn; }
}

/** Systematic shortened RS(255,k), with DWG's reversed polynomial order. */
export function r2007ReedSolomon(data: Uint8Array, k: 239 | 251, interleaved = true): Uint8Array {
	const blocks = Math.ceil(data.length / k), parity = 255 - k;
	const exp = new Uint8Array(510), log = new Uint8Array(256);
	exp[0] = 1;
	for (let i = 1; i < 255; i++) {
		const v = exp[i - 1] << 1;
		exp[i] = v ^ (v & 256 ? k === 239 ? 0x169 : 0x11d : 0);
	}
	for (let i = 0; i < 255; i++) { log[exp[i]] = i; exp[i + 255] = exp[i]; }
	const mul = (a: number, b: number) => a && b ? exp[log[a] + log[b]] : 0;
	let generator = [1];
	for (let root = 1; root <= parity; root++) {
		const next = new Array<number>(generator.length + 1).fill(0);
		generator.forEach((v, i) => { next[i] ^= v; next[i + 1] ^= mul(v, exp[root]); });
		generator = next;
	}
	const result = new Uint8Array(blocks * 255);
	for (let block = 0; block < blocks; block++) {
		const original = new Uint8Array(k);
		original.set(data.subarray(block * k, (block + 1) * k));
		const work = new Uint8Array(255);
		work.set(original.slice().reverse());
		for (let i = 0; i < k; i++) {
			const c = work[i];
			for (let j = 1; j <= parity; j++) work[i + j] ^= mul(c, generator[j]);
		}
		const code = new Uint8Array(255);
		code.set(original); code.set(work.subarray(k).reverse(), k);
		for (let i = 0; i < 255; i++) {
			const position = interleaved ? i * blocks + block : i < k ? block * k + i : blocks * k + block * parity + i - k;
			result[position] = code[i];
		}
	}
	return result;
}

export function r2007Checksum(data: Uint8Array): number {
	const seed = BigInt(data.length) * 0x343fdn + 0x269ec3n;
	let a = Number(seed & 65535n), b = Number((seed >> 16n) & 65535n);
	const ordered = r2007Order(data);
	for (let p = 0; p < ordered.length; p += 0x15b0) {
		for (const value of ordered.subarray(p, p + 0x15b0)) { a = (a + value) >>> 0; b = (b + a) >>> 0; }
		a %= 65521; b %= 65521;
	}
	return ((b << 16) | a) >>> 0;
}
