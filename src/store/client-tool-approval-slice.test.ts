import { describe, expect, it, beforeEach } from 'vitest';
import { useClientToolApproval } from './client-tool-approval-slice';

beforeEach(() => useClientToolApproval.getState().reset());

describe('client-tool-approval-slice', () => {
  it('enqueues and removes pending mutate requests by id', () => {
    const s = useClientToolApproval.getState();
    s.enqueue({ requestId: 'r1', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    s.enqueue({ requestId: 'r2', name: 'select_object', input: { maskId: 'm2' } });
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r1', 'r2']);

    s.remove('r1');
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r2']);
  });

  it('does not enqueue a duplicate requestId', () => {
    const s = useClientToolApproval.getState();
    s.enqueue({ requestId: 'r1', name: 'x', input: {} });
    s.enqueue({ requestId: 'r1', name: 'x', input: {} });
    expect(useClientToolApproval.getState().pending).toHaveLength(1);
  });

  it('reset clears everything', () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r1', name: 'x', input: {} });
    useClientToolApproval.getState().reset();
    expect(useClientToolApproval.getState().pending).toEqual([]);
  });
});
