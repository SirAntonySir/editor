import type { TargetRef, InsertionIntent } from '@/types/ai-target';

type OpenHandler = (target: TargetRef, intent: InsertionIntent) => void;
type SeedSetter = (seed: { target: TargetRef; intent: InsertionIntent } | null) => void;

let openHandler: OpenHandler | null = null;
let seedSetter: SeedSetter | null = null;

export function setPaletteOpenHandler(h: OpenHandler | null) { openHandler = h; }
export function bindSeedSetter(fn: SeedSetter | null) { seedSetter = fn; }

export function openPaletteWith(target: TargetRef, intent: InsertionIntent = 'append') {
  openHandler?.(target, intent);
}

export function setPaletteSeed(seed: { target: TargetRef; intent: InsertionIntent } | null) {
  seedSetter?.(seed);
}
