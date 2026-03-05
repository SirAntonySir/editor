interface LutEntry {
  size: number;
  data: Float32Array;
}

class LutRegistryImpl {
  private luts = new Map<string, LutEntry>();

  register(id: string, size: number, data: Float32Array): void {
    this.luts.set(id, { size, data });
  }

  get(id: string): LutEntry | undefined {
    return this.luts.get(id);
  }

  remove(id: string): boolean {
    return this.luts.delete(id);
  }

  clear(): void {
    this.luts.clear();
  }
}

export const LutRegistry = new LutRegistryImpl();
