import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_param: vi.fn().mockResolvedValue({ ok: true }),
    proposeStack: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { info: vi.fn() } }));

import { routeOpToInspector, routePresetToInspector, dispatchOp, dispatchPreset } from './palette-inspector-route';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['l1'], position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, sourceSize: { w: 10, h: 10 } },
    },
    activeImageNodeId: 'in-1',
    activeLayerId: 'l1',
    activeObjectId: null,
    expandedSectionIds: new Set<string>(),
    sectionScrollTarget: null,
  });
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open' });
  // Start with the inspector NOT on adjustments / collapsed so the routing is observable.
  usePreferencesStore.setState({ inspectorTab: 'info', rightSidebarCollapsed: true, rightSidebarTab: 'ai' });
});

describe('palette-inspector-route — baseline launcher', () => {
  it('routeOpToInspector opens Adjustments and expands + scrolls to the op, with NO canonical write', () => {
    routeOpToInspector('light');
    const prefs = usePreferencesStore.getState();
    expect(prefs.inspectorTab).toBe('adjustments');
    expect(prefs.rightSidebarCollapsed).toBe(false);
    const ed = useEditorStore.getState();
    expect(ed.expandedSectionIds.has('light')).toBe(true);
    expect(ed.sectionScrollTarget).toBe('light');
    // Op rows are a pure launcher — no side effect on canonical.
    expect(backendTools.set_param).not.toHaveBeenCalled();
  });

  it('routePresetToInspector applies the preset params to canonical and opens the touched sections', () => {
    routePresetToInspector('blue_hour'); // kelvin:4200, light shadows:-25, color saturation:15
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(backendTools.set_param).toHaveBeenCalledTimes(3);
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layerId: 'l1', op: 'kelvin', param: 'kelvin', value: 4200 });
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layerId: 'l1', op: 'basic', param: 'shadows', value: -25 });
    expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layerId: 'l1', op: 'basic', param: 'saturation', value: 15 });
    const ed = useEditorStore.getState();
    expect(ed.expandedSectionIds.has('kelvin')).toBe(true);
    expect(ed.expandedSectionIds.has('light')).toBe(true);
    expect(ed.expandedSectionIds.has('color')).toBe(true);
  });

  it('no-ops when there is no active image node (same gate as the widget path)', () => {
    useEditorStore.setState({ activeImageNodeId: null });
    routeOpToInspector('light');
    expect(usePreferencesStore.getState().inspectorTab).toBe('info'); // unchanged
    expect(backendTools.set_param).not.toHaveBeenCalled();
  });
});

describe('palette-inspector-route — dispatchOp / dispatchPreset (shared by Cmd+K + menu)', () => {
  it('routes to the inspector when the AI widget layer is OFF (baseline)', () => {
    useBackendState.setState({ snapshot: { aiAccess: false } as never });
    dispatchOp('light', 'Light');
    // Deterministic inspector launcher — no canvas widget spawned.
    expect(backendTools.proposeStack).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
  });

  it('spawns a tool_invoked canvas widget when the AI widget layer is ON', () => {
    useBackendState.setState({ snapshot: { aiAccess: true } as never });
    dispatchOp('light', 'Light');
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', expect.objectContaining({
      forced_ops: ['light'],
      origin: 'tool_invoked',
      layerId: 'l1',
    }));
    // Widget path does not commandeer the inspector tab.
    expect(usePreferencesStore.getState().inspectorTab).toBe('info');
  });

  it('dispatchPreset gates the same way: canonical write in baseline, preset stack when ON', () => {
    useBackendState.setState({ snapshot: { aiAccess: false } as never });
    dispatchPreset('blue_hour', 'Blue Hour');
    expect(backendTools.proposeStack).not.toHaveBeenCalled();
    expect(backendTools.set_param).toHaveBeenCalled();

    vi.clearAllMocks();
    useBackendState.setState({ snapshot: { aiAccess: true } as never });
    dispatchPreset('blue_hour', 'Blue Hour');
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', expect.objectContaining({
      preset_id: 'blue_hour',
      origin: 'tool_invoked',
    }));
    expect(backendTools.set_param).not.toHaveBeenCalled();
  });
});
