// Builders that create realistic world state from the catalog.
import { MODELS, partSpec } from './catalog';
import { Rng } from './rng';
import { VENDORS, type VendorId } from './vendors';
import type { Cable, Component, ComponentKind, Device, Pdu, Rack, SlotDef, World } from './types';

export const SITE = 'PHX1';

let uidCounter = 0;
export function uid(prefix = 'c'): string {
  uidCounter += 1;
  return `${prefix}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function serialFor(rng: Rng, kind: ComponentKind): string {
  const prefix: Record<ComponentKind, string> = {
    cpu: 'CX',
    dimm: 'M5',
    psu: 'PS',
    fan: 'FN',
    hdd: 'ZL',
    nvme: 'NV',
    m2: 'MB',
    nic: 'OC',
    gpu: 'GP',
    cmos: 'BT',
    heatsink: 'HS',
  };
  return prefix[kind] + rng.alnum(kind === 'dimm' ? 8 : 10);
}

export function makeComponent(rng: Rng, pn: string, overrides: Partial<Component> = {}): Component {
  const spec = partSpec(pn);
  const c: Component = {
    uid: uid(),
    kind: spec.kind,
    partNumber: pn,
    serial: spec.vendor ? VENDORS[spec.vendor].partSerial(rng, spec.kind, pn) : serialFor(rng, spec.kind),
    health: 'ok',
    seated: true,
    dataBearing: spec.dataBearing,
    firmware: spec.kind === 'nvme' || spec.kind === 'hdd' || spec.kind === 'm2' ? `FW${rng.int(1, 9)}${rng.alnum(3)}` : undefined,
    ...overrides,
  };
  if (spec.kind === 'hdd' || spec.kind === 'nvme' || spec.kind === 'm2') {
    c.smart = {
      powerOnHours: rng.int(9000, 31000),
      reallocated: 0,
      pending: 0,
      uncorrectable: 0,
      wearPct: spec.kind === 'hdd' ? undefined : rng.int(3, 28),
      tempC: rng.int(31, 41),
    };
  }
  return c;
}

export function createEmptyWorld(seed: number): World {
  return {
    seed,
    t: 0,
    site: SITE,
    racks: {},
    devices: {},
    cables: {},
    tickets: {},
    ticketQueue: [],
    spares: [],
    bins: { rma: [], secure_destruction: [], ewaste: [] },
    trainee: { name: 'You', location: 'noc', side: 'front', esdStrap: false, flagged: [], notes: '', tray: [], liftAssist: false },
    pending: [],
    penalties: [],
    flags: {},
    log: [],
    toasts: [],
    toastSeq: 0,
    meta: {},
  };
}

export function createRack(row: string, position: number, opts: { hall?: string } = {}): Rack {
  const hall = opts.hall ?? 'H2';
  const id = `${row}${String(position).padStart(2, '0')}`;
  const mkPdu = (side: 'A' | 'B'): Pdu => ({
    id: `${id}-PDU-${side}`,
    side,
    breakerAmps: 32,
    volts: 415,
    phases: 3,
    outlets: 24,
    breakerTripped: false,
  });
  return {
    id,
    location: `${SITE}-${hall}-${row}${String(position).padStart(2, '0')}`,
    row,
    position,
    heightU: 42,
    pdus: [mkPdu('A'), mkPdu('B')],
    maxWeightKg: 1360,
    rails: {},
  };
}

/** Linux enumeration of front bays is deliberately not in bay order — a real-world gotcha. */
function assignOsNames(rng: Rng, modelId: string): Record<string, string> {
  const m = MODELS[modelId];
  const names: Record<string, string> = {};
  const bays = m.slots.filter((s) => s.kind === 'hdd' || s.kind === 'nvme');
  if (bays.length && bays[0].kind === 'hdd') {
    // Keep it *mostly* ordered with a couple of swaps, like real HBA enumeration after a reboot.
    const ordered = bays.map((_, i) => `sd${String.fromCharCode(97 + i)}`);
    const swaps = rng.int(2, 3);
    for (let i = 0; i < swaps; i++) {
      const a = rng.int(0, ordered.length - 1);
      const b = rng.int(0, ordered.length - 1);
      [ordered[a], ordered[b]] = [ordered[b], ordered[a]];
    }
    bays.forEach((b, i) => (names[b.id] = ordered[i]));
  } else {
    // M.2 boot drives enumerate first, so front bay 0 is nvme2n1, etc. Shuffle a pair too.
    const ordered = bays.map((_, i) => `nvme${i + 2}n1`);
    const a = rng.int(0, ordered.length - 1);
    const b = rng.int(0, ordered.length - 1);
    [ordered[a], ordered[b]] = [ordered[b], ordered[a]];
    bays.forEach((s, i) => (names[s.id] = ordered[i]));
  }
  names.M2_0 = 'nvme0n1';
  names.M2_1 = 'nvme1n1';
  return names;
}

export function createDevice(
  rng: Rng,
  modelId: string,
  opts: { hostname: string; rackId: string | null; u: number | null; bmcIp?: string },
): Device {
  const m = MODELS[modelId];
  const slots: Record<string, Component | null> = {};
  const latches: Record<string, 'open' | 'closed'> = {};
  for (const s of m.slots) {
    const pn = m.defaultParts[s.kind];
    slots[s.id] = pn ? makeComponent(rng, pn) : null;
    if (s.kind === 'dimm' || s.kind === 'hdd' || s.kind === 'nvme' || s.kind === 'psu' || s.kind === 'fan') latches[s.id] = 'closed';
  }
  const osNames = m.role === 'server' ? assignOsNames(rng, modelId) : {};
  const dev: Device = {
    id: uid('d'),
    model: modelId,
    role: m.role,
    hostname: opts.hostname,
    serial: m.vendor ? VENDORS[m.vendor].chassisSerial(rng) : (m.role === 'server' ? 'HX' : 'TX') + rng.alnum(8),
    assetTag: `AT${rng.int(100000, 999999)}`,
    rackId: opts.rackId,
    u: opts.u,
    heightU: m.heightU,
    weightKg: m.weightKg,
    powerW: Math.round(m.idleW + (m.maxW - m.idleW) * (0.35 + rng.next() * 0.3)),
    power: 'on',
    os: m.role === 'server' ? 'up' : 'up',
    slots,
    layers: { lid: true, shroud: true, riser1: true, riser2: true },
    heatsinks: { CPU0: true, CPU1: true },
    latches,
    fasteners: {},
    torque: {},
    servicePosition: false,
    powerCords: {},
    sel: [],
    selSeq: 0,
    locateLed: false,
    bmc: m.vendor
      ? { ip: opts.bmcIp ?? '0.0.0.0', mac: rng.mac(VENDORS[m.vendor].oui), responsive: true, fw: VENDORS[m.vendor].bmcFw(rng) }
      : { ip: opts.bmcIp ?? '0.0.0.0', mac: rng.mac('3C:EC:EF'), responsive: true, fw: `BMC ${rng.int(2, 4)}.${rng.int(10, 80)}.${rng.int(0, 9)}` },
    drained: false,
    bootOrder: ['NVMe: M.2 Boot 0', 'NVMe: M.2 Boot 1', 'PXE: OCP0 Port 0', 'UEFI Shell'],
    macs: { nic0p0: rng.mac(), nic0p1: rng.mac() },
    osNames,
    quirks: [],
  };
  return dev;
}

export function osName(dev: Device, slotId: string): string | undefined {
  return dev.osNames[slotId];
}

export function addCable(world: World, cable: Omit<Cable, 'id'>): Cable {
  const c: Cable = { id: uid('k'), ...cable };
  world.cables[c.id] = c;
  return c;
}

export interface RackBuildOpts {
  row: string;
  position: number;
  servers: Array<{ model: string; u: number }>;
  hostPrefix?: string;
}

/** A fully built production rack: ToR at U42, OOB switch at U41, servers below, all cabled and powered. */
export function buildRack(world: World, rng: Rng, opts: RackBuildOpts): Rack {
  const rack = createRack(opts.row, opts.position);
  world.racks[rack.id] = rack;
  const rackNo = String(opts.position).padStart(2, '0');

  const tor = createDevice(rng, 'tx-4808', { hostname: `${SITE.toLowerCase()}-tor-${opts.row.toLowerCase()}${rackNo}`, rackId: rack.id, u: 42 });
  const oob = createDevice(rng, 'mx-4801', { hostname: `${SITE.toLowerCase()}-oob-${opts.row.toLowerCase()}${rackNo}`, rackId: rack.id, u: 41 });
  for (const d of [tor, oob]) {
    world.devices[d.id] = d;
    rack.rails[d.u!] = { heightU: 1, holeOffset: 0 };
  }

  let outlet = 1;
  // switches get power too
  for (const d of [tor, oob]) {
    d.powerCords = { PSU1: `${rack.id}-PDU-A:${outlet}`, PSU2: `${rack.id}-PDU-B:${outlet}` };
    outlet++;
  }

  opts.servers.forEach((s, idx) => {
    const m = MODELS[s.model];
    const role = m.id === 'hx-2412s' ? 'sto' : 'cmp';
    const hostname = `${SITE.toLowerCase()}-${role}-${opts.row.toLowerCase()}${rackNo}u${String(s.u).padStart(2, '0')}`;
    const dev = createDevice(rng, s.model, {
      hostname,
      rackId: rack.id,
      u: s.u,
      bmcIp: `10.250.${opts.position + (opts.row.charCodeAt(0) - 64) * 20}.${s.u + 10}`,
    });
    world.devices[dev.id] = dev;
    rack.rails[s.u] = { heightU: m.heightU, holeOffset: 0 };
    dev.powerCords = { PSU1: `${rack.id}-PDU-A:${outlet}`, PSU2: `${rack.id}-PDU-B:${outlet}` };
    outlet++;
    const n = idx + 1;
    const lab = (u: number, p: string) => `${rack.id}-U${String(u).padStart(2, '0')}-${p}`;
    addCable(world, {
      type: 'dac',
      a: { deviceId: dev.id, port: 'nic0p0' },
      b: { deviceId: tor.id, port: `swp${n}` },
      lengthM: s.u < 22 ? 3 : 2,
      labelA: `${lab(s.u, 'P0')} > ${lab(42, `SWP${n}`)}`,
      labelB: `${lab(42, `SWP${n}`)} > ${lab(s.u, 'P0')}`,
      condition: 'ok',
    });
    addCable(world, {
      type: 'dac',
      a: { deviceId: dev.id, port: 'nic0p1' },
      b: { deviceId: tor.id, port: `swp${n + 24}` },
      lengthM: s.u < 22 ? 3 : 2,
      labelA: `${lab(s.u, 'P1')} > ${lab(42, `SWP${n + 24}`)}`,
      labelB: `${lab(42, `SWP${n + 24}`)} > ${lab(s.u, 'P1')}`,
      condition: 'ok',
    });
    addCable(world, {
      type: 'cat6',
      a: { deviceId: dev.id, port: 'bmc' },
      b: { deviceId: oob.id, port: `mgmt${n}` },
      lengthM: s.u < 22 ? 3 : 2,
      labelA: `${lab(s.u, 'BMC')} > ${lab(41, `MGMT${n}`)}`,
      labelB: `${lab(41, `MGMT${n}`)} > ${lab(s.u, 'BMC')}`,
      condition: 'ok',
    });
  });
  return rack;
}

/** Standard production rack layout: compute + a couple of storage nodes. */
export function standardRackServers(rng: Rng, opts: { storageCount?: number; count?: number; vendor?: VendorId } = {}) {
  // Fill the rack: 2U nodes from U3 up to U40 (U41/U42 hold the OOB and ToR switches).
  const count = opts.count ?? 19;
  const storageCount = opts.storageCount ?? 2;
  const out: Array<{ model: string; u: number }> = [];
  // heaviest (storage) at the bottom
  let u = 3;
  for (let i = 0; i < count; i++) {
    const models = opts.vendor ? VENDORS[opts.vendor].models : null;
    out.push({ model: i < storageCount ? (models?.storage.id ?? 'hx-2412s') : (models?.compute.id ?? 'hx-2208c'), u });
    u += 2;
  }
  void rng;
  return out;
}

export function devicesInRack(world: World, rackId: string): Device[] {
  return Object.values(world.devices)
    .filter((d) => d.rackId === rackId)
    .sort((a, b) => (b.u ?? 0) - (a.u ?? 0));
}

export function serverSlots(dev: Device): SlotDef[] {
  return MODELS[dev.model].slots;
}

export function findDeviceByHost(world: World, q: string): Device | undefined {
  const s = q.toLowerCase();
  return Object.values(world.devices).find(
    (d) => d.hostname.toLowerCase() === s || d.hostname.toLowerCase().split('.')[0] === s || d.bmc.ip === q || d.serial.toLowerCase() === s || d.assetTag.toLowerCase() === s,
  );
}

export function torFor(world: World, rackId: string): Device | undefined {
  return Object.values(world.devices).find((d) => d.rackId === rackId && d.role === 'switch');
}
