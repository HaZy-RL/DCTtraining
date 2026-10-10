// The coach: breaks a repair objective into the physical micro-actions a new DCT actually
// performs (walk here, flip this clip, back out that screw…), each checked against the live world.
import { fastenersOf, KIND_LABEL, MODELS } from './catalog';
import { heatsinkTorqued, isTight } from './fasteners';
import { parseOutlet } from './projectors';
import type { CoachLine, CoachTarget } from './scenario';
import type { Device, World } from './types';

const L = (text: string, done: boolean, target?: CoachTarget): CoachLine => ({ text, done, target });

function dev(w: World, id: string): Device {
  return w.devices[id];
}

/** Walk to the rack and into the right aisle. */
export function approach(w: World, id: string, side: 'front' | 'rear'): CoachLine[] {
  const d = dev(w, id);
  if (!d.rackId) return [];
  const here = w.trainee.location === d.rackId;
  const t: CoachTarget = { deviceId: id, rackId: d.rackId, side };
  return [
    L(`Walk to rack ${w.racks[d.rackId].location} (🚶 Walk here, or WASD in walk mode)`, here, t),
    L(side === 'rear' ? 'Go round to the HOT aisle: the back of the rack (Rear view)' : 'Stand in the COLD aisle: the front of the rack (Front view)', here && w.trainee.side === side, t),
  ];
}

/** Rack ears → service position → lid off. */
export function openChassis(w: World, id: string): CoachLine[] {
  const d = dev(w, id);
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: 'front', sel });
  const out = d.servicePosition || !d.rackId;
  const lidOff = !d.layers.lid;
  const lines: CoachLine[] = [];
  if (d.rackId) {
    lines.push(
      L('Lift the LEFT rack-ear latch', out || !isTight(d, 'chassis', 'earL'), t('fastener:chassis:earL')),
      L('Lift the RIGHT rack-ear latch', out || !isTight(d, 'chassis', 'earR'), t('fastener:chassis:earR')),
      L('Slide the server out on its rails to the service position', out, t('chassis')),
    );
  }
  lines.push(
    L('Back out the cover lock screw (#2 Phillips)', lidOff || !isTight(d, 'lid', 'screw'), t('fastener:lid:screw')),
    L('Lift the cover release latch', lidOff || !isTight(d, 'lid', 'latch'), t('fastener:lid:latch')),
    L('Slide the lid back and lift it off', lidOff, t('layer:lid')),
  );
  return lines;
}

function layerOut(w: World, id: string, layer: 'shroud' | 'riser1' | 'riser2'): CoachLine[] {
  const d = dev(w, id);
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: 'front', sel });
  if (layer === 'shroud') return [L('Lift the black air shroud straight up and out', !d.layers.shroud, t('layer:shroud'))];
  const name = layer.replace('riser', 'Riser ');
  const gone = !d.layers[layer];
  return [
    L(`Loosen ${name}'s rear thumbscrew`, gone || !isTight(d, layer, 'ts1'), t(`fastener:${layer}:ts1`)),
    L(`Loosen ${name}'s front thumbscrew`, gone || !isTight(d, layer, 'ts2'), t(`fastener:${layer}:ts2`)),
    L(`Lift ${name} straight up by its blue touch points`, gone, t(`layer:${layer}`)),
  ];
}

function heatsinkOff(w: World, id: string, cpu: string): CoachLine[] {
  const d = dev(w, id);
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: 'front', sel });
  const gone = !d.heatsinks[cpu];
  return [
    ...[4, 3, 2, 1].map((n) => L(`Loosen heatsink screw ${n} (order 4 → 3 → 2 → 1)`, gone || !isTight(d, `heatsink:${cpu}`, `s${n}`), t(`fastener:heatsink:${cpu}:s${n}`))),
    L('Lift the heatsink, twisting gently to break the paste seal', gone, t(`heatsink:${cpu}`)),
  ];
}

