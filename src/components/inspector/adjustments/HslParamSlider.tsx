import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { useParamProvenance, touchKey } from '@/hooks/useParamProvenance';
import { useEditorStore } from '@/store';

interface HslParamSliderProps {
  layerId: string;
  /** Canonical param key, e.g. `blue_sat`. */
  param: string;
  label: string;
  trackGradient: string;
}

/** One HSL param as a colour-track slider — the shared leaf for both views. */
export function HslParamSlider({ layerId, param, label, trackGradient }: HslParamSliderProps) {
  const [value, setValue] = useCanonicalParam<number>(layerId, 'hsl', param, 0);
  const provenance = useParamProvenance(layerId, 'hsl', param, value, 0);
  function onChange(v: number) {
    useEditorStore.getState().markParamTouched(touchKey(layerId, 'hsl', param));
    setValue(v);
  }
  return (
    <AdjustmentSlider
      label={label}
      value={value}
      min={-100}
      max={100}
      defaultValue={0}
      provenance={provenance}
      trackGradient={trackGradient}
      onChange={onChange}
    />
  );
}
