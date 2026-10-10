// The ActionBus reducer. Every trainee interaction becomes an Action applied here,
// so rules, penalties, flags and the action log stay in one place.
import { fastenersOf, MODELS, partSpec } from './catalog';
import { fkey, heldBy, isTight, looseAfterInsert } from './fasteners';
import { addCable } from './factory';
import { fitsSlot, hasAC, linkState, locationOf, psuGood, psuSlots, rackWeightKg } from './projectors';
import { addSel, advance, bootFromOrder, expectedPn, flag, hasFlag, log, modelSlot, penalize, powerOff, powerOn, recomputePower, schedule, ticketForDevice, ticketForLocation, toast } from './sim';
import type { BinKind, CableType, Component, Device, PortRef, TicketStatus, World } from './types';

export type Layer = 'lid' | 'shroud' | 'riser1' | 'riser2';
export type Side = 'front' | 'rear';

export type Action =
  | { type: 'walk'; to: string; side?: Side }
  /** Free-roam walking in 3D: you arrived somewhere on foot (no extra time cost). */
  | { type: 'arrive'; to: string; side: Side }
  | { type: 'fastener'; deviceId: string; target: string; id: string; secure: boolean }
  | { type: 'esd'; on: boolean }
  | { type: 'liftAssist'; on: boolean }
  | { type: 'scanAsset'; deviceId: string }
  | { type: 'servicePosition'; deviceId: string; out: boolean }
  | { type: 'layer'; deviceId: string; layer: Layer; install: boolean }
  | { type: 'heatsink'; deviceId: string; cpu: string; install: boolean; order?: number[] }
  | { type: 'latch'; deviceId: string; slot: string; state: 'open' | 'closed' }
  | { type: 'removePart'; deviceId: string; slot: string }
  | { type: 'insertPart'; deviceId: string; slot: string; source: { spareIndex: number } | { trayUid: string }; aligned?: boolean }
  | { type: 'powerButton'; deviceId: string; hold?: boolean }
  | { type: 'cord'; deviceId: string; psu: string; outlet: string | null }
  | { type: 'reseatCord'; deviceId: string; psu: string }
  | { type: 'bag'; uid: string }
  | { type: 'tag'; uid: string }
  | { type: 'bin'; uid: string; bin: BinKind }
  | { type: 'flagFaulty'; deviceId: string; slot: string }
  | { type: 'unflag'; deviceId: string; slot: string }
  | { type: 'connectCable'; cableType: CableType; lengthM: number; a: PortRef; b: PortRef; condition?: 'ok' | 'bad_termination' }
  | { type: 'disconnectCable'; cableId: string; end?: 'a' | 'b' }
  | { type: 'reconnectCable'; cableId: string; end: 'a' | 'b'; port: PortRef }
  | { type: 'labelCable'; cableId: string; labelA: string; labelB: string }
  | { type: 'cleanCable'; cableId: string }
  | { type: 'replaceCable'; cableId: string }
  | { type: 'installRails'; rackId: string; u: number; heightU: number; holeOffset: number }
  | { type: 'removeRails'; rackId: string; u: number }
  | { type: 'mountDevice'; deviceId: string; rackId: string; u: number }
  | { type: 'unmountDevice'; deviceId: string }
  | { type: 'pduBreaker'; rackId: string; side: 'A' | 'B'; on: boolean }
  // remote
  | { type: 'bmcPower'; deviceId: string; op: 'on' | 'off' | 'soft' | 'cycle' | 'reset' }
  | { type: 'selClear'; deviceId: string }
  | { type: 'bmcReset'; deviceId: string; inband?: boolean }
  | { type: 'locate'; deviceId: string; on: boolean }
  | { type: 'driveLocate'; deviceId: string; slot: string; on: boolean }
  | { type: 'setBootOrder'; deviceId: string; order: string[] }
  | { type: 'setPortAdmin'; deviceId: string; port: string; up: boolean }
  | { type: 'biosKey'; deviceId: string }
  | { type: 'biosExit'; deviceId: string; save: boolean; bootOrder?: string[]; fixClock?: boolean }
  | { type: 'osReboot'; deviceId: string }
  | { type: 'osShutdown'; deviceId: string }
  // process
  | { type: 'ticketTransition'; key: string; to: TicketStatus }
  | { type: 'ticketAssign'; key: string; who: string }
  | { type: 'ticketWorklog'; key: string; text: string; kind?: 'comment' | 'worklog' }
  | { type: 'requestDrain'; key: string }
  | { type: 'requestPart'; key: string; pn: string }
  | { type: 'createRma'; key: string; serial: string }
  | { type: 'escalate'; key: string; team: string; reason: string }
  | { type: 'notes'; text: string }
  // generic
  | { type: 'setFlag'; name: string }
  | { type: 'penalty'; rule: string; points: number; reason: string; safety?: boolean; key?: string }
  | { type: 'wait'; seconds: number };

const DUR: Partial<Record<Action['type'], number>> = {
  esd: 5,
  fastener: 4,
  scanAsset: 5,
  servicePosition: 15,
  layer: 10,
  heatsink: 60,
  latch: 3,
  removePart: 10,
  insertPart: 15,
  cord: 5,
  reseatCord: 5,
  bag: 5,
  tag: 5,
  bin: 10,
  connectCable: 20,
  disconnectCable: 5,
  labelCable: 30,
  cleanCable: 15,
  replaceCable: 60,
  installRails: 180,
  removeRails: 60,
  mountDevice: 120,
  unmountDevice: 90,
  ticketWorklog: 30,
};

export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  Open: ['In Progress', 'Escalated'],
  'In Progress': ['Waiting for Part', 'Waiting for Customer', 'Escalated', 'Resolved'],
  'Waiting for Part': ['In Progress'],
  'Waiting for Customer': ['In Progress', 'Resolved'],
  Escalated: ['In Progress'],
  Resolved: ['Closed', 'In Progress'],
  Closed: [],
};

export interface ActionResult {
  ok: boolean;
  message: string;
}

function err(message: string): ActionResult {
  return { ok: false, message };
}
function ok(message: string): ActionResult {
  return { ok: true, message };
}

// ---------- rule helpers ----------

function atDevice(w: World, dev: Device): string | null {
  if (!dev.rackId) return null; // on the bench / staging
  if (w.trainee.location !== dev.rackId) return `You're not at rack ${dev.rackId}. Walk there first (location ${locationOf(w, dev)}).`;
  return null;
}

const AISLE = { front: 'cold aisle (front)', rear: 'hot aisle (rear)' } as const;

function needSide(w: World, dev: Device, side: Side, what = 'That'): string | null {
  if (!dev.rackId || w.trainee.side === side) return null;
  return side === 'rear'
    ? `You're in the cold aisle at the front of ${dev.rackId}. ${what} is on the back of the server: walk around to the hot aisle (rear) first.`
    : `You're in the hot aisle behind ${dev.rackId}. ${what} is on the front of the server: walk around to the cold aisle (front) first.`;
}

/** Front of the chassis: bays, power button, rack ears, and everything inside once it's slid out. */
function frontReach(w: World, dev: Device, what?: string): string | null {
  return atDevice(w, dev) ?? needSide(w, dev, 'front', what);
}

/** Back of the chassis: PSUs, cords, NIC, cables. Unreachable while the server is slid out the front. */
function rearReach(w: World, dev: Device, what?: string): string | null {
  const r = atDevice(w, dev) ?? needSide(w, dev, 'rear', what);
  if (r) return r;
  if (dev.rackId && dev.servicePosition)
    return `${dev.hostname} is slid out to the service position, so its back end is now buried mid-rack behind the cable-management arm. Slide it back into the rack before working on the rear.`;
  return null;
}

