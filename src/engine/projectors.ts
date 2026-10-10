// Projectors: derive what every tool/view shows from the single World state.
// Keep these pure — they are what guarantees BMC, Linux, LEDs and 3D always agree.
import { MODELS, partSpec } from './catalog';
import type { Cable, Component, Device, Pdu, Rack, World } from './types';

// ---------- power ----------

export function parseOutlet(outlet: string): { rackId: string; side: 'A' | 'B'; n: number } | null {
  const m = /^(.+)-PDU-([AB]):(\d+)$/.exec(outlet);
  if (!m) return null;
  return { rackId: m[1], side: m[2] as 'A' | 'B', n: Number(m[3]) };
}

export function pduFor(world: World, outlet: string): Pdu | undefined {
  const p = parseOutlet(outlet);
  if (!p) return undefined;
  return world.racks[p.rackId]?.pdus.find((x) => x.side === p.side);
}

export function psuSlots(dev: Device): string[] {
  return MODELS[dev.model].slots.filter((s) => s.kind === 'psu').map((s) => s.id);
}

/** Why a PSU has or lacks AC input. */
export function psuInput(world: World, dev: Device, slot: string): { ok: boolean; reason: string } {
  if (dev.role !== 'server') {
    // switches: simplified, powered if any cord + pdu ok
    const cord = dev.powerCords[slot];
    if (!cord) return { ok: false, reason: 'No power cord' };
    const pdu = pduFor(world, cord);
    if (!pdu || pdu.breakerTripped) return { ok: false, reason: 'PDU breaker tripped' };
    return { ok: true, reason: 'OK' };
  }
  const c = dev.slots[slot];
  if (!c) return { ok: false, reason: 'PSU not present' };
  if (!c.seated) return { ok: false, reason: 'PSU not fully seated' };
  const cord = dev.powerCords[slot];
  if (!cord) return { ok: false, reason: 'No power cord connected' };
  if (dev.quirks.includes(`loose_cord:${slot}`)) return { ok: false, reason: 'Power cord loose (retention clip not engaged)' };
  if (c.partNumber.includes('48VDC')) return { ok: false, reason: 'DC PSU cannot accept AC input' };
  const pdu = pduFor(world, cord);
  if (!pdu) return { ok: false, reason: 'Cord not connected to a PDU' };
  if (pdu.breakerTripped) return { ok: false, reason: `${pdu.id} breaker tripped` };
  return { ok: true, reason: 'OK' };
}

export function psuGood(world: World, dev: Device, slot: string): boolean {
  const c = dev.slots[slot];
  return !!c && c.health === 'ok' && psuInput(world, dev, slot).ok;
}

export function hasAC(world: World, dev: Device): boolean {
  return psuSlots(dev).some((s) => psuGood(world, dev, s)) || (dev.role !== 'server' && Object.keys(dev.powerCords).some((s) => psuInput(world, dev, s).ok));
}

export function anyCordConnected(dev: Device): boolean {
  return Object.values(dev.powerCords).some((c) => !!c);
}

export function goodPsuCount(world: World, dev: Device): number {
  return psuSlots(dev).filter((s) => psuGood(world, dev, s)).length;
}

export function pduLoadW(world: World, pduId: string): number {
  let w = 0;
  for (const d of Object.values(world.devices)) {
    if (!d.rackId) continue;
    const cords = Object.values(d.powerCords).filter(Boolean) as string[];
    if (!cords.length) continue;
    const running = d.power === 'on' || d.power === 'posting';
    const draw = running ? d.powerW : d.role === 'server' ? 25 : d.powerW;
    const share = draw / cords.length;
    for (const c of cords) if (pduFor(world, c)?.id === pduId) w += share;
  }
  return Math.round(w);
}

export function pduCapacityW(p: Pdu): number {
  return Math.round(p.breakerAmps * p.volts * (p.phases === 3 ? Math.sqrt(3) : 1));
}
/** NEC/80% continuous-load rule. */
export function pduDeratedW(p: Pdu): number {
  return Math.round(pduCapacityW(p) * 0.8);
}

export function rackLoadW(world: World, rackId: string): number {
  return world.racks[rackId].pdus.reduce((s, p) => s + pduLoadW(world, p.id), 0);
}

export function rackWeightKg(world: World, rackId: string): number {
  return Object.values(world.devices)
    .filter((d) => d.rackId === rackId)
    .reduce((s, d) => s + d.weightKg, 0) + 120; // empty rack + PDUs
}

// ---------- thermal / sensors ----------

export function failedFans(dev: Device): number {
  return MODELS[dev.model].slots.filter((s) => s.kind === 'fan' && (!dev.slots[s.id] || dev.slots[s.id]!.health === 'failed')).length;
}

