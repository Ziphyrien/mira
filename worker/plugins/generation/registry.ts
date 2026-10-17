import type { RegistryView } from "@earendil-works/chord";
import {
  createRegistry,
  type Extension,
  type RegistryReader,
  type RegistrySnapshot,
} from "@earendil-works/pi-durable";

/** Build privately and publish once: a phase can never see an empty or half-replaced contribution set. */
export class ExtensionRegistry implements RegistryReader {
  private current: RegistrySnapshot;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(view: RegistryView<{ order: number; extension: Extension }>) {
    this.current = this.build(view.table().values());
    this.unsubscribe = view.subscribe((table) => {
      const next = this.build(table.values());
      this.current = next;
      for (const listener of this.listeners) listener();
    });
  }
  private build(items: Iterable<{ order: number; extension: Extension }>): RegistrySnapshot {
    const registry = createRegistry();
    for (const item of [...items].sort((a, b) => a.order - b.order))
      registry.install(item.extension);
    return registry.snapshot();
  }
  snapshot() {
    return this.current;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.unsubscribe();
    this.listeners.clear();
  }
}
