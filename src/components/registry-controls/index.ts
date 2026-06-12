import type { ComponentType } from 'react';
import { Slider } from './Slider';
import { Swatch } from './Swatch';
import { HueWheel } from './HueWheel';
import { CurveEditor } from './CurveEditor';
import { PointList } from './PointList';
import { EnumSelect } from './EnumSelect';
import { BoolToggle } from './BoolToggle';
import { KelvinStrip } from './KelvinStrip';
import { TintStrip } from './TintStrip';
import type { RegistryControlProps } from './Slider';

export type { RegistryControlProps };
export { Slider } from './Slider';
export { Swatch } from './Swatch';
export { HueWheel } from './HueWheel';
export { CurveEditor } from './CurveEditor';
export { PointList } from './PointList';
export { EnumSelect } from './EnumSelect';
export { BoolToggle } from './BoolToggle';
export { KelvinStrip } from './KelvinStrip';
export { TintStrip } from './TintStrip';

export const CONTROL_MAP: Record<string, ComponentType<RegistryControlProps>> = {
  slider: Slider,
  swatch: Swatch,
  hue_wheel: HueWheel,
  curve_editor: CurveEditor,
  point_list: PointList,
  enum_select: EnumSelect,
  bool_toggle: BoolToggle,
  kelvin_strip: KelvinStrip,
  tint_strip: TintStrip,
};
