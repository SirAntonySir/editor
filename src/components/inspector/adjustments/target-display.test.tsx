import { render, screen, cleanup } from '@testing-library/react';
import { it, describe, expect, beforeEach, afterEach } from 'vitest';
import { AdjustmentsAccordion } from './AdjustmentsAccordion';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { registerAllProcessing } from '@/processing';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

// Repro for the "Target stuck on Whole image" bug: given an object is selected
// (activeObjectId) AND that object is owned by the active image node, the
// accordion header must display the object's label — not "Whole image".
describe('AdjustmentsAccordion target display (repro)', () => {
  beforeEach(() => {
    registerAllProcessing();
    objectOwnership._resetForTests();
  });
  afterEach(() => cleanup());

  it('shows the selected object label when activeObjectId points at an owned object', () => {
    const nodeId = 'in_1';
    // A 4×4 mask with a single filled pixel → non-empty bbox (required, else
    // useImageNodeObjects drops it).
    const data = new Uint8Array(16);
    data[5] = 255;
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky', width: 4, height: 4, data,
      source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, nodeId);

    useBackendState.setState({
      sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
      snapshot: {
        sessionId: 's1', imageContext: null, widgets: [],
        masksIndex: [{ id: maskId, label: 'Sky', imageNodeId: nodeId }],
        operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      } as never,
    } as never);

    useEditorStore.setState({
      activeLayerId: 'L1',
      activeImageNodeId: nodeId,
      activeObjectId: maskId,
      expandedSectionIds: new Set(),
    } as never);

    render(<AdjustmentsAccordion />);
    expect(screen.getByText('Sky')).toBeTruthy();
    expect(screen.queryByText('Whole image')).toBeNull();
  });
});
