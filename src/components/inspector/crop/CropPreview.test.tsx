import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { CropPreview } from './CropPreview';

afterEach(cleanup);

function makeBitmap(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

describe('CropPreview corner drag', () => {
  it('br corner drag increases w and h in source pixels', () => {
    const onCropChange = vi.fn();
    // Source 800×600, preview 200×150 → scale 4× per axis.
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // Screen delta of (+10, +10) → source delta of (+40, +40).
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 110, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 50, w: 240, h: 190 });
  });

  it('tl corner drag adjusts x, y, and shrinks w, h accordingly', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="tl"]') as HTMLElement;
    // Screen delta of (+5, +5) → source delta of (+20, +20).
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 120, y: 70, w: 180, h: 130 });
  });
});
