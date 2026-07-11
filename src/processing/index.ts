import { ProcessingRegistry } from '@/lib/processing-registry';
import { buildRegistryProcessingDefs } from './registry-ops';
import { hslProcessing } from './hsl';
import { curvesProcessing } from './curves';
import { levelsProcessing } from './levels';

export function registerAllProcessing(): void {
  // Registry-driven ops (light, color, kelvin, sharpen, blur, clarity,
  // grain, vignette, splitTone): ProcessingDefinitions are generated from
  // the SSoT registry ops. Inspector rendering handled by RegistryDrivenSectionBody.
  for (const def of buildRegistryProcessingDefs()) {
    ProcessingRegistry.register(def);
  }

  // Bespoke panels — custom UI not yet replicated by RegistryDrivenPanel.
  ProcessingRegistry.register(hslProcessing);
  ProcessingRegistry.register(curvesProcessing);
  ProcessingRegistry.register(levelsProcessing);
}

export {
  hslProcessing,
  curvesProcessing,
  levelsProcessing,
};
