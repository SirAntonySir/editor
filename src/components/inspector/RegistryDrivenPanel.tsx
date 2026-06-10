import type { ReactNode } from 'react';
import type { RegistryOp, OpBinding } from '../../../shared/registry/schema';
import { CONTROL_MAP } from '../registry-controls';

export interface RegistryDrivenPanelProps {
  op: RegistryOp;
  values: Record<string, unknown>;
  onParamChange: (paramKey: string, value: unknown) => void;
  disabled?: boolean;
  /** Renders the Pin (or other) affordance for each binding, slotted next
   *  to the label by the control primitive. Caller composes per-key — e.g.
   *  the ToolrailSectionBody wraps each binding in `<SliderPinMenu>`. */
  renderPinSlot?: (paramKey: string, label: string) => ReactNode;
}

interface BindingGroup {
  group: string | null;
  bindings: OpBinding[];
}

function groupBindings(op: RegistryOp): BindingGroup[] {
  const byGroup = new Map<string | null, OpBinding[]>();
  for (const binding of op.bindings) {
    const key = binding.group ?? null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(binding);
  }
  const groups: BindingGroup[] = [];
  for (const [group, bindings] of byGroup) {
    groups.push({ group, bindings });
  }
  return groups;
}

function GroupTitle({ label }: { label: string }) {
  return (
    <div className="text-[9px] uppercase tracking-wide text-text-secondary pb-1 pt-0.5">
      {label}
    </div>
  );
}

export function RegistryDrivenPanel({
  op,
  values,
  onParamChange,
  disabled,
  renderPinSlot,
}: RegistryDrivenPanelProps) {
  const groups = groupBindings(op);
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {groups.map(({ group, bindings }) => (
        <div key={group ?? '_'}>
          {group && <GroupTitle label={group} />}
          <div className="flex flex-col gap-2">
            {bindings.map((binding) => {
              const Component = CONTROL_MAP[binding.control_type];
              const param = op.params[binding.param_key];
              if (!Component) {
                return (
                  <div key={binding.param_key} className="text-[10px] text-text-secondary">
                    missing control: {binding.control_type}
                  </div>
                );
              }
              return (
                <Component
                  key={binding.param_key}
                  paramKey={binding.param_key}
                  label={binding.label}
                  value={values[binding.param_key] ?? param.default}
                  schema={param}
                  onChange={(next) => onParamChange(binding.param_key, next)}
                  disabled={disabled}
                  pinSlot={renderPinSlot ? renderPinSlot(binding.param_key, binding.label) : undefined}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
