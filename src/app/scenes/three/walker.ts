// First-person walker state. Lives outside React so the frame loop can update it every frame;
// UI bits (minimap, HUD) subscribe at a low rate.
import { useSyncExternalStore } from 'react';

export interface WalkerState {
  /** Scene coordinates (row-relative, see rackX). */
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Placed in the world yet (false right after a scenario starts). */
  init: boolean;
  /** "<rackId|aisle>:<side>" zone last reported to the sim. */
  zone: string;
}

export const walker: WalkerState = { x: 0, z: 14, yaw: 0, pitch: -0.05, init: false, zone: '' };

const subs = new Set<() => void>();
let version = 0;
export function notifyWalker() {
  version++;
  subs.forEach((f) => f());
}
export function resetWalker() {
  walker.init = false;
  walker.zone = '';
  notifyWalker();
}
export function useWalker(): WalkerState & { v: number } {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
  return { ...walker, v };
}

// Exposed for the E2E scripts (scripts/*.mjs).
(globalThis as unknown as { __WALKER__?: WalkerState }).__WALKER__ = walker;
