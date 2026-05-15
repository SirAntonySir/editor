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

  register(input: Omit<Mask, 'id'>): MaskRef {
    const id = crypto.randomUUID();
    this.masks.set(id, { ...input, id });
    return id;
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
  }

  setLabel(ref: MaskRef, label: string): void {
    const m = this.masks.get(ref);
    if (m) m.label = label;
  }

  remove(ref: MaskRef): boolean {
    return this.masks.delete(ref);
  }

  clear(): void {
    this.masks.clear();
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
