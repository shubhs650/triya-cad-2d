/**
 * acad-ts stamps `new Date()` into header variables a file does not state (e.g. `$TDCREATE`
 * in a minimal DXF). Two reads of the same bytes would then differ by however many
 * milliseconds passed between them, and the round-trip report would not be reproducible.
 * `withPinnedClock` makes argument-less `new Date()` and `Date.now()` return one fixed
 * instant while `fn` runs; explicit dates (the ones read from the file) are untouched.
 */
export const PINNED_INSTANT = Date.UTC(2000, 0, 1);

export function withPinnedClock<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  const Pinned = function (this: unknown, ...args: unknown[]): Date | string {
    if (!new.target) return new RealDate(PINNED_INSTANT).toString();
    return args.length === 0
      ? new RealDate(PINNED_INSTANT)
      : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(Pinned, RealDate);
  Object.defineProperty(Pinned, 'prototype', { value: RealDate.prototype });
  Object.defineProperty(Pinned, 'now', { value: () => PINNED_INSTANT });
  globalThis.Date = Pinned;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
