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

describe('CropPreview edge drag', () => {
  it('r edge drag increases w only', () => {
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
    const handle = document.querySelector('[data-handle="r"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 50, w: 220, h: 150 });
  });

  it('t edge drag adjusts y and h only', () => {
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
    const handle = document.querySelector('[data-handle="t"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 70, w: 200, h: 130 });
  });
});

describe('CropPreview aspect lock', () => {
  it('br drag with aspect 1:1 produces w === h (dx wins)', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={1}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // dx=10, dy=2 → source dx=40, dy=8. dx wins → dy gets recomputed so w === h.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const last = onCropChange.mock.lastCall![0];
    expect(last.w).toBe(last.h);
  });
});

describe('CropPreview clamping', () => {
  it('br drag past source right edge clamps w so x + w === sw', () => {
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
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // dx=200 → source dx=800. crop would become w=1000, but x+w must be ≤ 800.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const last = onCropChange.mock.lastCall![0];
    expect(last.x + last.w).toBe(800);
  });
});