/** Turn one heatsink screw; checks the cross pattern once all four have been turned the same way. */
function turnScrew(w: World, dev: Device, cpu: string, n: number, tighten: boolean) {
  const target = `heatsink:${cpu}`;
  if (isTight(dev, target, `s${n}`) === tighten) return;
  dev.fasteners[fkey(target, `s${n}`)] = tighten;
  const key = `${target}:${tighten ? 'tighten' : 'loosen'}`;
  dev.torque[`${target}:${tighten ? 'loosen' : 'tighten'}`] = [];
  const seq = (dev.torque[key] = [...(dev.torque[key] ?? []), n]);
  if ([1, 2, 3, 4].every((m) => isTight(dev, target, `s${m}`) === tighten)) {
    const expected = tighten ? [1, 2, 3, 4] : [4, 3, 2, 1];
    if (seq.join() !== expected.join())
      penalize(w, 'torque_sequence', 3, `Wrong screw sequence on the ${cpu} heatsink (${seq.join('→')}, should be ${expected.join('→')})`, { key: `${dev.id}:${cpu}:${tighten}` });
    if (tighten) flag(w, `heatsink_on:${dev.id}:${cpu}`);
    dev.torque[key] = [];
  }
}

/** Hazard level if you touch non-hot-swap internals right now. */
function powerHazard(w: World, dev: Device): 'running' | 'standby' | 'flea' | 'safe' {
  if (dev.power === 'on' || dev.power === 'posting') return 'running';
  if (hasAC(w, dev) || dev.power === 'standby') return 'standby';
  if (Object.values(dev.powerCords).some(Boolean)) return 'standby';
  const unplugged = w.flags[`unplugged:${dev.id}`]?.last ?? -Infinity;
  const drained = w.flags[`flea_drained:${dev.id}`]?.last ?? -Infinity;
  if (drained < unplugged) return 'flea';
  return 'safe';
}

function processChecks(w: World, dev: Device) {
  if (dev.role !== 'server') return;
  const tk = ticketForDevice(w, dev.id);
  if (tk && tk.status !== 'In Progress') {
    penalize(w, 'no_in_progress', 5, `Touched ${dev.hostname} without its ticket ${tk.key} set to In Progress`, { key: dev.id });
  }
  if (!hasFlag(w, `scanned:${dev.id}`)) {
    penalize(w, 'no_asset_scan', 3, `Started work on ${dev.hostname} without scanning/verifying its asset tag`, { key: dev.id });
  }
  const locTk = ticketForLocation(w, dev.id);
  if (!tk && locTk && locTk.serial && locTk.serial !== dev.serial) {
    penalize(w, 'wrong_host', 30, `Worked on the WRONG machine: ${locTk.key} is for serial ${locTk.serial}, this one is ${dev.serial}`, { key: dev.id });
  }
  if (tk && tk.serial && tk.serial !== dev.serial) {
    penalize(w, 'wrong_host', 30, `Worked on the WRONG machine: ticket says serial ${tk.serial}, this one is ${dev.serial}`, { key: dev.id });
  }
  flag(w, `physical_work:${dev.id}`);
}

function internalTouch(w: World, dev: Device, what: string): ActionResult | null {
  const hz = powerHazard(w, dev);
  if (!w.trainee.esdStrap) penalize(w, 'no_esd', 5, `Handled ${what} without an ESD wrist strap`, { safety: true, key: dev.id });
  if (hz === 'running') {
    penalize(w, 'hot_cold_part', 25, `Pulled/inserted ${what} on a RUNNING system — not hot-swappable`, { safety: true, key: `${dev.id}:${what}` });
    return null;
  }
  if (hz === 'standby') {
    penalize(w, 'standby_power', 10, `Standby power still present while handling ${what}. Unplug BOTH power cords first`, { safety: true, key: dev.id });
  } else if (hz === 'flea') {
    penalize(w, 'flea_power', 2, 'Did not drain residual power (press and hold the power button with cords removed)', { key: dev.id });
  }
  return null;
}

function slotReachable(w: World, dev: Device, slot: string): string | null {
  const def = modelSlot(dev, slot);
  if (!def) return `No slot ${slot}.`;
  if (def.access === 'rear') return rearReach(w, dev, `${def.label}`);
  const at = frontReach(w, dev, def.access === 'front' ? def.label : 'The inside of the chassis');
  if (at) return at;
  if (def.access === 'internal') {
    if (dev.rackId && !dev.servicePosition) return 'Slide the server out to the service position on its rails first.';
    if (dev.layers.lid) return 'Remove the top cover (lid) first.';
    for (const r of def.requires ?? []) {
      if (r === 'heatsink') {
        if (dev.heatsinks[slot]) return `Remove the heatsink from ${slot} first.`;
      } else if (r !== 'lid' && dev.layers[r]) return `Remove the ${r === 'shroud' ? 'air shroud' : r.replace('riser', 'Riser ')} first.`;
    }
  }
  return null;
}

function bayInUse(w: World, dev: Device, slot: string, c: Component): boolean {
  // A healthy drive in a running host is in service — pulling it causes data/IO impact.
  return dev.os === 'up' && c.health === 'ok' && (c.kind === 'hdd' || c.kind === 'nvme') && !w.trainee.flagged.includes(`${dev.id}:${slot}`);
}

// ---------- reducer ----------

export function applyAction(w: World, a: Action): ActionResult {
  const r = reduce(w, a);
  const dur = r.ok ? (DUR[a.type] ?? 0) : 0;
  if (dur) advance(w, dur);
  if (a.type !== 'notes' && a.type !== 'setFlag' && !(a.type === 'arrive' && !r.message)) log(w, a.type, r.message, r.ok);
  if (!r.ok && a.type !== 'setFlag') toast(w, 'error', r.message);
  return r;
}

