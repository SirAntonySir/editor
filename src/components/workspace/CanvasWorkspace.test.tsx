import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CanvasWorkspace } from './CanvasWorkspace';
import { useEditorStore } from '@/store';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
});

afterEach(cleanup);

describe('CanvasWorkspace', () => {
  it('renders an empty workspace when no nodes exist', () => {
    useEditorStore.getState().resetWorkspace();
    render(<CanvasWorkspace />);
    expect(document.querySelector('.react-flow')).toBeTruthy();
  });

  it('renders an Image node for each entry in the store', () => {
    useEditorStore.getState().resetWorkspace();
    const id = useEditorStore.getState().addImageNode(['l-1'], { x: 50, y: 50 });
    render(<CanvasWorkspace />);
    expect(document.querySelector(`[data-id="${id}"]`)).toBeTruthy();
  });
});
