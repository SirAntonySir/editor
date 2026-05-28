import { describe, it, expect, beforeEach } from 'vitest';
import { useFocusedWidget } from './focus-slice';

beforeEach(() => useFocusedWidget.getState().clear());

describe('focus slice', () => {
  it('setFocused stores the id', () => {
    useFocusedWidget.getState().setFocused('w_1');
    expect(useFocusedWidget.getState().focusedId).toBe('w_1');
  });
  it('clear resets', () => {
    useFocusedWidget.getState().setFocused('w_1');
    useFocusedWidget.getState().clear();
    expect(useFocusedWidget.getState().focusedId).toBeNull();
  });
  it('hover is separate from focus', () => {
    useFocusedWidget.getState().setHovered('w_2');
    expect(useFocusedWidget.getState().hoveredId).toBe('w_2');
    expect(useFocusedWidget.getState().focusedId).toBeNull();
  });
});
