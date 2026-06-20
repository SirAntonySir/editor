import type { ProcessingDefinition, ParamDefinition } from '@/types/processing';

/**
 * Registry of ProcessingDefinitions (light, color, kelvin, curves, levels,
 * filters, …). Every public method is **defensively soft on misses**: a
 * lookup for an unregistered id returns `undefined` / `[]` / a fallback,
 * never throws. This is the Phase 4 contract — a freshly cloned tree
 * with a different set of registered ops should still render the widgets
 * for the ops it DOES know, falling through to a generic block-kit
 * renderer for the rest.
 */
class ProcessingRegistryImpl {
  private defs = new Map<string, ProcessingDefinition>();

  register(def: ProcessingDefinition): void {
    this.defs.set(def.id, def);
  }

  get(id: string): ProcessingDefinition | undefined {
    return this.defs.get(id);
  }

  getAll(): ProcessingDefinition[] {
    return Array.from(this.defs.values());
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  /** Get all processing defs that map to a given adjustment type. */
  getByAdjustmentType(adjustmentType: string): ProcessingDefinition[] {
    return this.getAll().filter((d) => d.adjustmentType === adjustmentType);
  }

  /** Get processing defs by category. */
  getByCategory(category: ProcessingDefinition['category']): ProcessingDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  /**
   * Given an adjustment, return the processing definition IDs (= graph node types)
   * that should be created for it.
   */
  getNodeTypesForAdjustment(adj: { type: string; params: Record<string, unknown> }): string[] {
    const defs = this.getByAdjustmentType(adj.type);
    if (defs.length === 0) return [];
    if (defs.length === 1) return [defs[0].id];
    // Multiple defs share this adjustment type — filter by which have matching params
    const matching = defs.filter((def) => {
      if (!def.paramKeys) return true;
      return def.paramKeys.some((k) => k in adj.params);
    });
    return matching.length > 0 ? matching.map((d) => d.id) : [defs[0].id];
  }

  /**
   * Filter params to only those owned by a given processing definition.
   * Returns all params if the def has no paramKeys constraint.
   */
  filterParamsForDef(
    defId: string,
    allParams: Record<string, number | Float32Array>,
  ): Record<string, number | Float32Array> {
    const def = this.get(defId);
    if (!def?.paramKeys) return { ...allParams };
    return Object.fromEntries(
      Object.entries(allParams).filter(([k]) => def.paramKeys!.includes(k)),
    );
  }

  /** Get param range for a given processing def and param key. */
  getParamRange(defId: string, paramKey: string): ParamDefinition | undefined {
    const def = this.get(defId);
    return def?.params.find((p) => p.key === paramKey);
  }

  /**
   * Get the display name for an adjustment type.
   * Returns the label of the first matching ProcessingDefinition,
   * or falls back to the capitalized type.
   */
  getAdjustmentName(adjustmentType: string): string {
    const defs = this.getByAdjustmentType(adjustmentType);
    if (defs.length === 1) return defs[0].label;
    if (defs.length > 1) {
      // Multiple defs share this type — return combined name
      return defs.map((d) => d.label).join(' & ');
    }
    return adjustmentType.charAt(0).toUpperCase() + adjustmentType.slice(1);
  }
}

export const ProcessingRegistry = new ProcessingRegistryImpl();
