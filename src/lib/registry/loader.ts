import { RegistryOpSchema, RegistryPresetSchema } from '../../../shared/registry/schema';
import type { RegistryOp, RegistryPreset } from '../../../shared/registry/schema';

export interface Registry {
  ops: Record<string, RegistryOp>;
  presets: Record<string, RegistryPreset>;
}

// Vite eager glob: contents loaded at build time, no async, no network.
const OP_MODULES = import.meta.glob('../../../shared/registry/ops/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const PRESET_MODULES = import.meta.glob('../../../shared/registry/presets/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

let cached: Registry | null = null;

export function loadRegistry(): Registry {
  if (cached) return cached;

  const ops: Record<string, RegistryOp> = {};
  for (const [path, raw] of Object.entries(OP_MODULES)) {
    const op = RegistryOpSchema.parse(raw);
    if (ops[op.id]) {
      throw new Error(`duplicate op id "${op.id}" loading ${path}`);
    }
    ops[op.id] = op;
  }

  const presets: Record<string, RegistryPreset> = {};
  for (const [path, raw] of Object.entries(PRESET_MODULES)) {
    const preset = RegistryPresetSchema.parse(raw);
    if (presets[preset.id]) {
      throw new Error(`duplicate preset id "${preset.id}" loading ${path}`);
    }
    for (const popl of preset.ops) {
      if (!ops[popl.op_id]) {
        throw new Error(
          `preset "${preset.id}" references unknown op "${popl.op_id}"`,
        );
      }
    }
    presets[preset.id] = preset;
  }

  cached = { ops, presets };
  return cached;
}

export function resetRegistryCache(): void {
  cached = null;
}
