export type InsertionIntent = 'append' | 'splice' | 'branch';

export type TargetRef =
  | { kind: 'layer'; layerId: string }
  | { kind: 'node'; layerId: string; adjustmentId: string }
  | { kind: 'composite' };

export function targetRefEquals(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'composite') return true;
  if (a.kind === 'layer' && b.kind === 'layer') return a.layerId === b.layerId;
  if (a.kind === 'node' && b.kind === 'node') {
    return a.layerId === b.layerId && a.adjustmentId === b.adjustmentId;
  }
  return false;
}