/** Everything between "I'm at the rack" and "the failed part is in my hand". */
export function removalPlan(w: World, id: string, slot: string): CoachLine[] {
  const d = dev(w, id);
  const def = MODELS[d.model].slots.find((s) => s.id === slot)!;
  const removed = !!w.flags[`removed:${id}:${slot}`];
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: def.access === 'rear' ? 'rear' : 'front', sel });
  const lines: CoachLine[] = [...approach(w, id, def.access === 'rear' ? 'rear' : 'front')];
  if (def.access === 'internal') {
    if (!def.hotSwap) lines.push(L('Put on the ESD wrist strap and clip it to bare chassis metal', w.trainee.esdStrap));
    lines.push(...openChassis(w, id));
    for (const r of def.requires ?? []) {
      if (r === 'shroud' || r === 'riser1' || r === 'riser2') lines.push(...layerOut(w, id, r));
      if (r === 'heatsink') lines.push(...heatsinkOff(w, id, slot));
    }
  } else if (!def.hotSwap) {
    lines.push(L('Put on the ESD wrist strap and clip it to bare chassis metal', w.trainee.esdStrap));
  }
  if (def.kind === 'psu') {
    const corded = !!d.powerCords[slot];
    lines.push(
      L(`Flip the cord retention bail off the ${slot} plug`, removed || !corded || !isTight(d, slot, 'bail'), t(`fastener:${slot}:bail`)),
      L(`Unplug the power cord from ${slot}`, removed || !corded, t(`cord:${slot}`)),
    );
  }
  if (def.kind === 'dimm') {
    lines.push(L('Press both DIMM ejector latches outward (both ends)', removed || d.latches[slot] === 'open', t(slot)));
  } else if (def.kind === 'hdd' || def.kind === 'nvme') {
    lines.push(L('Press the release button: the carrier handle swings open', removed || d.latches[slot] === 'open', t(slot)));
    if (def.kind === 'hdd') {
      const since = w.flags[`unlatched:${id}:${slot}`]?.last;
      lines.push(L('Wait ~15 s for the platters to spin down (don\'t yank a spinning disk)', removed || (since !== undefined && w.t - since >= 15)));
    }
  }
  for (const f of fastenersOf(d.model, slot)) {
    if (f.gatesRemoval === false) continue;
    lines.push(L(`${f.release}${f.tool ? ` (${f.tool})` : ''}`, removed || !isTight(d, slot, f.id), t(`fastener:${slot}:${f.id}`)));
  }
  lines.push(L(`Pull the ${KIND_LABEL[def.kind].toLowerCase()} out of ${slot}`, removed, t(slot)));
  if (removed) return lines.map((l) => ({ ...l, done: true }));
  return lines;
}

/** From "slot is empty" to "the right part is in and fully secured". */
export function installPlan(w: World, id: string, slot: string, pn: string, oldSerial: string): CoachLine[] {
  const d = dev(w, id);
  const def = MODELS[d.model].slots.find((s) => s.id === slot)!;
  const p = d.slots[slot];
  const fresh = !!p && p.serial !== oldSerial;
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: def.access === 'rear' ? 'rear' : 'front', sel });
  const lines: CoachLine[] = [];
  if (def.kind === 'cpu') lines.push(L('Open the socket load frame (lever unhooked)', fresh || !isTight(d, slot, 'frame'), t(`fastener:${slot}:frame`)));
  lines.push(L(`Install the spare with PN ${pn}. Read the label: look-alikes are on the cart`, fresh && p!.partNumber === pn, t(slot)));
  if (def.kind === 'dimm') lines[lines.length - 1].text += ' (line the notch up with the key)';
  if (def.kind === 'cpu') lines[lines.length - 1].text += ' (match the gold pin-1 triangle)';
  if (def.kind === 'dimm') lines.push(L('Press the DIMM down firmly until both ejectors snap shut', fresh && p!.seated, t(slot)));
  if (def.kind === 'hdd' || def.kind === 'nvme') lines.push(L('Push the carrier home and close the handle', fresh && p!.seated, t(slot)));
  for (const f of fastenersOf(d.model, slot)) {
    if (f.spring || f.gatesRemoval === false) continue;
    lines.push(L(`${f.secure}${f.tool ? ` (${f.tool})` : ''}`, fresh && isTight(d, slot, f.id), t(`fastener:${slot}:${f.id}`)));
  }
  return lines;
}

