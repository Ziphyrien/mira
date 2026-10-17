import { Type } from "typebox";
export interface ReadonlyView<T> {
  readonly snapshot: T;
  subscribe(callback: (value: T) => void): () => void;
}
export function localValue<T>(name: string) {
  return Type.Unsafe<T>(Type.Unknown({ description: name }));
}
export function viewOf<T>(source: () => ReadonlyView<T>): ReadonlyView<T> {
  return {
    get snapshot() {
      return source().snapshot;
    },
    subscribe: (callback) => source().subscribe(callback),
  };
}
