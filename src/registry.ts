type Listener = () => void;

export interface Identified {
  id: string;
}

/** A tiny external store whose registrations are removed with their owning React scope. */
export class ScopedRegistry<T extends Identified> {
  readonly #scopes = new Map<symbol, readonly T[]>();
  readonly #listeners = new Set<Listener>();
  #snapshot: readonly T[] = [];

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): readonly T[] => this.#snapshot;

  register(items: readonly T[]): () => void {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.id) throw new Error("Registered entries must have a non-empty id.");
      if (ids.has(item.id)) throw new Error(`Duplicate registration id in one scope: ${item.id}`);
      ids.add(item.id);
    }

    const scope = Symbol("supercmdk-scope");
    this.#scopes.set(scope, items.slice());
    this.#publish();

    return () => {
      if (this.#scopes.delete(scope)) this.#publish();
    };
  }

  #publish(): void {
    const byId = new Map<string, T>();
    for (const entries of this.#scopes.values()) {
      for (const entry of entries) byId.set(entry.id, entry);
    }
    this.#snapshot = [...byId.values()];
    for (const listener of this.#listeners) listener();
  }
}