/** Put every disturbed layer back, torque everything, slide in. */
export function reassemblyPlan(w: World, id: string, slot: string): CoachLine[] {
  const d = dev(w, id);
  const def = MODELS[d.model].slots.find((s) => s.id === slot)!;
  const t = (sel: string): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side: 'front', sel });
  const lines: CoachLine[] = [];
  const req = def.requires ?? [];
  if (req.includes('heatsink')) {
    lines.push(L(`Seat the heatsink on ${slot} (fresh thermal paste)`, d.heatsinks[slot], t(`heatsink:${slot}`)));
    for (const n of [1, 2, 3, 4]) lines.push(L(`Torque heatsink screw ${n} (order 1 → 2 → 3 → 4)`, d.heatsinks[slot] && isTight(d, `heatsink:${slot}`, `s${n}`), t(`fastener:heatsink:${slot}:s${n}`)));
  }
  for (const r of ['riser1', 'riser2'] as const) {
    if (!req.includes(r)) continue;
    const name = r.replace('riser', 'Riser ');
    lines.push(
      L(`Lower ${name} back into its slot`, d.layers[r], t(`layer:${r}`)),
      L(`Tighten both ${name} thumbscrews`, d.layers[r] && isTight(d, r, 'ts1') && isTight(d, r, 'ts2'), t(`fastener:${r}:${isTight(d, r, 'ts1') ? 'ts2' : 'ts1'}`)),
    );
  }
  if (req.includes('shroud')) lines.push(L('Drop the air shroud back in place', d.layers.shroud, t('layer:shroud')));
  lines.push(
    L('Set the lid on and slide it forward', d.layers.lid, t('layer:lid')),
    L('Press the cover latch flat', d.layers.lid && isTight(d, 'lid', 'latch'), t('fastener:lid:latch')),
    L('Tighten the cover lock screw', d.layers.lid && isTight(d, 'lid', 'screw'), t('fastener:lid:screw')),
  );
  if (d.rackId) lines.push(L('Slide the server back into the rack until both ear latches click', !d.servicePosition, t('chassis')));
  return lines;
}

/** Cold work: get standby power off the board. */
export function unplugPlan(w: World, id: string): CoachLine[] {
  const d = dev(w, id);
  const psus = MODELS[d.model].slots.filter((s) => s.kind === 'psu').map((s) => s.id);
  const t = (sel: string, side: 'front' | 'rear'): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side, sel });
  const unplugged = !!w.flags[`unplugged:${id}`] && !psus.some((p) => d.powerCords[p]);
  const lines: CoachLine[] = [...approach(w, id, 'rear')];
  for (const p of psus) {
    lines.push(
      L(`Flip the retention bail off the ${p} plug`, unplugged || !d.powerCords[p] || !isTight(d, p, 'bail'), t(`fastener:${p}:bail`, 'rear')),
      L(`Unplug the ${p} power cord`, unplugged || !d.powerCords[p], t(`cord:${p}`, 'rear')),
    );
  }
  const drained = (w.flags[`flea_drained:${id}`]?.last ?? -1) >= (w.flags[`unplugged:${id}`]?.last ?? Infinity);
  lines.push(
    L('Walk back round to the cold aisle (front)', drained || (w.trainee.side === 'front' && unplugged), { deviceId: id, rackId: d.rackId ?? undefined, side: 'front' }),
    L('Hold the power button ~15 s to drain flea power (no cords attached!)', drained, t('power', 'front')),
  );
  return lines;
}

/** Cold work: cords back on A and B, then power on. */
export function powerOnPlan(w: World, id: string): CoachLine[] {
  const d = dev(w, id);
  const t = (sel: string, side: 'front' | 'rear'): CoachTarget => ({ deviceId: id, rackId: d.rackId ?? undefined, side, sel });
  const on = d.power === 'on' || d.power === 'posting';
  const side = (p: string) => parseOutlet(d.powerCords[p] ?? '')?.side;
  return [
    ...approach(w, id, 'rear').map((l) => (on ? { ...l, done: true } : l)),
    L('Plug PSU1 into PDU-A (blue)', on || side('PSU1') === 'A', t('cord:PSU1', 'rear')),
    L('Snap PSU1\'s retention bail over the plug', on || (side('PSU1') === 'A' && isTight(d, 'PSU1', 'bail')), t('fastener:PSU1:bail', 'rear')),
    L('Plug PSU2 into PDU-B (red)', on || side('PSU2') === 'B', t('cord:PSU2', 'rear')),
    L('Snap PSU2\'s retention bail over the plug', on || (side('PSU2') === 'B' && isTight(d, 'PSU2', 'bail')), t('fastener:PSU2:bail', 'rear')),
    L('Walk round to the front and press the power button', on, t('power', 'front')),
  ];
}

export function heatsinkStillLoose(d: Device): boolean {
  return Object.entries(d.heatsinks).some(([cpu, on]) => on && d.slots[cpu] && !heatsinkTorqued(d, cpu));
}
