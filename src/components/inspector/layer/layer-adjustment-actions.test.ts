import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBackendState } from '@/store/backend-state-slice';
import {
  copyCanonicalToLayer,
  moveCanonicalToLayer,
  setWidgetTargetChecked,
} from './layer-adjustment-actions';
import type { LayerAdjustmentEntry } from '@/hooks/useLayerAdjustments';
import type { Widget } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_param: vi.fn().mockResolvedValue({ ok: true }),
    update_widget_targets: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { backendTools } from '@/lib/backend-tools';

const entry: LayerAdjustmentEntry = {
  kind: 'canonical',
  id: 'canon:L1:basic',
  label: 'Light',
  colorVar: 'var(--strand-tone)',
  defId: 'light',
  op: 'basic',
  touchedParams: [
    { key: 'exposure', value: 0.4, resetValue: 0 },
    { key: 'contrast', value: 12, resetValue: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: { revision: 5 } as never,
    optimistic: new Map(),
  } as never);
});

describe('copyCanonicalToLayer', () => {
  it('writes every touched param to the target layer', () => {
    copyCanonicalToLayer(entry, 'L2');
    expect(backendTools.set_param).toHaveBeenCalledTimes(2);
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', {
      layerId: 'L2', op: 'basic', param: 'exposure', value: 0.4,
    });
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', {
      layerId: 'L2', op: 'basic', param: 'contrast', value: 12,
    });
  });

  it('applies optimistic patches to the target canon node', () => {
    copyCanonicalToLayer(entry, 'L2');
    const patch = useBackendState.getState().optimistic.get('canon:L2:basic');
    expect(patch?.bindings).toEqual(
      expect.arrayContaining([
        { paramKey: 'exposure', value: 0.4 },
        { paramKey: 'contrast', value: 12 },
      ]),
    );
  });

  it('no-ops without a session', () => {
    useBackendState.setState({ sessionId: null } as never);
    copyCanonicalToLayer(entry, 'L2');
    expect(backendTools.set_param).not.toHaveBeenCalled();
  });
});

describe('moveCanonicalToLayer', () => {
  it('copies to the target and resets each param on the source', () => {
    moveCanonicalToLayer(entry, 'L1', 'L2');
    // 2 copies + 2 resets
    expect(backendTools.set_param).toHaveBeenCalledTimes(4);
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', {
      layerId: 'L2', op: 'basic', param: 'exposure', value: 0.4,
    });
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', {
      layerId: 'L1', op: 'basic', param: 'exposure', value: 0,
    });
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', {
      layerId: 'L1', op: 'basic', param: 'contrast', value: 0,
    });
  });
});

describe('setWidgetTargetChecked', () => {
  const w = { id: 'w1' } as Widget;

  it('checking adds the layer to the widget targets', () => {
    setWidgetTargetChecked(w, 'L3', true);
    expect(backendTools.update_widget_targets).toHaveBeenCalledWith('s1', {
      widgetId: 'w1', op: 'add', layerId: 'L3',
    });
  });

  it('unchecking removes the layer', () => {
    setWidgetTargetChecked(w, 'L3', false);
    expect(backendTools.update_widget_targets).toHaveBeenCalledWith('s1', {
      widgetId: 'w1', op: 'remove', layerId: 'L3',
    });
  });
});
