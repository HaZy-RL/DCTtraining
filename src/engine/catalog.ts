// Hardware catalog: server/switch models, slot layouts and part numbers.
// Generic, OCP/hyperscale-inspired nodes, plus Dell/HPE/Supermicro/Lenovo versions generated from vendors.ts.
import type { ComponentKind, SlotDef } from './types';
import { VENDOR_IDS, VENDORS, type VendorId } from './vendors';

export interface PartSpec {
  pn: string;
  kind: ComponentKind;
  desc: string;
  formFactor: string; // must match the slot's form factor to physically fit
  /** Explains why this part is a trap when it isn't an exact PN match. */
  gotcha?: string;
  dataBearing?: boolean;
  watts?: number;
  /** Set on vendor-branded parts; generic parts have none. */
  vendor?: VendorId;
}

export const PARTS: Record<string, PartSpec> = {
  // CPUs
  'CPU-X5-64C-2.4': { pn: 'CPU-X5-64C-2.4', kind: 'cpu', desc: 'CPU 64C 2.4GHz 350W (Socket SP-X5)', formFactor: 'sp-x5', watts: 350 },
  'CPU-X5-48C-2.6': {
    pn: 'CPU-X5-48C-2.6',
    kind: 'cpu',
    desc: 'CPU 48C 2.6GHz 300W (Socket SP-X5)',
    formFactor: 'sp-x5',
    gotcha: 'Same socket, different SKU. Mixed CPU SKUs in a 2-socket system fail POST with "Processor mismatch".',
    watts: 300,
  },
  // Memory
  'MEM-64G-D5-5600-2R': { pn: 'MEM-64G-D5-5600-2R', kind: 'dimm', desc: 'DIMM 64GB DDR5-5600 2Rx4 RDIMM', formFactor: 'ddr5-rdimm' },
  'MEM-64G-D5-4800-2R': {
    pn: 'MEM-64G-D5-4800-2R',
    kind: 'dimm',
    desc: 'DIMM 64GB DDR5-4800 2Rx4 RDIMM',
    formFactor: 'ddr5-rdimm',
    gotcha: 'Fits and boots, but the whole memory subsystem down-clocks to 4800 MT/s and fleet health flags a config mismatch.',
  },
  'MEM-32G-D5-5600-1R': {
    pn: 'MEM-32G-D5-5600-1R',
    kind: 'dimm',
    desc: 'DIMM 32GB DDR5-5600 1Rx8 RDIMM',
    formFactor: 'ddr5-rdimm',
    gotcha: 'Wrong capacity/rank. Host comes up with 992GB instead of 1024GB and fails hardware validation.',
  },
  // PSUs
  'PSU-1600W-AC-TI': { pn: 'PSU-1600W-AC-TI', kind: 'psu', desc: 'PSU 1600W AC 80+ Titanium, hot-plug', formFactor: 'crps-73', watts: 1600 },
  'PSU-1600W-48VDC': {
    pn: 'PSU-1600W-48VDC',
    kind: 'psu',
    desc: 'PSU 1600W -48V DC, hot-plug',
    formFactor: 'crps-73',
    gotcha: 'DC power supply! It slides into the bay but cannot accept the AC C13/C14 cord. PSU redundancy stays lost.',
    watts: 1600,
  },
  'PSU-1100W-AC-PL': {
    pn: 'PSU-1100W-AC-PL',
    kind: 'psu',
    desc: 'PSU 1100W AC 80+ Platinum, hot-plug',
    formFactor: 'crps-73',
    gotcha: 'Mismatched wattage. BMC reports "PSU mismatch" and redundancy is not guaranteed at full load.',
    watts: 1100,
  },
  // Fans
  'FAN-60X56-HP': { pn: 'FAN-60X56-HP', kind: 'fan', desc: 'Fan module 60x56mm high-performance, hot-plug', formFactor: 'fan-60' },
  'FAN-60X38-STD': {
    pn: 'FAN-60X38-STD',
    kind: 'fan',
    desc: 'Fan module 60x38mm standard',
    formFactor: 'fan-60',
    gotcha: 'Standard fan in a high-performance chassis (GPU/high-TDP config): BMC flags "Fan type mismatch" and runs all fans at 100%.',
  },
  // Drives
  'HDD-20T-SATA-7K2': { pn: 'HDD-20T-SATA-7K2', kind: 'hdd', desc: 'HDD 20TB SATA 7.2K 3.5" 512e', formFactor: '3.5', dataBearing: true },
  'HDD-20T-SAS-7K2': {
    pn: 'HDD-20T-SAS-7K2',
    kind: 'hdd',
    desc: 'HDD 20TB SAS 7.2K 3.5" 512e',
    formFactor: '3.5',
    gotcha: 'SAS drive on a SATA-only AHCI controller: it seats fine but the OS never sees it.',
    dataBearing: true,
  },
  'HDD-18T-SATA-7K2': {
    pn: 'HDD-18T-SATA-7K2',
    kind: 'hdd',
    desc: 'HDD 18TB SATA 7.2K 3.5" 512e',
    formFactor: '3.5',
    gotcha: 'Smaller capacity than the rest of the pool. Storage software rejects it as undersized.',
    dataBearing: true,
  },
  'NVME-7T68-U2-G4': { pn: 'NVME-7T68-U2-G4', kind: 'nvme', desc: 'NVMe SSD 7.68TB U.2 PCIe Gen4 2.5" 15mm', formFactor: 'u2', dataBearing: true },
  'NVME-7T68-E1S': {
    pn: 'NVME-7T68-E1S',
    kind: 'nvme',
    desc: 'NVMe SSD 7.68TB E1.S 9.5mm',
    formFactor: 'e1s',
    gotcha: 'E1.S ruler form factor. It physically cannot go into a U.2 bay.',
    dataBearing: true,
  },
  'M2-960G-NVME-22110': { pn: 'M2-960G-NVME-22110', kind: 'm2', desc: 'M.2 NVMe 960GB 22110 boot drive', formFactor: 'm2-22110', dataBearing: true },
  'M2-960G-NVME-2280': {
    pn: 'M2-960G-NVME-2280',
    kind: 'm2',
    desc: 'M.2 NVMe 960GB 2280',
    formFactor: 'm2-2280',
    gotcha: '2280 is 30mm shorter than 22110. It cannot reach the standoff screw, so do not force it.',
    dataBearing: true,
  },
  // NIC
  'OCP3-2X25G-SFP28': { pn: 'OCP3-2X25G-SFP28', kind: 'nic', desc: 'OCP 3.0 NIC 2x25GbE SFP28', formFactor: 'ocp3-sff' },
  'OCP3-2X100G-QSFP': {
    pn: 'OCP3-2X100G-QSFP',
    kind: 'nic',
    desc: 'OCP 3.0 NIC 2x100GbE QSFP56',
    formFactor: 'ocp3-sff',
    gotcha: 'QSFP ports. Your SFP28 DACs will not plug in, and the MAC/driver config changes.',
  },
  // GPU
  'GPU-24G-LP-PCIE4': { pn: 'GPU-24G-LP-PCIE4', kind: 'gpu', desc: 'Inference GPU 24GB low-profile PCIe Gen4 x16 72W', formFactor: 'pcie-lp', watts: 72 },
  // Misc
  'BATT-CR2032': { pn: 'BATT-CR2032', kind: 'cmos', desc: 'CMOS battery CR2032 3V lithium', formFactor: 'coin-20' },
  'BATT-CR2025': {
    pn: 'BATT-CR2025',
    kind: 'cmos',
    desc: 'Coin cell CR2025 3V',
    formFactor: 'coin-20',
    gotcha: 'Thinner cell (2.5mm vs 3.2mm). It makes intermittent contact and has lower capacity.',
  },
  'HS-2U-STD': { pn: 'HS-2U-STD', kind: 'heatsink', desc: '2U CPU heatsink', formFactor: 'hs-2u' },
};

