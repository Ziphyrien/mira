/**
 * Runtime gaps between the modern APIs this app calls and Chrome 92.
 *
 * The build lowers *syntax* to Chrome 92 (see the target in `vite.config.ts`), but syntax
 * lowering cannot add missing globals. Every shim below installs only when the
 * native implementation is absent, so current browsers keep their own.
 *
 * Import this once, before any feature module, from the root layout.
 */

type Mutable = Record<string, unknown>;

const globalScope = globalThis as unknown as Mutable;

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

/** structuredClone shipped in Chrome 98. */
if (typeof globalScope.structuredClone !== "function") {
  define(globalScope, "structuredClone", <T>(value: T): T => {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
    if (value instanceof RegExp) return new RegExp(value.source, value.flags) as unknown as T;
    if (value instanceof Map) {
      const copy = new Map();
      for (const [key, item] of value) copy.set(structuredClone(key), structuredClone(item));
      return copy as unknown as T;
    }
    if (value instanceof Set) {
      const copy = new Set();
      for (const item of value) copy.add(structuredClone(item));
      return copy as unknown as T;
    }
    if (Array.isArray(value)) return value.map((item) => structuredClone(item)) as unknown as T;
    if (ArrayBuffer.isView(value)) {
      // Typed arrays and DataView both expose a window onto a buffer; copying
      // that window (not the whole buffer) matches structuredClone's behaviour.
      const view = value as unknown as {
        buffer: ArrayBufferLike;
        byteOffset: number;
        byteLength: number;
      };
      return new Uint8Array(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      ) as unknown as T;
    }
    const source = value as Mutable;
    const copy: Mutable = {};
    for (const key of Object.keys(source)) copy[key] = structuredClone(source[key]);
    return copy as T;
  });
}

/** Object.hasOwn shipped in Chrome 93. */
if (typeof Object.hasOwn !== "function") {
  define(Object, "hasOwn", (target: object, key: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(target, key),
  );
}

/** Array.prototype.findLast shipped in Chrome 97. */
if (typeof Array.prototype.findLast !== "function") {
  define(Array.prototype, "findLast", function (this: unknown[], predicate: Function, thisArg?: unknown) {
    for (let index = this.length - 1; index >= 0; index -= 1)
      if (predicate.call(thisArg, this[index], index, this)) return this[index];
    return undefined;
  });
}

/** Array.prototype.toSorted / toReversed shipped in Chrome 110. */
if (typeof Array.prototype.toSorted !== "function") {
  define(Array.prototype, "toSorted", function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
    const copy = Array.prototype.slice.call(this) as unknown[];
    return copy.sort(compare as never);
  });
}

if (typeof Array.prototype.toReversed !== "function") {
  define(Array.prototype, "toReversed", function (this: unknown[]) {
    return Array.prototype.slice.call(this).reverse();
  });
}

/** AbortSignal.timeout shipped in Chrome 103; AbortSignal.any in Chrome 116. */
if (typeof AbortSignal !== "undefined") {
  const signals = AbortSignal as unknown as Mutable;

  if (typeof signals.timeout !== "function") {
    define(AbortSignal, "timeout", (milliseconds: number): AbortSignal => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException("signal timed out", "TimeoutError")),
        milliseconds,
      );
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      return controller.signal;
    });
  }

  if (typeof signals.any !== "function") {
    define(AbortSignal, "any", (list: AbortSignal[]): AbortSignal => {
      const controller = new AbortController();
      const abort = (reason: unknown) => controller.abort(reason);
      for (const signal of list) {
        if (signal.aborted) {
          abort(signal.reason);
          break;
        }
        signal.addEventListener("abort", () => abort(signal.reason), { once: true });
      }
      return controller.signal;
    });
  }
}

export {};
