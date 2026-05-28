import { describe, it, expect, beforeEach } from 'vitest';
import * as history from './history';

interface FakeSnap { value: number }

describe('history (linear stack)', () => {
  beforeEach(() => history.clear());

  it('returns null undo when empty', () => {
    expect(history.undo()).toBeNull();
  });

  it('push then undo returns the prior snap', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    expect(history.undo<FakeSnap>()).toEqual({ value: 1 });
  });

  it('undo then redo restores', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.undo<FakeSnap>();
    expect(history.redo<FakeSnap>()).toEqual({ value: 2 });
  });

  it('push truncates redo tail', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.push<FakeSnap>({ value: 3 });
    history.undo<FakeSnap>();
    history.undo<FakeSnap>();
    history.push<FakeSnap>({ value: 99 });
    expect(history.redo<FakeSnap>()).toBeNull();
  });

  it('caps stack at MAX_ENTRIES', () => {
    history.initWith<FakeSnap>({ value: 0 });
    for (let i = 1; i <= 25; i++) history.push<FakeSnap>({ value: i });
    let count = 0;
    while (history.undo<FakeSnap>() !== null) count++;
    expect(count).toBeLessThanOrEqual(20);
  });
});