export function cpuTemp(dev: Device, cpu: 0 | 1): number {
  if (dev.power !== 'on' && dev.power !== 'posting') return 24;
  let t = 58 + cpu * 3;
  t += failedFans(dev) * 7;
  if (!dev.layers.shroud) t += 38;
  if (!dev.layers.lid) t += 9;
  if (!dev.heatsinks[`CPU${cpu}`]) t += 60;
  return Math.min(t, 105);
}

export interface Sensor {
  name: string;
  value: string;
  unit: string;
  status: 'ok' | 'nc' | 'cr' | 'ns'; // ok, non-critical, critical, not-specified/absent
}

export function sensors(world: World, dev: Device): Sensor[] {
  const out: Sensor[] = [];
  const running = dev.power === 'on' || dev.power === 'posting';
  out.push({ name: 'Inlet Temp', value: hasAC(world, dev) ? '23' : 'na', unit: 'degrees C', status: hasAC(world, dev) ? 'ok' : 'ns' });
  for (const cpu of [0, 1] as const) {
    const c = dev.slots[`CPU${cpu}`];
    if (!c) {
      out.push({ name: `CPU${cpu} Temp`, value: 'na', unit: 'degrees C', status: 'ns' });
      continue;
    }
    const t = cpuTemp(dev, cpu);
    out.push({ name: `CPU${cpu} Temp`, value: running ? String(t) : 'na', unit: 'degrees C', status: !running ? 'ns' : t >= 95 ? 'cr' : t >= 85 ? 'nc' : 'ok' });
  }
  const anyDimmFail = Object.entries(dev.slots).some(([k, c]) => k.startsWith('DIMM') && c?.health === 'failed');
  out.push({ name: 'DIMM Temp', value: running ? String(41 + failedFans(dev) * 4 + (dev.layers.shroud ? 0 : 12)) : 'na', unit: 'degrees C', status: running ? 'ok' : 'ns' });
  for (const s of MODELS[dev.model].slots.filter((x) => x.kind === 'fan')) {
    const f = dev.slots[s.id];
    const rpm = !hasAC(world, dev) ? 0 : !f ? 0 : f.health === 'failed' ? 0 : running ? 9800 + (failedFans(dev) > 0 ? 6200 : 0) + Number(s.id.slice(3)) * 37 : 3000;
    out.push({
      name: `${s.id.replace('FAN', 'Fan')} RPM`,
      value: f ? String(rpm) : 'na',
      unit: 'RPM',
      status: !f ? 'cr' : f.health === 'failed' && hasAC(world, dev) ? 'cr' : 'ok',
    });
  }
  for (const p of psuSlots(dev)) {
    const c = dev.slots[p];
    const inp = psuInput(world, dev, p);
    const status = !c ? 'cr' : c.health === 'failed' ? 'cr' : !inp.ok ? 'cr' : 'ok';
    out.push({ name: `${p} Status`, value: !c ? 'Absent' : c.health === 'failed' ? 'Failure detected' : !inp.ok ? 'AC lost' : 'Presence detected', unit: 'discrete', status });
    out.push({ name: `${p} Input Power`, value: c && inp.ok && c.health === 'ok' ? String(Math.round(running ? dev.powerW / Math.max(goodPsuCount(world, dev), 1) : 18)) : '0', unit: 'Watts', status: 'ok' });
  }
  const good = goodPsuCount(world, dev);
  out.push({ name: 'PS Redundancy', value: good >= 2 ? 'Fully Redundant' : good === 1 ? 'Redundancy Lost' : 'Non-redundant', unit: 'discrete', status: good >= 2 ? 'ok' : 'cr' });
  out.push({ name: 'Chassis Intru', value: dev.layers.lid ? 'Normal' : 'Intrusion', unit: 'discrete', status: dev.layers.lid ? 'ok' : 'nc' });
  const cmos = dev.slots.CMOS;
  out.push({ name: 'CMOS Battery', value: !cmos ? '0.00' : cmos.health === 'ok' ? '3.02' : '2.31', unit: 'Volts', status: !cmos || cmos.health !== 'ok' ? 'nc' : 'ok' });
  out.push({ name: 'Memory', value: anyDimmFail ? 'Uncorrectable/Correctable ECC' : 'OK', unit: 'discrete', status: anyDimmFail ? 'cr' : 'ok' });
  return out;
}

// ---------- health rollup ----------

export type Sev = 'ok' | 'warning' | 'critical' | 'unknown';
export interface HealthRollup {
  overall: Sev;
  processors: Sev;
  memory: Sev;
  storage: Sev;
  power: Sev;
  fans: Sev;
  temperature: Sev;
  network: Sev;
  gpu: Sev;
  battery: Sev;
}

function worst(...s: Sev[]): Sev {
  if (s.includes('critical')) return 'critical';
  if (s.includes('warning')) return 'warning';
  return 'ok';
}

