import { it, expect, vi, beforeEach } from 'vitest';
import { promoteSingleBand } from './colour-band-spawn';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { propose_widget: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('spawns a single-band HSL widget for the chosen band', () => {
  promoteSingleBand('s1', 'blue', 'L1');
  expect(backendTools.propose_widget).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      op_id: 'hsl_blue',
      origin: 'tool_invoked',
      layer_id: 'L1',
      scope: { kind: 'global' },
    }),
  );
});

it('no-ops without a session or layer', () => {
  promoteSingleBand(null, 'blue', 'L1');
  promoteSingleBand('s1', 'blue', null);
  expect(backendTools.propose_widget).not.toHaveBeenCalled();
});
