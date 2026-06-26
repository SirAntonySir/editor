import type { MaskRef } from '@/types/scope';

export type MaskSource =
  | 'sam-point'
  | 'sam-points'
  | 'sam-box'
  | 'brush'
  | 'ai-proposed';

export interface SamPrompt {
  kind: 'point' | 'box';
  data: number[];
}

export interface Mask {
  id: string;
  layerId: string;
  label?: string;
  width: number;
  height: number;
  data: Uint8Array;
  source: MaskSource;
  prompts?: SamPrompt[];
  createdAt: number;
}

class MaskStoreImpl {
  private masks = new Map<string, Mask>();
  // Reactivity: a monotonic version + listeners so consumers (e.g. the command
  // palette's Regions list) can `useSyncExternalStore` over the store and stay
  // fresh on add / remove / rename — the store holds plain objects, so a label
  // change is otherwise invisible to React.
  private version = 0;
  private listeners = new Set<() => void>();

  /** Subscribe to any mutation. Arrow-bound so `useSyncExternalStore` can call
   *  it detached. */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  /** Monotonic snapshot for `useSyncExternalStore` — stable (=== by value)
   *  unless a mutation has happened. */
  getVersion = (): number => this.version;

  private bump(): void {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  register(input: Omit<Mask, 'id'>): MaskRef {
    const id = crypto.randomUUID();
    this.masks.set(id, { ...input, id });
    this.bump();
    return id;
  }

  /** Insert a mask with a pre-determined id (e.g. from a backend mask.created
   *  event). Overwrites any existing mask with the same id. */
  injectWithId(mask: Mask): void {
    this.masks.set(mask.id, mask);
    this.bump();
  }

  get(ref: MaskRef): Mask | undefined {
    return this.masks.get(ref);
  }

  /** Overwrite an existing mask's data (e.g. brush refinement). */
  updateData(ref: MaskRef, data: Uint8Array): void {
    const m = this.masks.get(ref);
    if (!m) return;
    if (data.length !== m.width * m.height) {
      throw new Error(`updateData: expected ${m.width * m.height} bytes, got ${data.length}`);
    }
    m.data = data;
    this.bump();
  }

  setLabel(ref: MaskRef, label: string): void {
    const m = this.masks.get(ref);
    if (!m || m.label === label) return;
    m.label = label;
    this.bump();
  }

  remove(ref: MaskRef): boolean {
    const deleted = this.masks.delete(ref);
    if (deleted) this.bump();
    return deleted;
  }

  clear(): void {
    if (this.masks.size === 0) return;
    this.masks.clear();
    this.bump();
  }

  has(ref: MaskRef): boolean {
    return this.masks.has(ref);
  }

  get size(): number {
    return this.masks.size;
  }

  allForLayer(layerId: string): Mask[] {
    return Array.from(this.masks.values()).filter((m) => m.layerId === layerId);
  }

  all(): Mask[] {
    return Array.from(this.masks.values());
  }
}

export const maskStore = new MaskStoreImpl();
