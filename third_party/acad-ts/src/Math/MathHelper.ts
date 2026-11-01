export class MathHelper {
  static readonly epsilon: number = 1e-12;
  static readonly pi: number = Math.PI;
  static readonly halfPI: number = Math.PI / 2;
  static readonly twoPI: number = Math.PI * 2;

  static degToRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  static radToDeg(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * Degrees that `degToRad` turns back into exactly `radians`. Files store angles in degrees and
   * readers convert them with `degToRad`; `radToDeg` can land one ulp away from the value read,
   * so a save would move the angle. Tries the doubles next to `radToDeg(radians)`.
   */
  static radToDegRoundTrip(radians: number): number {
    const degrees = MathHelper.radToDeg(radians);
    if (!Number.isFinite(degrees) || MathHelper.degToRad(degrees) === radians) return degrees;
    const value = new Float64Array(1);
    const bits = new BigInt64Array(value.buffer);
    for (let step = 1n; step <= 4n; step++) {
      for (const sign of [1n, -1n]) {
        value[0] = degrees;
        bits[0] += sign * step;
        if (MathHelper.degToRad(value[0]) === radians) return value[0];
      }
    }
    return degrees;
  }

  static radToGrad(radians: number): number {
    return radians * (200 / Math.PI);
  }

  static isZero(value: number): boolean {
    return Math.abs(value) < MathHelper.epsilon;
  }

  static fixZero(value: number): number {
    return MathHelper.isZero(value) ? 0 : value;
  }

  static sin(angle: number): number {
    return MathHelper.fixZero(Math.sin(angle));
  }

  static cos(angle: number): number {
    return MathHelper.fixZero(Math.cos(angle));
  }
}
