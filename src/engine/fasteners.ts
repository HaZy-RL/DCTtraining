// Fastener state helpers shared by the reducer, the coach and the UI.
import { fastenersOf, type FastenerDef } from './catalog';
import type { Device } from './types';

export const fkey = (target: string, id: string) => `${target}:${id}`;

/** Missing state = engaged (everything leaves the factory screwed down). */
export function isTight(dev: Device, target: string, id: string): boolean {
  return dev.fasteners[fkey(target, id)] !== false;
}

/** First fastener that still stops the part/cover from coming out. */
export function heldBy(dev: Device, target: string): FastenerDef | undefined {
  return fastenersOf(dev.model, target).find((f) => f.gatesRemoval !== false && isTight(dev, target, f.id));
}

/** Every fastener on the target is engaged (pass all=true to include the PSU cord bail). */
export function secured(dev: Device, target: string, all = false): boolean {
  return fastenersOf(dev.model, target)
    .filter((f) => all || f.gatesRemoval !== false)
    .every((f) => isTight(dev, target, f.id));
}

/** A freshly inserted part or re-fitted cover: spring catches engage, screws/levers are still loose. */
export function looseAfterInsert(dev: Device, target: string) {
  for (const f of fastenersOf(dev.model, target)) dev.fasteners[fkey(target, f.id)] = !!f.spring;
}

export function heatsinkTorqued(dev: Device, cpu: string): boolean {
  return [1, 2, 3, 4].every((n) => isTight(dev, `heatsink:${cpu}`, `s${n}`));
}
