import { describe, it, expect, beforeEach } from 'vitest';
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

  it('setActiveScope sets the active scope', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    expect(useEditorStore.getState().activeScope).toEqual({ kind: 'mask', mask_id: 'm1' });
    useEditorStore.getState().setActiveScope(null);
    expect(useEditorStore.getState().activeScope).toBeNull();
  });
});