function reduce(w: World, a: Action): ActionResult {
  switch (a.type) {
    case 'walk': {
      const rackTo = w.racks[a.to];
      const side: Side = a.side ?? (rackTo && w.trainee.location !== a.to ? 'front' : w.trainee.side);
      if (w.trainee.location === a.to && side === w.trainee.side) return ok('Already here.');
      if (w.trainee.location === a.to && rackTo) {
        // Same rack, other aisle: walk around the end of the row.
        const row = Object.values(w.racks).filter((r) => r.row === rackTo.row).map((r) => r.position);
        const steps = Math.min(rackTo.position - Math.min(...row), Math.max(...row) - rackTo.position) + 2;
        const secs = 10 + steps * 5;
        advance(w, secs);
        w.trainee.side = side;
        flag(w, `side:${a.to}:${side}`);
        return ok(`Walked around the end of row ${rackTo.row} to the ${AISLE[side]} of ${rackTo.location} (${secs}s).`);
      }
      w.trainee.side = side;
      const from = w.trainee.location;
      const fr = from ? w.racks[from] : undefined;
      const to = w.racks[a.to];
      let secs = 60;
      if (fr && to) secs = 20 + Math.abs(fr.position - to.position) * 4 + (fr.row === to.row ? 0 : 30);
      if (a.to === 'cage' || from === 'cage') secs = 120;
      advance(w, secs);
      w.trainee.location = a.to;
      flag(w, `at:${a.to}`);
      if (a.to === 'cage') {
        const picked = w.spares.filter((sp) => sp.location === 'cage');
        for (const sp of picked) sp.location = 'cart';
        if (picked.length) {
          flag(w, 'picked_up_part');
          toast(w, 'success', `Scanned out ${picked.length} part(s) from the cage onto your cart.`);
        }
      }
      if (to) flag(w, `side:${a.to}:${side}`);
      return ok(`Walked to ${to ? `${to.location}, ${AISLE[side]}` : a.to === 'noc' ? 'the DCO desk' : a.to === 'cage' ? 'the parts cage' : a.to} (${secs}s).`);
    }
    case 'arrive': {
      w.trainee.location = a.to;
      w.trainee.side = a.side;
      if (w.racks[a.to]) {
        flag(w, `at:${a.to}`);
        flag(w, `side:${a.to}:${a.side}`);
        return ok(`Arrived at ${w.racks[a.to].location}, ${AISLE[a.side]}.`);
      }
      return ok('');
    }
    case 'fastener': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const fd = fastenersOf(dev.model, a.target).find((f) => f.id === a.id);
      if (!fd) return err('Nothing to undo there.');
      let reach: string | null = null;
      if (a.target.startsWith('heatsink:')) {
        const cpu = a.target.split(':')[1];
        reach = frontReach(w, dev);
        if (!reach && dev.rackId && !dev.servicePosition) reach = 'Slide the server out to the service position first.';
        if (!reach && (dev.layers.lid || dev.layers.shroud)) reach = 'Remove the lid and the air shroud first.';
        if (!reach && !dev.heatsinks[cpu]) reach = `There is no heatsink seated on ${cpu}.`;
        if (reach) return err(reach);
        processChecks(w, dev);
        const n = Number(a.id.slice(1));
        if (isTight(dev, a.target, a.id) === a.secure) return ok(`Screw ${n} is already ${a.secure ? 'torqued' : 'loose'}.`);
        turnScrew(w, dev, cpu, n, a.secure);
        advance(w, 6);
        const seq = dev.torque[`${a.target}:${a.secure ? 'tighten' : 'loosen'}`] ?? [];
        return ok(`${a.secure ? fd.secure : fd.release}${seq.length ? ` (sequence so far: ${seq.join(' → ')})` : ''}.`);
      }
      if (a.target === 'chassis') {
        reach = dev.rackId ? frontReach(w, dev, 'The rack-ear latch') : 'The server is not in a rack.';
      } else if (a.target === 'lid' || a.target === 'riser1' || a.target === 'riser2') {
        reach = frontReach(w, dev);
        if (!reach && dev.rackId && !dev.servicePosition) reach = 'Slide the server out to the service position first. The cover only clears the rack once it is extended.';
        if (!reach && a.target !== 'lid' && dev.layers.lid) reach = 'Remove the lid first.';
        if (!reach && !dev.layers[a.target]) reach = `The ${a.target === 'lid' ? 'lid' : a.target.replace('riser', 'Riser ')} is not installed.`;
      } else {
        reach = slotReachable(w, dev, a.target);
        if (!reach && !dev.slots[a.target] && a.id !== 'frame') reach = `Nothing is installed in ${a.target}.`;
      }
      if (reach) return err(reach);
      if (isTight(dev, a.target, a.id) === a.secure) return ok(`The ${fd.label.toLowerCase()} is already ${a.secure ? 'secured' : 'released'}.`);
      if (!a.secure) processChecks(w, dev);
      dev.fasteners[fkey(a.target, a.id)] = a.secure;
      if (fd.kind === 'screw') advance(w, 6);
      flag(w, `fastener:${dev.id}:${a.target}:${a.id}:${a.secure ? 'tight' : 'loose'}`);
      return ok(`${a.secure ? fd.secure : fd.release}.${fd.tool ? ` (${fd.tool})` : ''}`);
    }
    case 'esd':
      w.trainee.esdStrap = a.on;
      if (a.on) flag(w, 'esd_on');
      return ok(a.on ? 'ESD wrist strap on and clipped to bare chassis metal.' : 'ESD strap removed.');
    case 'liftAssist':
      w.trainee.liftAssist = a.on;
      return ok(a.on ? 'Lift assist / second tech ready.' : 'Working alone.');
    case 'scanAsset': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = atDevice(w, dev);
      if (at) return err(at);
      flag(w, `scanned:${dev.id}`);
      const tk = ticketForDevice(w, dev.id) ?? ticketForLocation(w, dev.id);
      if (tk?.serial && tk.serial !== dev.serial) {
        flag(w, `mismatch_found:${dev.id}`);
        toast(w, 'warn', `📷 Beep. ⚠ ${dev.assetTag} / S/N ${dev.serial} does NOT match ${tk.key} (expects ${tk.serial}).`);
        return ok(`⚠ MISMATCH: asset ${dev.assetTag}, serial ${dev.serial} — ticket ${tk.key} expects serial ${tk.serial}. Stop and verify!`);
      }
      toast(w, 'success', `📷 Beep. ${dev.assetTag} · S/N ${dev.serial} · ${dev.hostname}${tk ? ` ✓ matches ${tk.key}` : ''}`);
      return ok(`Scanned ${dev.assetTag} — serial ${dev.serial}, ${dev.hostname}. ${tk ? `Matches ${tk.key}.` : ''}`);
    }
    case 'servicePosition': {
      const dev = w.devices[a.deviceId];
      if (!dev?.rackId) return err('Device is not racked.');
      const at = frontReach(w, dev, 'The slide rails release');
      if (at) return err(at);
      if (a.out === dev.servicePosition) return ok(a.out ? 'Already in the service position.' : 'Already in the rack.');
      if (!a.out && !dev.layers.lid) return err('Install the lid before sliding the server back in.');
      if (!a.out && !isTight(dev, 'lid', 'latch')) return err('Press the cover latch flat first. A raised latch catches on the server above.');
      if (a.out && Object.values(w.devices).some((d) => d.id !== dev.id && d.rackId === dev.rackId && d.servicePosition))
        return err('Another server in this rack is already extended. Only extend one at a time (rack tip hazard).');
      const ear = a.out ? heldBy(dev, 'chassis') : undefined;
      if (ear) return err(`The chassis is still locked into the rack by its ${ear.label.toLowerCase()}. ${ear.release} (both sides) first.`);
      processChecks(w, dev);
      dev.servicePosition = a.out;
      if (!a.out) looseAfterInsert(dev, 'chassis');
      return ok(a.out ? 'Released the rail locks and slid the server out to the service position.' : 'Slid the server back into the rack until the rail latches clicked.');
    }
    case 'layer': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = frontReach(w, dev);
      if (at) return err(at);
      if (dev.rackId && !dev.servicePosition) return err('Slide the server out to the service position first.');
      if (a.layer !== 'lid' && dev.layers.lid) return err('Remove the lid first.');
      if (a.install === dev.layers[a.layer]) return ok(`The ${a.layer === 'shroud' ? 'air shroud' : a.layer} is already ${a.install ? 'installed' : 'out'}.`);
      if (a.install) {
        if (a.layer === 'shroud' && Object.entries(dev.heatsinks).some(([cpu, on]) => !on && dev.slots[cpu])) toast(w, 'warn', 'A CPU has no heatsink under that shroud!');
        if (a.layer === 'lid' && (!dev.layers.shroud || !dev.layers.riser1 || !dev.layers.riser2) && !hasFlag(w, `warned_lid:${dev.id}`)) {
          flag(w, `warned_lid:${dev.id}`);
          // allowed but probably a mistake
        }
        dev.layers[a.layer] = true;
        looseAfterInsert(dev, a.layer);
        const loose = fastenersOf(dev.model, a.layer);
        if (loose.length) toast(w, 'info', `Now secure it: ${loose.map((f) => f.label.toLowerCase()).join(' and ')}.`);
        if (a.layer === 'lid') {
          addSel(w, dev, 'Physical Security', 'General Chassis Intrusion', 'info', 'Deasserted');
        }
        return ok(`Installed the ${a.layer === 'shroud' ? 'air shroud' : a.layer}.`);
      }
      const held = heldBy(dev, a.layer);
      if (held) return err(`The ${a.layer === 'lid' ? 'lid' : a.layer.replace('riser', 'Riser ')} is still held by its ${held.label.toLowerCase()}. ${held.release} first.`);
      processChecks(w, dev);
      if (a.layer === 'lid') {
        if (dev.power === 'on') toast(w, 'warn', 'Lid off on a running server — airflow is compromised. Work fast (hot-swap fans only).');
        addSel(w, dev, 'Physical Security', 'General Chassis Intrusion', 'warning');
      } else if (a.layer === 'shroud') {
        if (dev.power === 'on') penalize(w, 'shroud_running', 5, 'Removed the air shroud on a running system', { key: dev.id });
      } else {
        internalTouch(w, dev, a.layer === 'riser1' ? 'Riser 1' : 'Riser 2');
      }
      dev.layers[a.layer] = false;
      return ok(`Removed the ${a.layer === 'shroud' ? 'air shroud' : a.layer}.`);
    }
    case 'heatsink': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = frontReach(w, dev);
      if (at) return err(at);
      if (dev.rackId && !dev.servicePosition) return err('Slide the server out to the service position first.');
      if (dev.layers.lid || dev.layers.shroud) return err('Remove the lid and air shroud first.');
      processChecks(w, dev);
      const target = `heatsink:${a.cpu}`;
      if (!a.install) {
        if (!dev.heatsinks[a.cpu]) return err(`There is no heatsink on ${a.cpu}.`);
        if (a.order) for (const n of a.order) turnScrew(w, dev, a.cpu, n, false);
        const tight = [1, 2, 3, 4].filter((n) => isTight(dev, target, `s${n}`));
        if (tight.length) return err(`Heatsink screw${tight.length > 1 ? 's' : ''} ${tight.join(', ')} still tight. Loosen all four in the order 4 → 3 → 2 → 1 before lifting.`);
        internalTouch(w, dev, `${a.cpu} heatsink`);
        dev.heatsinks[a.cpu] = false;
        return ok(`Lifted the heatsink off ${a.cpu}, twisting gently to break the thermal-paste seal. Wipe the old paste off both surfaces with IPA.`);
      }
      if (dev.heatsinks[a.cpu]) return err('That heatsink is already seated.');
      if (!dev.slots[a.cpu]) return err(`Install the CPU in ${a.cpu} before the heatsink.`);
      if (!isTight(dev, a.cpu, 'frame')) return err('Close the socket load frame and hook its lever before seating the heatsink.');
      internalTouch(w, dev, `${a.cpu} heatsink`);
      dev.heatsinks[a.cpu] = true;
      looseAfterInsert(dev, target);
      dev.torque[`${target}:tighten`] = [];
      if (a.order) for (const n of a.order) turnScrew(w, dev, a.cpu, n, true);
      return ok(
        a.order
          ? `Heatsink seated on ${a.cpu}; screws torqued in sequence ${a.order.join('-')}.`
          : `Applied fresh thermal paste and set the heatsink on ${a.cpu} with its screws loose. Now torque the screws in the order 1 → 2 → 3 → 4.`,
      );
    }
    case 'latch': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const reach = slotReachable(w, dev, a.slot);
      if (reach) return err(reach);
      const c = dev.slots[a.slot];
      const def = modelSlot(dev, a.slot)!;
      dev.latches[a.slot] = a.state;
      if (a.state === 'open') {
        processChecks(w, dev);
        if (c && (def.kind === 'hdd' || def.kind === 'nvme')) {
          // Releasing the carrier handle unseats the drive from the backplane
          if (bayInUse(w, dev, a.slot, c)) penalize(w, 'pulled_healthy_drive', 15, `Unseated a HEALTHY in-service drive in ${a.slot}`, { key: `${dev.id}:${a.slot}` });
          c.seated = false;
          flag(w, `unlatched:${dev.id}:${a.slot}`);
          addSel(w, dev, `Drive Slot ${a.slot}`, 'Drive Present', 'warning', 'Deasserted');
          return ok(`Released the carrier handle on ${a.slot}. ${def.kind === 'hdd' ? 'The drive is spinning down — wait ~15–30 s before pulling it out.' : ''}`);
        }
        if (def.kind === 'dimm') {
          internalTouch(w, dev, `DIMM ${a.slot}`);
          if (c) c.seated = false;
          return ok(`Opened the retention latches on ${a.slot}. The DIMM pops up slightly.`);
        }
        return ok(`Released latch on ${a.slot}.`);
      }
      if (c) {
        c.seated = true;
        if (def.kind === 'dimm') flag(w, `seated:${dev.id}:${a.slot}`);
        if ((def.kind === 'hdd' || def.kind === 'nvme') && hasAC(w, dev)) addSel(w, dev, `Drive Slot ${a.slot}`, 'Drive Present', 'info');
      }
      return ok(c ? `Closed the latch — ${a.slot} is fully seated (you heard the click).` : `Closed latch on empty ${a.slot}.`);
    }
    case 'removePart': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const reach = slotReachable(w, dev, a.slot);
      if (reach) return err(reach);
      const c = dev.slots[a.slot];
      if (!c) return err(`${a.slot} is empty.`);
      const def = modelSlot(dev, a.slot)!;
      processChecks(w, dev);
      const held = heldBy(dev, a.slot);
      if (held) return err(`${def.label} is still held in by its ${held.label.toLowerCase()}. ${held.release} first.`);
      if (def.kind === 'dimm' && dev.latches[a.slot] !== 'open') return err('Open the DIMM latches at both ends first.');
      if ((def.kind === 'hdd' || def.kind === 'nvme') && dev.latches[a.slot] !== 'open') return err('Release the drive carrier handle first.');
      if (def.kind === 'psu') {
        if (dev.powerCords[a.slot]) penalize(w, 'psu_cord_attached', 2, 'Pulled a PSU with its power cord still attached — unplug the cord first', { key: `${dev.id}:${a.slot}` });
        const otherGood = psuSlots(dev).filter((s) => s !== a.slot).some((s) => psuGood(w, dev, s));
        if (!otherGood && (dev.power === 'on' || dev.power === 'posting')) {
          toast(w, 'error', 'That was the only working PSU!');
        }
      }
      if (def.kind === 'hdd') {
        const since = w.flags[`unlatched:${dev.id}:${a.slot}`]?.last ?? w.t;
        if (w.t - since < 15) penalize(w, 'hdd_spin', 3, 'Yanked a spinning HDD — wait for it to spin down after releasing the handle', { key: `${dev.id}:${a.slot}` });
      }
      if (!def.hotSwap) internalTouch(w, dev, `${def.label}`);
      if (def.kind === 'fan' && dev.power === 'on') toast(w, 'info', 'Fan removed from a running system — remaining fans ramped to 100%. Replace within 60 s.');
      if (c.health === 'ok' && !w.trainee.flagged.includes(`${dev.id}:${a.slot}`) && def.kind !== 'heatsink') {
        flag(w, `removed_healthy:${dev.id}:${a.slot}`);
      }
      dev.slots[a.slot] = null;
      c.seated = false;
      w.trainee.tray.push({ ...c, fromSlot: a.slot, fromDevice: dev.id });
      flag(w, `removed:${dev.id}:${a.slot}`);
      if (def.kind === 'dimm' || def.kind === 'cpu') dev.quirks = [...new Set([...dev.quirks, 'mem_retrain'])];
      if (def.kind === 'cmos' && !hasAC(w, dev)) dev.quirks = [...new Set([...dev.quirks, 'bios_defaults'])];
      if (hasAC(w, dev)) addSel(w, dev, def.kind === 'psu' ? `Power Supply ${a.slot}` : def.kind === 'fan' ? `Fan ${a.slot}` : `${def.label}`, 'Presence detected', def.kind === 'psu' ? 'critical' : 'warning', 'Deasserted');
      if (def.kind === 'psu') recomputePower(w, dev, `${a.slot} removed`);
      return ok(`Removed ${partSpec(c.partNumber).desc} (S/N ${c.serial}) from ${a.slot}. It's in your hands/tray.`);
    }
    case 'insertPart': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const reach = slotReachable(w, dev, a.slot);
      if (reach) return err(reach);
      if (dev.slots[a.slot]) return err(`${a.slot} is occupied — remove the old part first.`);
      const def = modelSlot(dev, a.slot)!;
      let part: Component | undefined;
      let fromSpare = -1;
      if ('spareIndex' in a.source) {
        part = w.spares[a.source.spareIndex]?.component;
        fromSpare = a.source.spareIndex;
      } else {
        const uid = a.source.trayUid;
        part = w.trainee.tray.find((p) => p.uid === uid);
      }
      if (!part) return err('No such part.');
      if (fromSpare >= 0 && w.spares[fromSpare].location === 'cage') return err('That part is still in the parts cage. Walk to the cage and scan it out first.');
      const fit = fitsSlot(dev, a.slot, part.partNumber);
      if (!fit.ok) {
        if (partSpec(part.partNumber).kind === def.kind) penalize(w, 'wrong_form_factor', 2, `Tried to force a part that doesn't fit: ${fit.why}`, { key: part.partNumber });
        return err(`Won't fit: ${fit.why}`);
      }
      const shut = fastenersOf(dev.model, a.slot).find((f) => !f.spring && f.gatesRemoval !== false && dev.fasteners[fkey(a.slot, f.id)] === true);
      if (shut) return err(`The ${shut.label.toLowerCase()} is closed over the empty slot. Open it first.`);
      if (def.kind === 'dimm' && a.aligned === false) return err('The DIMM notch is not lined up with the key in the slot. Rotate it 180° — never force it.');
      if (def.kind === 'cpu' && a.aligned === false) {
        penalize(w, 'bent_pins', 30, 'CPU dropped in misaligned — pin-1 triangle not matched. Socket pins bent; motherboard is now damaged', { safety: false, key: dev.id });
        dev.quirks.push('socket_damaged');
      }
      processChecks(w, dev);
      if (!def.hotSwap) internalTouch(w, dev, def.label);
      const installed: Component = { ...part, seated: def.kind === 'dimm' || def.kind === 'hdd' || def.kind === 'nvme' ? false : true };
      delete installed.fromSlot;
      delete installed.fromDevice;
      dev.slots[a.slot] = installed;
      looseAfterInsert(dev, a.slot);
      if (fromSpare >= 0) w.spares.splice(fromSpare, 1);
      else w.trainee.tray = w.trainee.tray.filter((p) => p.uid !== part!.uid);
      if (def.kind === 'dimm' || def.kind === 'hdd' || def.kind === 'nvme') dev.latches[a.slot] = 'open';
      const exp = expectedPn(dev, a.slot);
      if (exp && part.partNumber !== exp) {
        flag(w, `wrong_pn:${dev.id}:${a.slot}`);
      } else flag(w, `right_pn:${dev.id}:${a.slot}`);
      flag(w, `inserted:${dev.id}:${a.slot}`);
      if (installed.health === 'ok') flag(w, `replaced_ok:${dev.id}:${a.slot}`);
      if (def.kind === 'dimm' || def.kind === 'cpu') dev.quirks = [...new Set([...dev.quirks, 'mem_retrain'])];
      if (def.kind === 'psu') {
        recomputePower(w, dev, 'PSU inserted');
        if (hasAC(w, dev)) addSel(w, dev, `Power Supply ${a.slot}`, 'Presence detected', 'info');
      }
      if (def.kind === 'fan' && hasAC(w, dev)) addSel(w, dev, `Fan ${a.slot}`, 'Fan redundancy regained', 'info');
      const toSecure = fastenersOf(dev.model, a.slot).filter((f) => !f.spring && f.gatesRemoval !== false);
      const latchNote =
        def.kind === 'dimm'
          ? ' Now press down firmly until both latches snap closed.'
          : def.kind === 'hdd' || def.kind === 'nvme'
            ? ' Push it home and close the carrier handle.'
            : def.kind === 'psu'
              ? ' It clicked home: the release tab re-engaged.'
              : toSecure.length
                ? ` Now secure it: ${toSecure.map((f) => f.label.toLowerCase()).join(', ')}.`
                : '';
      return ok(`Inserted ${partSpec(part.partNumber).desc} (S/N ${part.serial}) into ${a.slot}.${latchNote}`);
    }
    case 'powerButton': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = frontReach(w, dev, 'The power button');
      if (at) return err(at);
      if (!hasAC(w, dev)) {
        flag(w, `flea_drained:${dev.id}`);
        return ok('No AC present. Holding the power button for 15 s drains residual (flea) power from the board.');
      }
      if (dev.power === 'standby') return ok(powerOn(w, dev, 'front panel button'));
      return ok(powerOff(w, dev, a.hold ? 'hard' : 'soft', a.hold ? 'power button held' : 'power button press'));
    }
    case 'cord': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = rearReach(w, dev, 'The power inlet');
      if (at) return err(at);
      if (!a.outlet && dev.powerCords[a.psu] && dev.slots[a.psu] && isTight(dev, a.psu, 'bail'))
        return err(`The ${a.psu} cord is locked in by its retention bail. Flip the bail off the plug first.`);
      if (a.outlet) {
        if (Object.values(w.devices).some((d) => Object.values(d.powerCords).includes(a.outlet!)))
          return err(`Outlet ${a.outlet} already has a cord plugged in.`);
        if (dev.slots[a.psu]?.partNumber.includes('48VDC')) return err('This is a -48V DC PSU — an AC C13 cord does not fit its input connector.');
      }
      if (!a.outlet) processChecks(w, dev);
      dev.powerCords[a.psu] = a.outlet;
      if (dev.slots[a.psu]) dev.fasteners[fkey(a.psu, 'bail')] = false;
      dev.quirks = dev.quirks.filter((q) => q !== `loose_cord:${a.psu}`);
      if (!Object.values(dev.powerCords).some(Boolean)) flag(w, `unplugged:${dev.id}`);
      recomputePower(w, dev, a.outlet ? 'cord plugged' : `${a.psu} cord unplugged`);
      if (a.outlet && hasAC(w, dev)) addSel(w, dev, `Power Supply ${a.psu}`, 'AC input restored', 'info');
      if (a.outlet) flag(w, `cord_in:${dev.id}:${a.psu}`);
      return ok(
        a.outlet
          ? `Plugged ${a.psu} into ${a.outlet}.${dev.slots[a.psu] ? ' Now snap the retention bail over the plug so it cannot work loose.' : ''}`
          : `Unplugged the power cord from ${a.psu}.`,
      );
    }
    case 'reseatCord': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const at = rearReach(w, dev, 'The power cord');
      if (at) return err(at);
      if (dev.slots[a.psu]) dev.fasteners[fkey(a.psu, 'bail')] = true;
      const wasLoose = dev.quirks.includes(`loose_cord:${a.psu}`);
      dev.quirks = dev.quirks.filter((q) => q !== `loose_cord:${a.psu}`);
      recomputePower(w, dev, 'cord reseated');
      if (wasLoose) {
        flag(w, `cord_reseated:${dev.id}:${a.psu}`);
        addSel(w, dev, `Power Supply ${a.psu}`, 'AC input restored', 'info');
        addSel(w, dev, 'Power Unit', 'Redundancy regained', 'info');
        return ok(`The ${a.psu} cord was half out of the socket! Reseated it and locked the retention clip — PSU LED is green.`);
      }
      return ok(`Reseated the ${a.psu} power cord. It was already secure.`);
    }
    case 'bag': {
      const p = w.trainee.tray.find((x) => x.uid === a.uid);
      if (!p) return err('Not in your tray.');
      p.bagged = true;
      return ok(`Placed S/N ${p.serial} in an anti-static bag.`);
    }
    case 'tag': {
      const p = w.trainee.tray.find((x) => x.uid === a.uid);
      if (!p) return err('Not in your tray.');
      p.tagged = true;
      return ok(`Attached a defective-part tag (S/N ${p.serial}, ticket #, failure reason).`);
    }
    case 'bin': {
      const i = w.trainee.tray.findIndex((x) => x.uid === a.uid);
      if (i < 0) return err('Not in your tray.');
      const p = w.trainee.tray[i];
      if (p.dataBearing && a.bin !== 'secure_destruction') {
        penalize(w, 'data_bearing_rma', 20, `Sent a data-bearing ${p.kind.toUpperCase()} (S/N ${p.serial}) to ${a.bin === 'rma' ? 'RMA' : 'e-waste'}. Drives NEVER leave the site — secure destruction only`, { safety: true, key: p.uid });
      }
      if (!p.dataBearing && a.bin === 'secure_destruction') toast(w, 'info', 'Non data-bearing part placed in the secure destruction bin. It should go back to the vendor (RMA) for credit.');
      if (!p.bagged && p.kind !== 'psu' && p.kind !== 'fan' && p.kind !== 'heatsink')
        penalize(w, 'unbagged', 2, `Binned ${p.kind.toUpperCase()} S/N ${p.serial} without an anti-static bag`, { key: p.uid });
      if (!p.tagged && a.bin === 'rma') penalize(w, 'untagged', 2, 'RMA part has no defective tag — the vendor will reject it', { key: p.uid });
      w.trainee.tray.splice(i, 1);
      w.bins[a.bin].push(p);
      flag(w, `binned:${a.bin}:${p.serial}`);
      return ok(`Dropped S/N ${p.serial} in the ${a.bin === 'rma' ? 'RMA return' : a.bin === 'secure_destruction' ? 'secure destruction (locked)' : 'e-waste'} bin.`);
    }
    case 'flagFaulty': {
      const k = `${a.deviceId}:${a.slot}`;
      if (!w.trainee.flagged.includes(k)) w.trainee.flagged.push(k);
      flag(w, `flagged:${k}`);
      return ok(`Flagged ${a.slot} as the suspected faulty part.`);
    }
    case 'unflag':
      w.trainee.flagged = w.trainee.flagged.filter((x) => x !== `${a.deviceId}:${a.slot}`);
      return ok('Flag removed.');
    case 'connectCable': {
      for (const end of [a.a, a.b]) {
        const d = w.devices[end.deviceId];
        if (!d) return err('No device.');
        const at = d.role === 'server' ? rearReach(w, d, 'That port') : atDevice(w, d) ?? needSide(w, d, 'rear', 'The switch port');
        if (at) return err(at);
        if (Object.values(w.cables).some((c) => (c.a?.deviceId === end.deviceId && c.a.port === end.port) || (c.b?.deviceId === end.deviceId && c.b.port === end.port)))
          return err(`${d.hostname} ${end.port} already has a cable.`);
        if (end.port.startsWith('nic') && d.slots.OCP0?.partNumber.includes('QSFP') && a.cableType === 'dac') return err('SFP28 DAC will not fit a QSFP56 port.');
        if (end.port === 'bmc' || end.port.startsWith('mgmt')) {
          if (a.cableType !== 'cat6') return err(`${end.port} is an RJ45 port — use Cat6.`);
        } else if (a.cableType === 'cat6') return err(`${end.port} is an SFP28/QSFP cage — Cat6 doesn't plug into it.`);
      }
      const da = w.devices[a.a.deviceId];
      const db = w.devices[a.b.deviceId];
      if (da.rackId && db.rackId && da.u != null && db.u != null) {
        const distM = (Math.abs(da.u - db.u) * 44.45) / 1000 + (da.rackId === db.rackId ? 0.5 : 2.5);
        if (a.lengthM < distM) return err(`A ${a.lengthM} m cable can't reach (needs ≥ ${distM.toFixed(1)} m including routing).`);
        if (a.lengthM > distM + 2) penalize(w, 'cable_too_long', 1, `${a.lengthM} m is far too long — excess slack blocks airflow`, { key: `${a.a.deviceId}${a.a.port}` });
      }
      const c = addCable(w, { type: a.cableType, a: a.a, b: a.b, lengthM: a.lengthM, condition: a.condition ?? 'ok' });
      flag(w, `cabled:${a.a.deviceId}:${a.a.port}`);
      flag(w, `cabled:${a.b.deviceId}:${a.b.port}`);
      return ok(`Connected ${da.hostname}:${a.a.port} ⇄ ${db.hostname}:${a.b.port} (${a.cableType.toUpperCase()} ${a.lengthM} m). Cable id ${c.id}.`);
    }
    case 'disconnectCable': {
      const c = w.cables[a.cableId];
      if (!c) return err('No such cable.');
      for (const end of [c.a, c.b]) {
        if (!end) continue;
        const d = w.devices[end.deviceId];
        const at = d && (atDevice(w, d) ?? needSide(w, d, 'rear', 'The cable'));
        if (at) return err(at);
      }
      if (a.end) c[a.end] = null;
      else delete w.cables[a.cableId];
      return ok('Disconnected cable.');
    }
    case 'reconnectCable': {
      const c = w.cables[a.cableId];
      if (!c) return err('No such cable.');
      c[a.end] = a.port;
      return ok(`Reconnected to ${a.port.port}.`);
    }
    case 'labelCable': {
      const c = w.cables[a.cableId];
      if (!c) return err('No such cable.');
      c.labelA = a.labelA;
      c.labelB = a.labelB;
      flag(w, `labeled:${a.cableId}`);
      return ok('Printed and applied flag labels to both ends.');
    }
    case 'cleanCable': {
      const c = w.cables[a.cableId];
      if (!c) return err('No such cable.');
      if (c.condition === 'dirty') c.condition = 'ok';
      flag(w, `cleaned:${a.cableId}`);
      return ok('Cleaned both connector end-faces with a one-click cleaner and re-inspected with the scope: clean.');
    }
    case 'replaceCable': {
      const c = w.cables[a.cableId];
      if (!c) return err('No such cable.');
      for (const end of [c.a, c.b]) {
        const d = end && w.devices[end.deviceId];
        const at = d && (atDevice(w, d) ?? needSide(w, d, 'rear', 'The cable'));
        if (at) return err(at);
      }
      c.condition = 'ok';
      flag(w, `cable_replaced:${a.cableId}`);
      return ok('Replaced the cable with a new one from stock and moved the labels over.');
    }
    case 'installRails': {
      const rack = w.racks[a.rackId];
      if (!rack) return err('No rack.');
      if (w.trainee.location !== a.rackId) return err('Walk to the rack first.');
      if (a.u < 1 || a.u + a.heightU - 1 > rack.heightU) return err('Out of range.');
      // Misaligned rails steal one extra hole, which blocks the U above them.
      const span = (u: number, h: number, off: number): [number, number] => [u, u + h - 1 + (off ? 1 : 0)];
      const [n0, n1] = span(a.u, a.heightU, a.holeOffset);
      for (const [uStr, r] of Object.entries(rack.rails)) {
        const [e0, e1] = span(Number(uStr), r.heightU, r.holeOffset);
        if (n0 <= e1 && e0 <= n1) return err(`Overlaps rails already installed at U${uStr}${r.holeOffset || a.holeOffset ? ' (misaligned rails steal an extra hole)' : ''}.`);
      }
      rack.rails[a.u] = { heightU: a.heightU, holeOffset: a.holeOffset };
      if (a.holeOffset !== 0) flag(w, `rails_misaligned:${a.rackId}:${a.u}`);
      flag(w, `rails:${a.rackId}:${a.u}`);
      return ok(`Rails installed at U${a.u}${a.heightU > 1 ? `–U${a.u + a.heightU - 1}` : ''}${a.holeOffset ? ' — hmm, the rail clips landed one hole off the U boundary.' : ', aligned on the U boundary marks.'}`);
    }
    case 'removeRails': {
      const rack = w.racks[a.rackId];
      if (!rack?.rails[a.u]) return err('No rails there.');
      if (Object.values(w.devices).some((d) => d.rackId === a.rackId && d.u === a.u)) return err('A device is mounted on those rails.');
      delete rack.rails[a.u];
      delete w.flags[`rails_misaligned:${a.rackId}:${a.u}`];
      return ok(`Removed rails at U${a.u}.`);
    }
    case 'mountDevice': {
      const dev = w.devices[a.deviceId];
      const rack = w.racks[a.rackId];
      if (!dev || !rack) return err('No device/rack.');
      if (w.trainee.location !== a.rackId) return err('Walk to the rack first.');
      if (w.trainee.side !== 'front') return err('Servers are racked from the front: walk around to the cold aisle first.');
      const rails = rack.rails[a.u];
      if (!rails) return err(`No rails installed at U${a.u}.`);
      if (rails.heightU !== dev.heightU) return err(`Those are ${rails.heightU}U rails; ${dev.hostname} is ${dev.heightU}U.`);
      if (Object.values(w.devices).some((d) => d.rackId === a.rackId && d.u === a.u)) return err('Something is already mounted there.');
      if (dev.weightKg > 23 && !w.trainee.liftAssist)
        penalize(w, 'solo_lift', 10, `Lifted a ${dev.weightKg} kg server alone. Over 23 kg = two-person lift or lift assist`, { safety: true, key: dev.id });
      if (rails.holeOffset !== 0) {
        penalize(w, 'rails_off', 8, `Rails at U${a.u} are off by one hole — the server sits crooked and blocks the U above`, { key: `${a.rackId}:${a.u}` });
      }
      dev.rackId = a.rackId;
      dev.u = a.u;
      dev.servicePosition = false;
      flag(w, `mounted:${dev.id}`);
      if (rackWeightKg(w, a.rackId) > rack.maxWeightKg) penalize(w, 'rack_overweight', 15, 'Rack static weight limit exceeded', { safety: true, key: a.rackId });
      return ok(`Mounted ${dev.hostname} at U${a.u} and locked the rail latches.`);
    }
    case 'unmountDevice': {
      const dev = w.devices[a.deviceId];
      if (!dev?.rackId) return err('Not racked.');
      if (w.trainee.location !== dev.rackId) return err('Walk to the rack first.');
      if (Object.values(dev.powerCords).some(Boolean)) return err('Unplug the power cords first (at the rear).');
      if (w.trainee.side !== 'front') return err('Servers come out of the front of the rack: walk around to the cold aisle first.');
      if (Object.values(w.cables).some((c) => c.a?.deviceId === dev.id || c.b?.deviceId === dev.id)) return err('Disconnect all network cables first.');
      if (dev.weightKg > 23 && !w.trainee.liftAssist)
        penalize(w, 'solo_lift', 10, `Lifted a ${dev.weightKg} kg server alone`, { safety: true, key: dev.id });
      dev.rackId = null;
      dev.u = null;
      flag(w, `unmounted:${dev.id}`);
      return ok(`De-racked ${dev.hostname}.`);
    }
    case 'pduBreaker': {
      const rack = w.racks[a.rackId];
      const pdu = rack?.pdus.find((p) => p.side === a.side);
      if (!pdu) return err('No PDU.');
      if (w.trainee.location !== a.rackId) return err('Walk to the rack first.');
      if (w.trainee.side !== 'rear') return err('The PDUs are mounted at the back of the rack: walk around to the hot aisle first.');
      pdu.breakerTripped = !a.on;
      for (const d of Object.values(w.devices)) if (d.rackId === a.rackId) recomputePower(w, d, `PDU-${a.side} breaker ${a.on ? 'on' : 'off'}`);
      if (a.on) flag(w, `breaker_reset:${a.rackId}:${a.side}`);
      return ok(`PDU-${a.side} breaker ${a.on ? 'reset (ON)' : 'switched OFF'}.`);
    }
    // ---------- remote ----------
    case 'bmcPower': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      if (!hasAC(w, dev)) return err('Unable to establish IPMI v2 / RMCP+ session (no response from BMC).');
      if (!dev.bmc.responsive) return err('Error: Unable to establish IPMI v2 / RMCP+ session');
      switch (a.op) {
        case 'on':
          return ok(powerOn(w, dev, 'BMC'));
        case 'off':
          return ok(powerOff(w, dev, 'hard', 'BMC'));
        case 'soft':
          if (dev.os !== 'up') return ok(powerOff(w, dev, 'hard', 'BMC (OS did not respond to ACPI)'));
          return ok(powerOff(w, dev, 'soft', 'BMC ACPI'));
        case 'cycle':
        case 'reset': {
          if (dev.power === 'standby') return ok(powerOn(w, dev, 'BMC'));
          if (!dev.drained && dev.os === 'up') penalize(w, 'power_off_undrained', 20, `Power-cycled ${dev.hostname} while it was still serving production`, { key: dev.id });
          dev.power = 'standby';
          w.pending = w.pending.filter((p) => !(p.deviceId === dev.id && (p.type === 'post_complete' || p.type === 'os_up')));
          flag(w, `power_cycle:${dev.id}`);
          return ok(powerOn(w, dev, `BMC ${a.op}`));
        }
      }
      return err('bad op');
    }
    case 'selClear': {
      const dev = w.devices[a.deviceId];
      if (!dev || !dev.bmc.responsive || !hasAC(w, dev)) return err('BMC unreachable.');
      const exported = hasFlag(w, `sel_viewed:${dev.id}`);
      if (!exported) penalize(w, 'sel_cleared_unread', 5, 'Cleared the SEL without reviewing/saving it first — evidence lost', { key: dev.id });
      dev.sel = [];
      addSel(w, dev, 'Event Logging Disabled', 'Log area reset/cleared', 'info');
      flag(w, `sel_cleared:${dev.id}`);
      return ok('Clearing SEL.  Please allow a few seconds to erase.');
    }
    case 'bmcReset': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      if (!a.inband && (!dev.bmc.responsive || !hasAC(w, dev))) return err('Error: Unable to establish IPMI v2 / RMCP+ session');
      dev.bmc.responsive = false;
      flag(w, `bmc_reset:${dev.id}`);
      schedule(w, { at: w.t + 90, type: 'bmc_reset_done', deviceId: dev.id });
      return ok('Sent cold reset command to MC. The BMC will be unreachable for ~90 seconds. Host power is NOT affected.');
    }
    case 'locate': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      if (!hasAC(w, dev) || !dev.bmc.responsive) return err('BMC unreachable.');
      dev.locateLed = a.on;
      if (a.on) flag(w, `locate:${dev.id}`);
      return ok(a.on ? 'Chassis identify LED ON (blinking blue)' : 'Chassis identify LED OFF');
    }
    case 'driveLocate': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const q = `locate:${a.slot}`;
      dev.quirks = dev.quirks.filter((x) => x !== q);
      if (a.on) {
        dev.quirks.push(q);
        flag(w, `drive_locate:${dev.id}:${a.slot}`);
      }
      return ok(a.on ? `Locate LED blinking on ${a.slot}.` : `Locate LED off on ${a.slot}.`);
    }
    case 'setBootOrder': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      dev.bootOrder = a.order;
      flag(w, `boot_order_set:${dev.id}`);
      return ok(`Boot order: ${a.order.join(' > ')}`);
    }
    case 'setPortAdmin': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      const q = `admin_down:${a.port}`;
      dev.quirks = dev.quirks.filter((x) => x !== q);
      if (!a.up) dev.quirks.push(q);
      return ok(`${a.port} admin ${a.up ? 'up' : 'down'}`);
    }
    case 'biosKey': {
      const dev = w.devices[a.deviceId];
      if (!dev || dev.power !== 'posting') return err('Not in POST.');
      if (!dev.quirks.includes('enter_bios')) dev.quirks.push('enter_bios');
      return ok('Entering Setup...');
    }
    case 'biosExit': {
      const dev = w.devices[a.deviceId];
      if (!dev || !dev.quirks.includes('in_bios')) return err('Not in BIOS setup.');
      dev.quirks = dev.quirks.filter((q) => q !== 'in_bios');
      if (a.save) {
        if (a.bootOrder) {
          dev.bootOrder = a.bootOrder;
          flag(w, `boot_order_set:${dev.id}`);
        }
        if (a.fixClock) {
          dev.quirks = dev.quirks.filter((q) => q !== 'clock_reset');
          flag(w, `clock_fixed:${dev.id}`);
        }
        flag(w, `bios_saved:${dev.id}`);
      }
      bootFromOrder(w, dev);
      return ok(a.save ? 'Saving changes and resetting...' : 'Exiting without saving...');
    }
    case 'osReboot': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      if (!dev.drained) penalize(w, 'power_off_undrained', 20, `Rebooted ${dev.hostname} while it was still serving production`, { key: dev.id });
      dev.power = 'standby';
      flag(w, `reboot:${dev.id}`);
      powerOn(w, dev, 'OS reboot');
      return ok('Connection closed by remote host (system is going down for reboot NOW).');
    }
    case 'osShutdown': {
      const dev = w.devices[a.deviceId];
      if (!dev) return err('No device.');
      return ok(powerOff(w, dev, 'soft', 'OS shutdown'));
    }
    // ---------- process ----------
    case 'ticketTransition': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      if (!TRANSITIONS[t.status].includes(a.to)) return err(`Cannot move ${t.key} from ${t.status} to ${a.to}.`);
      if (a.to === 'In Progress' && !t.assignee) t.assignee = w.trainee.name;
      if (a.to === 'Resolved') {
        const hasWorklog = t.worklogs.some((x) => x.kind === 'worklog' && x.author === w.trainee.name);
        if (!hasWorklog) penalize(w, 'resolve_no_worklog', 8, `Resolved ${t.key} without a worklog`, { key: t.key });
      }
      if (a.to === 'Closed') penalize(w, 'self_close', 2, 'DCO resolves; the requester (or automation) closes after validation', { key: t.key });
      t.worklogs.push({ t: w.t, author: 'system', kind: 'system', text: `${w.trainee.name} changed status ${t.status} → ${a.to}` });
      t.status = a.to;
      flag(w, `ticket:${t.key}:${a.to}`);
      return ok(`${t.key} → ${a.to}`);
    }
    case 'ticketAssign': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      t.assignee = a.who;
      flag(w, `assigned:${t.key}`);
      return ok(`${t.key} assigned to ${a.who}.`);
    }
    case 'ticketWorklog': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      if (!a.text.trim()) return err('Empty worklog.');
      t.worklogs.push({ t: w.t, author: w.trainee.name, kind: a.kind ?? 'worklog', text: a.text.trim() });
      flag(w, `worklog:${t.key}`);
      return ok('Worklog added.');
    }
    case 'requestDrain': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      if (t.hostState !== 'In Production') return err(`Host is already ${t.hostState}.`);
      t.hostState = 'Drain Requested';
      t.worklogs.push({ t: w.t, author: w.trainee.name, kind: 'system', text: `Drain/release requested from service owner for ${t.hostname}.` });
      schedule(w, { at: w.t + 60 + (w.seed % 60), type: 'drain_approved', ticketKey: t.key });
      flag(w, `drain_requested:${t.key}`);
      return ok('Drain requested. The service owner will migrate workloads and release the host (usually 1–2 minutes here; hours in real life).');
    }
    case 'requestPart': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      t.partRequested = a.pn;
      t.worklogs.push({ t: w.t, author: w.trainee.name, kind: 'system', text: `Part requested: ${a.pn}` });
      schedule(w, { at: w.t + 240, type: 'part_arrives', ticketKey: t.key, payload: { pn: a.pn } });
      flag(w, `part_requested:${t.key}:${a.pn}`);
      return ok(`Requested ${a.pn}. ETA ~4 min (sim). Consider moving the ticket to Waiting for Part.`);
    }
    case 'createRma': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      const key = `RMA-${String(w.seed % 90000 + 10000)}`;
      t.linkedRma = key;
      t.worklogs.push({ t: w.t, author: w.trainee.name, kind: 'system', text: `Created ${key} for failed part S/N ${a.serial}` });
      flag(w, `rma:${t.key}:${a.serial.toUpperCase()}`);
      return ok(`${key} created and linked to ${t.key}.`);
    }
    case 'escalate': {
      const t = w.tickets[a.key];
      if (!t) return err('No ticket.');
      t.worklogs.push({ t: w.t, author: w.trainee.name, kind: 'comment', text: `Escalated to ${a.team}: ${a.reason}` });
      if (TRANSITIONS[t.status].includes('Escalated')) t.status = 'Escalated';
      flag(w, `escalated:${t.key}:${a.team}`);
      return ok(`Escalated ${t.key} to ${a.team}.`);
    }
    case 'notes':
      w.trainee.notes = a.text;
      return ok('');
    case 'setFlag':
      flag(w, a.name);
      return ok('');
    case 'penalty':
      penalize(w, a.rule, a.points, a.reason, { safety: a.safety, key: a.key });
      return ok('');
    case 'wait':
      advance(w, a.seconds);
      return ok(`Waited ${a.seconds}s.`);
  }
}

/** Convenience: does a host's production network work end-to-end? (ssh reachability) */
export function hostReachable(w: World, dev: Device): boolean {
  if (dev.power !== 'on' || (dev.os !== 'up' && dev.os !== 'readonly_fs')) return false;
  return ['nic0p0', 'nic0p1'].some((p) => linkState(w, dev.id, p).up);
}

export { MODELS };
