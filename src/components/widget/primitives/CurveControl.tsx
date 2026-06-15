import { CurveEditor } from '@/components/ui/CurveEditor';
import type { CurvesValue } from '@/types/widget';

interface CurveControlProps {
  label: string;
  value: CurvesValue;
  onChange: (value: CurvesValue) => void;
}

export function CurveControl({ label, value, onChange }: CurveControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-primary px-1.5">{label}</span>
      <CurveEditor value={value} onChange={onChange} />
    </div>
  );
}
