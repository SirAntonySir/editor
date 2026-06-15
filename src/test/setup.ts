import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom does not implement scrollIntoView; stub it so any component that calls
// element.scrollIntoView() (e.g. CommandPalette keyboard nav) doesn't throw.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// jsdom does not implement setPointerCapture / releasePointerCapture; stub
// them so components using pointer capture (e.g. CurveEditor drag) don't
// throw when the event fires during tests.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

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

// jsdom does not implement DOMMatrix / DOMMatrixReadOnly. React Flow's
// `updateNodeInternals` (called via rAF from inside the renderer) reads
// `new window.DOMMatrixReadOnly(...)` and throws an uncaught exception
// otherwise — which `vitest` surfaces as "Errors 2 errors" and fails the
// pre-commit gate even though no test assertion failed. A trivial 2-D
// identity-matrix stub is enough; we only need the constructor to exist
// so the read at the end of the animation frame doesn't throw.
class DOMMatrixReadOnlyPolyfill {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  m11 = 1; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 1; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 1; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 1;
  is2D = true;
  isIdentity = true;
  constructor(_init?: string | number[]) { /* identity is fine for tests */ }
}
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrixReadOnly = DOMMatrixReadOnlyPolyfill;
}
if (typeof globalThis.DOMMatrix === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = DOMMatrixReadOnlyPolyfill;
}

// jsdom does not implement Path2D. SegmentMaskPreview builds one to stroke
// the marching-ants outline each frame. Tests just need the constructor +
// the methods we call to exist as no-ops.
if (typeof globalThis.Path2D === 'undefined') {
  class Path2DPolyfill {
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Path2D = Path2DPolyfill;
}
