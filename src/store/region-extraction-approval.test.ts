import { it, expect, beforeEach } from 'vitest';
import { useRegionExtractionApproval } from './region-extraction-approval';

beforeEach(() => useRegionExtractionApproval.getState().reset());

it('request enqueues a pending region and resolves with the chosen value', async () => {
  const p = useRegionExtractionApproval.getState().request('sky');
  const pending = useRegionExtractionApproval.getState().pending;
  expect(pending).toHaveLength(1);
  expect(pending[0].label).toBe('sky');

  useRegionExtractionApproval.getState().resolve(pending[0].id, 'layer');
  await expect(p).resolves.toBe('layer');
  // Chip is removed once resolved.
  expect(useRegionExtractionApproval.getState().pending).toHaveLength(0);
});

it('tracks multiple independent requests', async () => {
  const a = useRegionExtractionApproval.getState().request('sky');
  const b = useRegionExtractionApproval.getState().request('shoes');
  const [pa, pb] = useRegionExtractionApproval.getState().pending;
  useRegionExtractionApproval.getState().resolve(pb.id, 'node');
  useRegionExtractionApproval.getState().resolve(pa.id, 'deny');
  await expect(a).resolves.toBe('deny');
  await expect(b).resolves.toBe('node');
});

it('reset denies any stragglers and clears pending', async () => {
  const p = useRegionExtractionApproval.getState().request('sky');
  useRegionExtractionApproval.getState().reset();
  await expect(p).resolves.toBe('deny');
  expect(useRegionExtractionApproval.getState().pending).toHaveLength(0);
});
