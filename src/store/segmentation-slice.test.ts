import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    activeMaskRef: null,
    committedMaskRef: null,
    encoderState: 'idle',
    activeScope: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('segmentation slice', () => {
  it('starts with null active and committed mask', () => {
    const s = useEditorStore.getState();
    expect(s.activeMaskRef).toBeNull();
    expect(s.committedMaskRef).toBeNull();
    expect(s.encoderState).toBe('idle');
  });

  it('setActiveMask updates only activeMaskRef', () => {
    useEditorStore.getState().setActiveMask('m1');
    expect(useEditorStore.getState().activeMaskRef).toBe('m1');
    expect(useEditorStore.getState().committedMaskRef).toBeNull();
  });

  it('commitMask moves activeMaskRef into committedMaskRef and clears active', () => {
    useEditorStore.getState().setActiveMask('m1');
    useEditorStore.getState().commitMask();
    expect(useEditorStore.getState().activeMaskRef).toBeNull();
    expect(useEditorStore.getState().committedMaskRef).toBe('m1');
  });

  it('discardCommittedMask clears the committed ref', () => {
    useEditorStore.getState().setActiveMask('m1');
    useEditorStore.getState().commitMask();
    useEditorStore.getState().discardCommittedMask();
    expect(useEditorStore.getState().committedMaskRef).toBeNull();
  });

  it('setEncoderState transitions encoder lifecycle', () => {
    useEditorStore.getState().setEncoderState('loading-model');
    expect(useEditorStore.getState().encoderState).toBe('loading-model');
    useEditorStore.getState().setEncoderState('ready');
    expect(useEditorStore.getState().encoderState).toBe('ready');
  });
});

describe('activeScope is consumed by addAdjustment', () => {
  afterEach(() => {
    useEditorStore.setState({ layers: [], activeLayerId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  });

  it('attaches scope to the new adjustment then clears activeScope', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'X',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().setActiveScope({ kind: 'mask', maskRef: 'm1' });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1', type: 'kelvin', name: 'k', enabled: true,
      blendMode: 'normal', opacity: 1, params: {},
    });
    const adj = useEditorStore.getState().layers[0].adjustmentStack.adjustments[0];
    expect(adj.scope).toEqual({ kind: 'mask', maskRef: 'm1' });
    expect(useEditorStore.getState().activeScope).toBeNull();
  });

  it('insertAdjustment also consumes activeScope', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'X',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().setActiveScope({ kind: 'mask', maskRef: 'm2' });
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'A2', type: 'curves', name: 'c', enabled: true,
      blendMode: 'normal', opacity: 1, params: {},
    }, 0);
    const adj = useEditorStore.getState().layers[0].adjustmentStack.adjustments[0];
    expect(adj.scope).toEqual({ kind: 'mask', maskRef: 'm2' });
    expect(useEditorStore.getState().activeScope).toBeNull();
  });
});
