import { it, expect, vi, beforeEach } from 'vitest';
import { promoteSingleBand } from './colour-band-spawn';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { proposeStack: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().clearSelection();
});

it('spawns a single-band HSL widget for the chosen band', () => {
  promoteSingleBand('s1', 'blue', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      preset_id: 'tone_blue',
      origin: 'tool_invoked',
      layerId: 'L1',
      scope: { kind: 'global' },
    }),
  );
});

it('no-ops without a session or layer', () => {
  promoteSingleBand(null, 'blue', 'L1');
  promoteSingleBand('s1', 'blue', null);
  expect(backendTools.proposeStack).not.toHaveBeenCalled();
});

it('uses global scope when no object is active', () => {
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    scope: { kind: 'global' },
  }));
});

it('uses mask scope when an object is active', () => {
  useEditorStore.setState({ activeObjectId: 'm-12' });
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    scope: { kind: 'mask', mask_id: 'm-12' },
  }));
});
