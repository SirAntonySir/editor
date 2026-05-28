import { ProcessingRegistry } from '@/lib/processing-registry';
import { lightProcessing } from './light';
import { colorProcessing } from './color';
import { kelvinProcessing } from './kelvin';
import { curvesProcessing } from './curves';
import { levelsProcessing } from './levels';
import { filtersProcessing } from './filters';
import { cropProcessing } from './crop';

export function registerAllProcessing(): void {
  ProcessingRegistry.register(lightProcessing);
  ProcessingRegistry.register(colorProcessing);
  ProcessingRegistry.register(kelvinProcessing);
  ProcessingRegistry.register(curvesProcessing);
  ProcessingRegistry.register(levelsProcessing);
  ProcessingRegistry.register(filtersProcessing);
  ProcessingRegistry.register(cropProcessing);
}

export {
  lightProcessing,
  colorProcessing,
  kelvinProcessing,
  curvesProcessing,
  levelsProcessing,
  filtersProcessing,
  cropProcessing,
};
