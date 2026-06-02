import '@testing-library/jest-dom/vitest';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement PointerEvent; polyfill with MouseEvent so that
// @testing-library's fireEvent.pointer* passes clientX/clientY correctly.
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
}