function kindSev(dev: Device, kinds: string[]): Sev {
  let s: Sev = 'ok';
  for (const [id, c] of Object.entries(dev.slots)) {
    const def = MODELS[dev.model].slots.find((x) => x.id === id);
    if (!def || !kinds.includes(def.kind)) continue;
    if (!c) {
      if (def.kind !== 'gpu') s = worst(s, def.kind === 'fan' || def.kind === 'psu' ? 'critical' : 'warning');
      continue;
    }
    if (c.health === 'failed') s = worst(s, 'critical');
    if (c.health === 'degraded') s = worst(s, 'warning');
  }
  return s;
}

export function healthRollup(world: World, dev: Device): HealthRollup {
  if (!hasAC(world, dev) || !dev.bmc.responsive) {
    return { overall: 'unknown', processors: 'unknown', memory: 'unknown', storage: 'unknown', power: 'unknown', fans: 'unknown', temperature: 'unknown', network: 'unknown', gpu: 'unknown', battery: 'unknown' };
  }
  const power: Sev = goodPsuCount(world, dev) >= 2 ? kindSev(dev, ['psu']) : 'critical';
  const t = Math.max(cpuTemp(dev, 0), cpuTemp(dev, 1));
  const temperature: Sev = t >= 95 ? 'critical' : t >= 85 ? 'warning' : 'ok';
  const network: Sev = (['nic0p0', 'nic0p1'] as const).some((p) => dev.power === 'on' && !linkState(world, dev.id, p).up) ? 'warning' : kindSev(dev, ['nic']);
  const r: HealthRollup = {
    processors: kindSev(dev, ['cpu']),
    memory: kindSev(dev, ['dimm']),
    storage: kindSev(dev, ['hdd', 'nvme', 'm2']),
    power,
    fans: kindSev(dev, ['fan']),
    temperature,
    network,
    gpu: kindSev(dev, ['gpu']),
    battery: kindSev(dev, ['cmos']),
    overall: 'ok',
  };
  r.overall = worst(r.processors, r.memory, r.storage, r.power, r.fans, r.temperature, r.network, r.gpu, r.battery);
  return r;
}

/** Front-panel system health LED. Stays amber until SEL critical events are cleared — a real-world gotcha. */
export function healthLed(world: World, dev: Device): 'off' | 'green' | 'amber' | 'amber_blink' {
  if (!hasAC(world, dev)) return 'off';
  const h = healthRollup(world, dev);
  if (h.overall === 'critical') return 'amber_blink';
  if (h.overall === 'warning') return 'amber';
  if (dev.sel.some((e) => e.severity === 'critical' && e.dir === 'Asserted')) return 'amber';
  return 'green';
}

export function powerLed(world: World, dev: Device): 'off' | 'green' | 'amber' {
  if (!hasAC(world, dev)) return 'off';
  return dev.power === 'on' || dev.power === 'posting' ? 'green' : 'amber';
}

export type Led = 'off' | 'green' | 'green_blink' | 'amber' | 'amber_blink' | 'blue_blink';

export function slotLed(world: World, dev: Device, slot: string): Led {
  const c = dev.slots[slot];
  const ac = hasAC(world, dev);
  const def = MODELS[dev.model].slots.find((s) => s.id === slot);
  if (!def || !c) return 'off';
  if (def.kind === 'psu') {
    if (c.health === 'failed') return 'amber';
    const inp = psuInput(world, dev, slot);
    if (!inp.ok) return ac ? 'amber_blink' : 'off';
    return 'green';
  }
  if (!ac) return 'off';
  if (dev.quirks.includes(`locate:${slot}`)) return 'blue_blink';
  if (c.health === 'failed') return 'amber';
  if (c.health === 'degraded') return 'amber_blink';
  if ((def.kind === 'hdd' || def.kind === 'nvme') && dev.os === 'up') return 'green_blink';
  if (def.kind === 'hdd' || def.kind === 'nvme') return 'green';
  return 'off';
}

// ---------- network ----------

export function cableAt(world: World, deviceId: string, port: string): Cable | undefined {
  return Object.values(world.cables).find(
    (c) => (c.a?.deviceId === deviceId && c.a.port === port) || (c.b?.deviceId === deviceId && c.b.port === port),
  );
}

export function peerOf(cable: Cable, deviceId: string, port: string) {
  if (cable.a?.deviceId === deviceId && cable.a.port === port) return cable.b;
  return cable.a;
}

export interface LinkState {
  up: boolean;
  speed: string;
  reason: string;
  peer?: { deviceId: string; port: string; hostname: string };
  crcErrors: number;
}