/** Physical layout used by the 3D chassis scene. Units: 1 = 10cm. Origin at chassis centre floor. */
export interface SlotLayout {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface ServerModel {
  id: string;
  name: string;
  role: 'server' | 'switch' | 'mgmt_switch' | 'patch_panel';
  heightU: number;
  weightKg: number;
  idleW: number;
  maxW: number;
  slots: SlotDef[];
  layout: Record<string, SlotLayout>;
  /** form factor per slot kind */
  slotFormFactor: Partial<Record<ComponentKind, string>>;
  defaultParts: Partial<Record<ComponentKind, string>>;
  ports: string[];
  description: string;
  vendor?: VendorId;
  /** Chassis flavour: 8x 2.5" NVMe compute or 12x 3.5" storage. */
  form?: 'compute' | 'storage';
  /** Model badge printed on the chassis. */
  badge?: string;
}

function dimmSlots(): { slots: SlotDef[]; layout: Record<string, SlotLayout> } {
  const slots: SlotDef[] = [];
  const layout: Record<string, SlotLayout> = {};
  for (const [cpu, bank, cx] of [
    [0, 'A', -1.1],
    [1, 'B', 1.1],
  ] as const) {
    for (let i = 1; i <= 8; i++) {
      const id = `DIMM_${bank}${i}`;
      const left = i <= 4;
      const idx = left ? i - 1 : i - 5;
      const x = left ? cx - 0.62 - idx * 0.1 : cx + 0.62 + idx * 0.1;
      slots.push({
        id,
        kind: 'dimm',
        access: 'internal',
        hotSwap: false,
        requires: ['lid', 'shroud'],
        label: `${bank}${i}`,
        cpu,
        channel: String.fromCharCode(65 + (i - 1)),
      });
      layout[id] = { x, y: 0.05, z: 0.6, w: 0.04, h: 0.32, d: 1.33 };
    }
  }
  return { slots, layout };
}

function commonInternals(gpu: boolean) {
  const d = dimmSlots();
  const slots: SlotDef[] = [
    { id: 'CPU0', kind: 'cpu', access: 'internal', hotSwap: false, requires: ['lid', 'shroud', 'heatsink'], label: 'CPU0', cpu: 0 },
    { id: 'CPU1', kind: 'cpu', access: 'internal', hotSwap: false, requires: ['lid', 'shroud', 'heatsink'], label: 'CPU1', cpu: 1 },
    ...d.slots,
    ...[1, 2, 3, 4, 5, 6].map(
      (n): SlotDef => ({ id: `FAN${n}`, kind: 'fan', access: 'internal', hotSwap: true, requires: ['lid'], label: `Fan ${n}` }),
    ),
    { id: 'PSU1', kind: 'psu', access: 'rear', hotSwap: true, label: 'PSU1' },
    { id: 'PSU2', kind: 'psu', access: 'rear', hotSwap: true, label: 'PSU2' },
    { id: 'OCP0', kind: 'nic', access: 'rear', hotSwap: false, label: 'OCP 3.0 NIC', osName: 'eth0/eth1' },
    { id: 'M2_0', kind: 'm2', access: 'internal', hotSwap: false, requires: ['lid'], label: 'M.2 Boot 0' },
    { id: 'M2_1', kind: 'm2', access: 'internal', hotSwap: false, requires: ['lid'], label: 'M.2 Boot 1' },
    { id: 'CMOS', kind: 'cmos', access: 'internal', hotSwap: false, requires: ['lid', 'riser2'], label: 'CMOS battery' },
  ];
  if (gpu) slots.push({ id: 'PCIE1', kind: 'gpu', access: 'internal', hotSwap: false, requires: ['lid', 'riser1'], label: 'Riser1 Slot1 (GPU)' });

  const layout: Record<string, SlotLayout> = {
    ...d.layout,
    CPU0: { x: -1.1, y: 0.05, z: 0.6, w: 0.8, h: 0.06, d: 0.8 },
    CPU1: { x: 1.1, y: 0.05, z: 0.6, w: 0.8, h: 0.06, d: 0.8 },
    PSU1: { x: 1.78, y: 0.03, z: -2.83, w: 0.73, h: 0.39, d: 1.85 },
    PSU2: { x: 1.78, y: 0.45, z: -2.83, w: 0.73, h: 0.39, d: 1.85 },
    OCP0: { x: -1.65, y: 0.05, z: -3.2, w: 0.76, h: 0.12, d: 1.15 },
    M2_0: { x: -0.15, y: 0.05, z: -1.3, w: 0.22, h: 0.04, d: 1.1 },
    M2_1: { x: 0.15, y: 0.05, z: -1.3, w: 0.22, h: 0.04, d: 1.1 },
    CMOS: { x: 0.65, y: 0.05, z: -1.9, w: 0.2, h: 0.03, d: 0.2 },
    PCIE1: { x: -0.55, y: 0.25, z: -2.85, w: 0.75, h: 0.07, d: 1.68 },
  };
  for (let n = 1; n <= 6; n++) {
    layout[`FAN${n}`] = { x: -1.8 + (n - 1) * 0.72, y: 0.05, z: 2.2, w: 0.62, h: 0.62, d: 0.38 };
  }
  return { slots, layout };
}

function computeModel(): ServerModel {
  const c = commonInternals(true);
  const bays: SlotDef[] = [];
  const layout = { ...c.layout };
  for (let i = 0; i < 8; i++) {
    const id = `BAY${i}`;
    bays.push({ id, kind: 'nvme', access: 'front', hotSwap: true, label: `Bay ${i}` });
    layout[id] = { x: -2.0 + i * 0.26 + 0.12, y: 0.06, z: 3.0, w: 0.2, h: 0.72, d: 1.0 };
  }
  return {
    id: 'hx-2208c',
    name: 'HX-2208C Compute Node (2U)',
    role: 'server',
    heightU: 2,
    weightKg: 27,
    idleW: 310,
    maxW: 1150,
    slots: [...bays, ...c.slots],
    layout,
    slotFormFactor: {
      cpu: 'sp-x5',
      dimm: 'ddr5-rdimm',
      psu: 'crps-73',
      fan: 'fan-60',
      nvme: 'u2',
      m2: 'm2-22110',
      nic: 'ocp3-sff',
      gpu: 'pcie-lp',
      cmos: 'coin-20',
    },
    defaultParts: {
      cpu: 'CPU-X5-64C-2.4',
      dimm: 'MEM-64G-D5-5600-2R',
      psu: 'PSU-1600W-AC-TI',
      fan: 'FAN-60X56-HP',
      nvme: 'NVME-7T68-U2-G4',
      m2: 'M2-960G-NVME-22110',
      nic: 'OCP3-2X25G-SFP28',
      gpu: 'GPU-24G-LP-PCIE4',
      cmos: 'BATT-CR2032',
    },
    ports: ['nic0p0', 'nic0p1', 'bmc'],
    form: 'compute',
    description: '2-socket compute node with 16 DDR5 DIMMs, 8 front U.2 NVMe bays, a mirrored M.2 boot pair, an OCP 3.0 25G NIC and a low-profile GPU on Riser 1.',
  };
}

function storageModel(): ServerModel {
  const c = commonInternals(false);
  const bays: SlotDef[] = [];
  const layout = { ...c.layout };
  for (let i = 0; i < 12; i++) {
    const id = `BAY${i}`;
    const col = i % 4;
    const row = Math.floor(i / 4);
    bays.push({ id, kind: 'hdd', access: 'front', hotSwap: true, label: `Bay ${i}` });
    layout[id] = { x: -1.62 + col * 1.08, y: 0.04 + (2 - row) * 0.27, z: 2.85, w: 1.02, h: 0.26, d: 1.47 };
  }
  return {
    id: 'hx-2412s',
    name: 'HX-2412S Storage Node (2U)',
    role: 'server',
    heightU: 2,
    weightKg: 34,
    idleW: 280,
    maxW: 900,
    slots: [...bays, ...c.slots],
    layout,
    slotFormFactor: {
      cpu: 'sp-x5',
      dimm: 'ddr5-rdimm',
      psu: 'crps-73',
      fan: 'fan-60',
      hdd: '3.5',
      m2: 'm2-22110',
      nic: 'ocp3-sff',
      cmos: 'coin-20',
    },
    defaultParts: {
      cpu: 'CPU-X5-64C-2.4',
      dimm: 'MEM-64G-D5-5600-2R',
      psu: 'PSU-1600W-AC-TI',
      fan: 'FAN-60X56-HP',
      hdd: 'HDD-20T-SATA-7K2',
      m2: 'M2-960G-NVME-22110',
      nic: 'OCP3-2X25G-SFP28',
      cmos: 'BATT-CR2032',
    },
    ports: ['nic0p0', 'nic0p1', 'bmc'],
    form: 'storage',
    description: '2-socket JBOD storage node with 12 front 3.5" SATA HDDs on an AHCI/HBA controller. Data is replicated by the storage service, so there is no hardware RAID.',
  };
}

export const MODELS: Record<string, ServerModel> = {
  'hx-2208c': computeModel(),
  'hx-2412s': storageModel(),
  'tx-4808': {
    id: 'tx-4808',
    name: 'TX-4808 ToR Switch (1U, 48x25G + 8x100G)',
    role: 'switch',
    heightU: 1,
    weightKg: 9,
    idleW: 180,
    maxW: 420,
    slots: [],
    layout: {},
    slotFormFactor: {},
    defaultParts: {},
    ports: [...Array.from({ length: 48 }, (_, i) => `swp${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `swp${49 + i}`)],
    description: 'Top-of-rack data switch. Server NICs land on swp1–48; swp49–56 are 100G uplinks to the spine.',
  },
  'mx-4801': {
    id: 'mx-4801',
    name: 'MX-4801 OOB Mgmt Switch (1U, 48x1G RJ45)',
    role: 'mgmt_switch',
    heightU: 1,
    weightKg: 5,
    idleW: 45,
    maxW: 80,
    slots: [],
    layout: {},
    slotFormFactor: {},
    defaultParts: {},
    ports: Array.from({ length: 48 }, (_, i) => `mgmt${i + 1}`),
    description: 'Out-of-band management switch. Every BMC port lands here on a physically separate network.',
  },
};

// ---------- vendor parts and models ----------

/** Vendor PN for a generic PN. */
export function vendorPn(vendor: VendorId, genericPn: string): string {
  return VENDORS[vendor].parts[genericPn].pn;
}

for (const v of VENDOR_IDS) {
  for (const [gpn, vp] of Object.entries(VENDORS[v].parts)) {
    const g = PARTS[gpn];
    const gotcha = vp.gotcha === undefined ? g.gotcha : vp.gotcha || undefined;
    PARTS[vp.pn] = { ...g, pn: vp.pn, desc: vp.desc, vendor: v, watts: vp.watts ?? g.watts, formFactor: vp.formFactor ?? g.formFactor, gotcha };
  }
  const info = VENDORS[v];
  for (const form of ['compute', 'storage'] as const) {
    const base = form === 'compute' ? computeModel() : storageModel();
    const mi = info.models[form];
    const defaults: Partial<Record<ComponentKind, string>> = {};
    for (const [k, gpn] of Object.entries(base.defaultParts) as Array<[ComponentKind, string]>) defaults[k] = vendorPn(v, k === 'm2' && info.m2FormFactor === 'm2-2280' ? 'M2-960G-NVME-2280' : gpn);
    MODELS[mi.id] = {
      ...base,
      id: mi.id,
      name: mi.name,
      badge: mi.badge,
      description: mi.description,
      vendor: v,
      slots: base.slots.map((sl) => ({ ...sl, label: info.slotLabel(sl.id) ?? sl.label })),
      slotFormFactor: { ...base.slotFormFactor, m2: info.m2FormFactor },
      defaultParts: defaults,
    };
  }
}

export function vendorOf(modelId: string): VendorId | undefined {
  return MODELS[modelId]?.vendor;
}

/** Slot name for step/coach text: the vendor's label on vendor hardware, the slot id on generic nodes. */
export function displaySlot(modelId: string, slotId: string): string {
  return MODELS[modelId]?.vendor ? slotLabel(modelId, slotId) : slotId;
}

/** Label for a slot as the vendor prints it (falls back to the slot id). */
export function slotLabel(modelId: string, slotId: string): string {
  return MODELS[modelId]?.slots.find((s) => s.id === slotId)?.label ?? slotId;
}

export function partSpec(pn: string): PartSpec {
  const p = PARTS[pn];
  if (!p) throw new Error(`Unknown part ${pn}`);
  return p;
}

export function slotDef(modelId: string, slotId: string): SlotDef | undefined {
  return MODELS[modelId].slots.find((s) => s.id === slotId);
}

/** Decoy part numbers for a given correct PN (same kind and vendor, same form factor or a near miss). */
export function decoysFor(pn: string): string[] {
  const spec = partSpec(pn);
  return Object.values(PARTS)
    .filter((p) => p.kind === spec.kind && p.pn !== pn && p.gotcha && p.vendor === spec.vendor)
    .map((p) => p.pn);
}

export const KIND_LABEL: Record<ComponentKind, string> = {
  cpu: 'CPU',
  dimm: 'DIMM',
  psu: 'Power supply',
  fan: 'Fan module',
  hdd: 'Hard drive',
  nvme: 'NVMe SSD',
  m2: 'M.2 boot drive',
  nic: 'OCP NIC',
  gpu: 'GPU',
  cmos: 'CMOS battery',
  heatsink: 'Heatsink',
};

// ---------- fasteners ----------
// Everything that physically holds a part or cover in place. The trainee has to work each one
// by hand (in 3D or from the inspector) before the part comes out, and secure it again after.

export type FastenerKind = 'screw' | 'thumbscrew' | 'clip' | 'latch' | 'lever' | 'tab';

export interface FastenerDef {
  id: string;
  kind: FastenerKind;
  label: string;
  /** Tool needed, shown to the trainee. */
  tool?: string;
  /** Spring-loaded: re-engages by itself when the part is pushed home. */
  spring?: boolean;
  /** false = does not stop the part coming out (e.g. the PSU cord bail only holds the cord). */
  gatesRemoval?: boolean;
  /** What you physically do to release / secure it. */
  release: string;
  secure: string;
}

export type FastenerGroup = ComponentKind | 'lid' | 'riser' | 'chassis' | 'heatsink';

export const FASTENERS: Partial<Record<FastenerGroup, FastenerDef[]>> = {
  psu: [
    { id: 'bail', kind: 'clip', label: 'Cord retention bail', gatesRemoval: false, release: 'Flip the wire bail off the power plug', secure: 'Snap the wire bail over the power plug' },
    { id: 'tab', kind: 'tab', label: 'Green release tab', spring: true, release: 'Press and hold the green release tab', secure: 'Let go of the release tab' },
  ],
  fan: [{ id: 'latch', kind: 'latch', label: 'Orange finger latch', spring: true, release: 'Squeeze the orange finger latch', secure: 'Let go of the finger latch' }],
  nic: [{ id: 'thumb', kind: 'thumbscrew', label: 'Captive thumbscrew', release: 'Unscrew the captive thumbscrew (counter-clockwise)', secure: 'Finger-tighten the captive thumbscrew' }],
  gpu: [{ id: 'bracket', kind: 'screw', label: 'PCIe bracket screw', tool: '#2 Phillips', release: 'Remove the PCIe bracket screw', secure: 'Drive in the PCIe bracket screw' }],
  m2: [{ id: 'screw', kind: 'screw', label: 'M.2 retention screw', tool: '#1 Phillips', release: 'Remove the M.2 retention screw (the drive pops up at an angle)', secure: 'Press the drive flat and drive in the retention screw' }],
  cmos: [{ id: 'clip', kind: 'clip', label: 'Battery retention clip', spring: true, release: 'Push the retention clip aside with a plastic spudger', secure: 'Let the clip snap over the cell' }],
  cpu: [{ id: 'frame', kind: 'lever', label: 'Socket load-frame lever', release: 'Unhook the load lever and swing the frame open', secure: 'Close the frame and hook the load lever under its tab' }],
  lid: [
    { id: 'screw', kind: 'screw', label: 'Cover lock screw', tool: '#2 Phillips', release: 'Back out the cover lock screw', secure: 'Tighten the cover lock screw' },
    { id: 'latch', kind: 'lever', label: 'Cover release latch', release: 'Lift the cover release latch (the lid slides back)', secure: 'Press the cover latch flat' },
  ],
  riser: [
    { id: 'ts1', kind: 'thumbscrew', label: 'Rear thumbscrew', release: 'Loosen the rear riser thumbscrew', secure: 'Finger-tighten the rear riser thumbscrew' },
    { id: 'ts2', kind: 'thumbscrew', label: 'Front thumbscrew', release: 'Loosen the front riser thumbscrew', secure: 'Finger-tighten the front riser thumbscrew' },
  ],
  chassis: [
    { id: 'earL', kind: 'latch', label: 'Left rack-ear latch', spring: true, release: 'Lift the left rack-ear latch', secure: 'Push in until the left ear latch clicks' },
    { id: 'earR', kind: 'latch', label: 'Right rack-ear latch', spring: true, release: 'Lift the right rack-ear latch', secure: 'Push in until the right ear latch clicks' },
  ],
  heatsink: [1, 2, 3, 4].map((n) => ({
    id: `s${n}`,
    kind: 'screw' as const,
    label: `Heatsink screw ${n}`,
    tool: 'T30 Torx (torque driver)',
    release: `Loosen captive screw ${n}`,
    secure: `Torque captive screw ${n}`,
  })),
};

/** Which fastener group applies to a target ("PSU1", "lid", "riser2", "chassis", "heatsink:CPU0"). */
export function fastenerGroup(modelId: string, target: string): FastenerGroup | null {
  if (target === 'lid' || target === 'chassis') return target;
  if (target === 'riser1' || target === 'riser2') return 'riser';
  if (target.startsWith('heatsink:')) return 'heatsink';
  const s = slotDef(modelId, target);
  return s ? s.kind : null;
}

export function fastenersOf(modelId: string, target: string): FastenerDef[] {
  const g = fastenerGroup(modelId, target);
  return (g && FASTENERS[g]) || [];
}

/** What the part looks like and how it is held: shown in the inspector so a new tech learns to recognise it. */
export const KIND_ANATOMY: Record<ComponentKind, string> = {
  psu: 'CRPS power supply, 73.5 mm wide. Air flows front to back through the honeycomb grille. The C14 inlet takes a C13 cord with a wire retention bail; the green release tab sits beside the handle. Status LED: green = OK, amber = fault or no AC input.',
  fan: 'Dual-rotor 60 mm hot-swap fan module. It plugs straight into a connector on the fan board; the orange finger latch holds it in. Orange touch points mean hot-swappable.',
  hdd: '3.5" 7.2K SATA drive in a tool-less carrier. Press the release button and the handle swings open, which disconnects the drive from the backplane. Wait for the platters to spin down before you pull it.',
  nvme: '2.5" U.2 NVMe SSD (15 mm) in a carrier. The release button opens the handle; the drive is hot-plug once the OS has stopped using it.',
  dimm: 'DDR5 registered DIMM: 288 pins, with the key notch off-centre so it only fits one way. Ejector latches at both ends lock it into the slot.',
  cpu: 'LGA CPU in a carrier. Pins live in the socket, not on the CPU, so never touch the socket. The load frame clamps it down; the gold triangle marks pin 1.',
  heatsink: 'Copper-base heatsink with heat pipes. Four captive Torx screws are torqued in a cross pattern so the pressure on the CPU stays even.',
  m2: 'M.2 22110 NVMe boot SSD on the motherboard, held flat by a single retention screw at the far end. It is half of the mirrored (md RAID1) boot pair.',
  nic: 'OCP 3.0 SFF network card with two SFP28 cages. It slides in from the rear; a captive thumbscrew holds it and a pull tab pulls it out.',
  gpu: 'Low-profile PCIe Gen4 x16 inference GPU on Riser 1. The bracket screw holds it to the riser cage, so pull the riser first, then the card.',
  cmos: 'CR2032 3 V lithium coin cell under Riser 2. A spring clip holds it. Pulling it resets BIOS settings to defaults.',
};
