import { ProcessingRegistry } from '@/lib/processing-registry';
import { lightProcessing } from './light';
import { colorProcessing } from './color';
import { hslProcessing } from './hsl';
import { kelvinProcessing } from './kelvin';
import { curvesProcessing } from './curves';
import { levelsProcessing } from './levels';
import { filtersProcessing } from './filters';
import { sharpenProcessing } from './sharpen';
import { blurProcessing } from './blur';
import { clarityProcessing } from './clarity';

export function registerAllProcessing(): void {
  ProcessingRegistry.register(lightProcessing);
  ProcessingRegistry.register(colorProcessing);
  ProcessingRegistry.register(hslProcessing);
  ProcessingRegistry.register(kelvinProcessing);
  ProcessingRegistry.register(curvesProcessing);
  ProcessingRegistry.register(levelsProcessing);
  ProcessingRegistry.register(filtersProcessing);
  ProcessingRegistry.register(sharpenProcessing);
  ProcessingRegistry.register(blurProcessing);
  ProcessingRegistry.register(clarityProcessing);
}

export {
  lightProcessing,
  colorProcessing,
  hslProcessing,
  kelvinProcessing,
  curvesProcessing,
  levelsProcessing,
  filtersProcessing,
  sharpenProcessing,
  blurProcessing,
  clarityProcessing,
};