export function linkState(world: World, deviceId: string, port: string): LinkState {
  const dev = world.devices[deviceId];
  const down = (reason: string, extra: Partial<LinkState> = {}): LinkState => ({ up: false, speed: 'Unknown!', reason, crcErrors: 0, ...extra });
  if (!dev) return down('no device');
  const cable = cableAt(world, deviceId, port);
  if (!cable) return down('No cable connected');
  const peer = peerOf(cable, deviceId, port);
  if (!peer) return down('Cable not connected at far end');
  const pd = world.devices[peer.deviceId];
  if (!pd) return down('Far end missing');
  const peerInfo = { deviceId: pd.id, port: peer.port, hostname: pd.hostname };
  // Power
  const isBmc = port === 'bmc' || peer.port === 'bmc';
  for (const d of [dev, pd]) {
    if (d.role === 'server') {
      if (isBmc) {
        if (!hasAC(world, d)) return down('No AC power (BMC off)', { peer: peerInfo });
      } else if (d.power !== 'on') return down('Host powered off', { peer: peerInfo });
    } else if (!d.quirks.includes('external_powered') && !hasAC(world, d)) return down('Switch has no power', { peer: peerInfo });
  }
  // NIC hardware
  for (const [d, p] of [
    [dev, port],
    [pd, peer.port],
  ] as const) {
    if (d.role === 'server' && p.startsWith('nic')) {
      const nic = d.slots.OCP0;
      if (!nic) return down('NIC not installed', { peer: peerInfo });
      if (nic.health === 'failed') return down('NIC hardware fault', { peer: peerInfo });
      if (!nic.seated) return down('NIC not seated', { peer: peerInfo });
    }
    if (d.quirks.includes(`admin_down:${p}`)) return down('Port administratively down', { peer: peerInfo });
  }
  if (cable.condition === 'damaged') return down('Cable damaged', { peer: peerInfo });
  if (cable.condition === 'bad_termination') return down('Bad termination', { peer: peerInfo, crcErrors: 0 });
  const speed = isBmc ? '1000Mb/s' : cable.type === 'cat6' ? '1000Mb/s' : peer.port.startsWith('swp') && Number(peer.port.slice(3)) > 48 ? '100000Mb/s' : '25000Mb/s';
  return { up: true, speed, reason: 'Link up', peer: peerInfo, crcErrors: cable.condition === 'dirty' ? 48211 : 0 };
}

// ---------- inventory helpers ----------

export function installedOfKind(dev: Device, kind: Component['kind']): Array<[string, Component]> {
  return MODELS[dev.model].slots
    .filter((s) => s.kind === kind && dev.slots[s.id])
    .map((s) => [s.id, dev.slots[s.id]!] as [string, Component]);
}

/** Memory visible to the OS in GB (failed/unseated DIMMs are mapped out by BIOS). */
export function visibleMemoryGB(dev: Device): number {
  return installedOfKind(dev, 'dimm')
    .filter(([, c]) => c.seated && c.health !== 'failed')
    .reduce((s, [, c]) => s + (c.partNumber.includes('32G') ? 32 : 64), 0);
}

export function memorySpeed(dev: Device): number {
  const dimms = installedOfKind(dev, 'dimm');
  return dimms.some(([, c]) => c.partNumber.includes('4800')) ? 4800 : 5600;
}

export function expectedMemoryGB(dev: Device): number {
  return MODELS[dev.model].slots.filter((s) => s.kind === 'dimm').length * 64;
}

export function edacName(slot: string): string {
  const m = /^DIMM_([AB])(\d)$/.exec(slot);
  if (!m) return slot;
  const cpu = m[1] === 'A' ? 0 : 1;
  const n = Number(m[2]) - 1;
  return `CPU_SrcID#${cpu}_MC#${Math.floor(n / 4)}_Chan#${n % 4}_DIMM#0`;
}

export function locationOf(world: World, dev: Device): string {
  if (!dev.rackId) return 'Not racked';
  const r: Rack = world.racks[dev.rackId];
  return `${r.location}-U${String(dev.u).padStart(2, '0')}`;
}

export function isExactPartMatch(oldPn: string, newPn: string): boolean {
  return oldPn === newPn;
}

export function fitsSlot(dev: Device, slot: string, pn: string): { ok: boolean; why?: string } {
  const def = MODELS[dev.model].slots.find((s) => s.id === slot);
  if (!def) return { ok: false, why: 'No such slot' };
  const spec = partSpec(pn);
  if (spec.kind !== def.kind) return { ok: false, why: `A ${spec.kind.toUpperCase()} does not go in a ${def.kind.toUpperCase()} slot.` };
  const ff = MODELS[dev.model].slotFormFactor[def.kind];
  if (ff && spec.formFactor !== ff) return { ok: false, why: spec.gotcha ?? `Form factor ${spec.formFactor} does not fit ${ff}.` };
  return { ok: true };
}
