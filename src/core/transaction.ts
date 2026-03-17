/**
 * TransactionCoordinator — wraps destructive operations (brush, crop, text)
 * with pre-state capture and commit/rollback semantics.
 */
import type { TransactionInfo, SerializableState } from './types';
import { pixelStore } from './pixel-store';

let activeTransaction: TransactionInfo | null = null;
let captureStateFn: (() => SerializableState) | null = null;
let restoreStateFn: ((snapshot: SerializableState) => void) | null = null;

export function setTransactionCallbacks(
  capture: () => SerializableState,
  restore: (snapshot: SerializableState) => void,
): void {
  captureStateFn = capture;
  restoreStateFn = restore;
}

/** Begin a destructive transaction. Captures pre-state metadata + pixels. */
export async function begin(
  label: string,
  affectedLayerIds: string[],
): Promise<void> {
  if (activeTransaction) {
    throw new Error(
      `Transaction already active: "${activeTransaction.label}". Commit or rollback first.`,
    );
  }
  if (!captureStateFn) throw new Error('Transaction callbacks not initialized');

  const preMetaSnapshot = captureStateFn();
  const prePixelSnapshots = await pixelStore.captureSnapshots(affectedLayerIds);

  activeTransaction = {
    label,
    affectedLayerIds,
    preMetaSnapshot,
    prePixelSnapshots,
  };
}

/** Commit the transaction — returns the captured pre-state for history. */
export function commit(): TransactionInfo {
  if (!activeTransaction) {
    throw new Error('No active transaction to commit');
  }
  const info = activeTransaction;
  activeTransaction = null;
  return info;
}

/** Rollback — restores pre-state metadata + pixels, discards transaction. */
export async function rollback(): Promise<void> {
  if (!activeTransaction || !restoreStateFn) return;

  restoreStateFn(activeTransaction.preMetaSnapshot);
  await pixelStore.restoreSnapshots(activeTransaction.prePixelSnapshots);
  activeTransaction = null;
}

/** Abort — discard transaction without restoring (for mode switch during stroke). */
export function abort(): void {
  activeTransaction = null;
}

export function getActive(): TransactionInfo | null {
  return activeTransaction;
}

export function isActive(): boolean {
  return activeTransaction !== null;
}
