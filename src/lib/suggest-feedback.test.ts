import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/hooks/useImageContext', () => ({
  suggestForImageNode: vi.fn(),
}));
vi.mock('@/components/ui/Toast', () => ({
  toast: { info: vi.fn() },
}));

import { suggestForImageNode } from '@/hooks/useImageContext';
import { toast } from '@/components/ui/Toast';
import { suggestWithFeedback } from './suggest-feedback';

const suggestMock = vi.mocked(suggestForImageNode);

beforeEach(() => vi.clearAllMocks());

describe('suggestWithFeedback', () => {
  it('toasts "nothing stood out" when the run mints nothing', async () => {
    suggestMock.mockResolvedValue({ widgetIds: [], reason: 'nothing_to_suggest' });
    await suggestWithFeedback('node1');
    expect(toast.info).toHaveBeenCalledWith(
      'No new suggestions — nothing stood out on this image.',
    );
  });

  it('toasts the cooldown message on a rapid re-click', async () => {
    suggestMock.mockResolvedValue({ widgetIds: [], reason: 'cooldown' });
    await suggestWithFeedback('node1');
    expect(toast.info).toHaveBeenCalledWith(
      'Suggestions were just refreshed — try again in a moment.',
    );
  });

  it('toasts the analyze hint on the defensive no_context reason', async () => {
    suggestMock.mockResolvedValue({ widgetIds: [], reason: 'no_context' });
    await suggestWithFeedback('node1');
    expect(toast.info).toHaveBeenCalledWith('Analyze the image first.');
  });

  it('stays silent when widgets were minted — the chips are the feedback', async () => {
    suggestMock.mockResolvedValue({ widgetIds: ['w1'], reason: null });
    await suggestWithFeedback('node1');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('stays silent when the analyze path was taken (null result)', async () => {
    suggestMock.mockResolvedValue(null);
    await suggestWithFeedback('node1');
    expect(toast.info).not.toHaveBeenCalled();
  });
});
