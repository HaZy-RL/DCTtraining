// Shared world templates for scenarios.
import { buildRack, createEmptyWorld, standardRackServers } from '../engine/factory';
import { Rng } from '../engine/rng';
import type { Device, World } from '../engine/types';
import type { VendorId } from '../engine/vendors';

export interface StdWorld {
  w: World;
  rng: Rng;
  rackId: string;
  servers: Device[];
}

/** A small hall: the target rack plus neighbours, all in production. */
export function standardWorld(seed: number, opts: { racks?: number; storage?: number; row?: string; position?: number; vendor?: VendorId } = {}): StdWorld {
  const rng = new Rng(seed);
  const w = createEmptyWorld(seed);
  const row = opts.row ?? 'C';
  const position = opts.position ?? rng.int(3, 14);
  const n = opts.racks ?? 3;
  let target = '';
  for (let i = 0; i < n; i++) {
    const pos = position - 1 + i;
    const r = buildRack(w, rng, { row, position: pos, servers: standardRackServers(rng, { storageCount: opts.storage ?? 2, vendor: opts.vendor }) });
    if (i === 1 || n === 1) target = r.id;
  }
  if (!target) target = Object.keys(w.racks)[0];
  const servers = Object.values(w.devices).filter((d) => d.rackId === target && d.role === 'server');
  return { w, rng, rackId: target, servers };
}

export function pickServer(s: StdWorld, model: string): Device {
  const c = s.servers.filter((d) => d.model === model);
  return s.rng.pick(c);
}

export const DCO = 'You';
