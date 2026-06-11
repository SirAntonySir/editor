import { it, expect, vi, beforeEach } from 'vitest';
import { promoteToCanvas } from './promote';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { proposeStack: vi.fn().mockResolvedValue({ ok: true }) } }));

beforeEach(() => vi.clearAllMocks());

it('builds the tool_invoked proposeStack call', () => {
  promoteToCanvas('s1', 'light', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
    intent: 'light', scope: { kind: 'global' }, forced_ops: ['light'], layerId: 'L1', origin: 'tool_invoked',
  });
});

it('no-ops with no session or no layer', () => {
  promoteToCanvas(null, 'light', 'L1');
  promoteToCanvas('s1', 'light', null);
  expect(backendTools.proposeStack).not.toHaveBeenCalled();
});
