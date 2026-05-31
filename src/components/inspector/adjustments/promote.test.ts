import { it, expect, vi, beforeEach } from 'vitest';
import { promoteToCanvas } from './promote';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { propose_widget: vi.fn().mockResolvedValue({ ok: true }) } }));

beforeEach(() => vi.clearAllMocks());

it('builds the tool_invoked propose_widget call', () => {
  promoteToCanvas('s1', 'light', 'L1');
  expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
    intent: 'light', scope: { kind: 'global' }, fused_tool_id: 'light', layer_id: 'L1', origin: 'tool_invoked',
  });
});

it('no-ops with no session or no layer', () => {
  promoteToCanvas(null, 'light', 'L1');
  promoteToCanvas('s1', 'light', null);
  expect(backendTools.propose_widget).not.toHaveBeenCalled();
});
