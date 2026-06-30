import { it, expect, beforeEach } from 'vitest';
import { usePaletteRuntime } from './palette-runtime';

const restore = { doc: [{ kind: 'text' as const, text: 'hi' }], attachedContext: [] };

beforeEach(() => {
  usePaletteRuntime.setState({ pending: null, phase: null, error: null, restore: null });
});

it('start sets pending + restore and clears any prior error', () => {
  usePaletteRuntime.getState().fail({ message: 'old' });
  usePaletteRuntime.getState().start('brighten sky', restore);
  const s = usePaletteRuntime.getState();
  expect(s.pending).toBe('brighten sky');
  expect(s.error).toBeNull();
  expect(s.restore).toEqual(restore);
});

it('setPhase updates the sub-phase', () => {
  usePaletteRuntime.getState().start('p', restore);
  usePaletteRuntime.getState().setPhase('analyze');
  expect(usePaletteRuntime.getState().phase).toBe('analyze');
});

it('finish clears everything', () => {
  usePaletteRuntime.getState().start('p', restore);
  usePaletteRuntime.getState().setPhase('propose');
  usePaletteRuntime.getState().finish();
  expect(usePaletteRuntime.getState()).toMatchObject({ pending: null, phase: null, error: null, restore: null });
});

it('fail clears pending/phase but keeps restore so the prompt can be recovered', () => {
  usePaletteRuntime.getState().start('p', restore);
  usePaletteRuntime.getState().setPhase('propose');
  usePaletteRuntime.getState().fail({ message: 'nope' });
  const s = usePaletteRuntime.getState();
  expect(s.pending).toBeNull();
  expect(s.phase).toBeNull();
  expect(s.error).toEqual({ message: 'nope' });
  expect(s.restore).toEqual(restore);
});

it('clearError drops only the error', () => {
  usePaletteRuntime.getState().fail({ message: 'x' });
  usePaletteRuntime.getState().clearError();
  expect(usePaletteRuntime.getState().error).toBeNull();
});
