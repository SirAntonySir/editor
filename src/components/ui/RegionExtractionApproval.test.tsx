import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/ai-access', () => ({ useAiAccess: () => true }));

const { RegionExtractionApproval } = await import('./RegionExtractionApproval');
const { useRegionExtractionApproval } = await import('@/store/region-extraction-approval');

afterEach(cleanup);
beforeEach(() => useRegionExtractionApproval.getState().reset());

it('renders nothing when no regions are pending', () => {
  const { container } = render(<RegionExtractionApproval />);
  expect(container.firstChild).toBeNull();
});

it('renders a chip per pending region and resolves the choice on click', async () => {
  const p = useRegionExtractionApproval.getState().request('sky');
  render(<RegionExtractionApproval />);
  expect(screen.getByText(/sky/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /new layer/i }));

  await expect(p).resolves.toBe('layer');
  expect(useRegionExtractionApproval.getState().pending).toHaveLength(0);
});

it('resolves to deny when the user skips the region', async () => {
  const p = useRegionExtractionApproval.getState().request('shoes');
  render(<RegionExtractionApproval />);
  fireEvent.click(screen.getByRole('button', { name: /^deny$/i }));
  await expect(p).resolves.toBe('deny');
});

it("resolves to draw when the user chooses to draw it themselves", async () => {
  const p = useRegionExtractionApproval.getState().request('car');
  render(<RegionExtractionApproval />);
  fireEvent.click(screen.getByRole('button', { name: /draw it myself/i }));
  await expect(p).resolves.toBe('draw');
});
