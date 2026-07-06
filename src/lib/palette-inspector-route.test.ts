import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) },
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { info: vi.fn() } }));

import { routeOpToInspector, routePresetToInspector } from './palette-inspector-route';
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
