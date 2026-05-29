import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    encoderState: 'idle',
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('segmentation slice', () => {
  it('starts with idle encoderState', () => {
    expect(useEditorStore.getState().encoderState).toBe('idle');
  });

  it('setEncoderState transitions encoder lifecycle', () => {
    useEditorStore.getState().setEncoderState('loading-model');
    expect(useEditorStore.getState().encoderState).toBe('loading-model');
    useEditorStore.getState().setEncoderState('ready');
    expect(useEditorStore.getState().encoderState).toBe('ready');
  });
});
