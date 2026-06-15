import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentMaskPreview } from './SegmentMaskPreview';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

function makeMask(w: number, h: number): DecodedMask {
  const data = new Uint8Array(w * h);
  // Fill a centered rectangle with 255 so the canvas has non-zero alpha
  for (let y = h / 4; y < (3 * h) / 4; y++) {
    for (let x = w / 4; x < (3 * w) / 4; x++) {
      data[y * w + x] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('SegmentMaskPreview', () => {
  it('mounts a canvas matching the mask dimensions and applies display size', () => {
    const mask = makeMask(64, 48);
    const { container } = render(
      <SegmentMaskPreview mask={mask} widthPx={400} heightPx={300} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // Drawing buffer matches mask resolution
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
    // CSS scales to display
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('300px');
  });

  it('renders nothing when mask is null', () => {
    const { container } = render(
      <SegmentMaskPreview mask={null} widthPx={400} heightPx={300} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });
});
