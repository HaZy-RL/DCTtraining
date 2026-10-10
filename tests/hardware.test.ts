import { describe, expect, it } from 'vitest';
import { hardwareScenarios } from '../src/content/hardware';
import { applyAction, type Action } from '../src/engine/actions';
import { evaluate } from '../src/engine/scenario';
import { advance } from '../src/engine/sim';
import { MODELS } from '../src/engine/catalog';

function run(id: string, seed: number) {
  const def = hardwareScenarios.find((s) => s.id === id)!;
  const inst = def.build(seed, 'practice');
  const w = inst.world;
  const dev = w.devices[inst.focusDeviceId!];
  const key = Object.keys(w.tickets)[0];
  const act = (a: Action) => {
    const r = applyAction(w, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.message}`);
    return r;
  };
  return { inst, w, dev, key, act };
}

describe('DIMM golden path', () => {
  it('expert path reaches Gold', () => {
    const { inst, w, dev, key, act } = run('hw-dimm', 1234);
    const slot = Object.entries(dev.slots).find(([, c]) => c?.failure)![0];
    const oldSerial = dev.slots[slot]!.serial;
    act({ type: 'ticketTransition', key, to: 'In Progress' });
    act({ type: 'setFlag', name: `sel_viewed:${dev.id}` });
    act({ type: 'requestDrain', key });
    advance(w, 200);
    expect(w.tickets[key].hostState).toBe('Drained');
    act({ type: 'bmcPower', deviceId: dev.id, op: 'soft' });
    act({ type: 'walk', to: dev.rackId! });
    act({ type: 'scanAsset', deviceId: dev.id });
    act({ type: 'walk', to: dev.rackId!, side: 'rear' });
    for (const psu of ['PSU1', 'PSU2']) {
      act({ type: 'fastener', deviceId: dev.id, target: psu, id: 'bail', secure: false });
      act({ type: 'cord', deviceId: dev.id, psu, outlet: null });
    }
    act({ type: 'walk', to: dev.rackId!, side: 'front' });
    act({ type: 'powerButton', deviceId: dev.id });
    act({ type: 'esd', on: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earL', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earR', secure: false });
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'screw', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'latch', secure: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: false });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'open' });
    act({ type: 'removePart', deviceId: dev.id, slot });
    const idx = w.spares.findIndex((s) => s.component.partNumber === 'MEM-64G-D5-5600-2R');
    act({ type: 'insertPart', deviceId: dev.id, slot, source: { spareIndex: idx }, aligned: true });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'closed' });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: true });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'latch', secure: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'screw', secure: true });
    act({ type: 'servicePosition', deviceId: dev.id, out: false });
    act({ type: 'walk', to: dev.rackId!, side: 'rear' });
    const cords = { PSU1: `${dev.rackId}-PDU-A:20`, PSU2: `${dev.rackId}-PDU-B:20` };
    for (const psu of ['PSU1', 'PSU2'] as const) {
      act({ type: 'cord', deviceId: dev.id, psu, outlet: cords[psu] });
      act({ type: 'fastener', deviceId: dev.id, target: psu, id: 'bail', secure: true });
    }
    expect(w.devices[dev.id].power).toBe('standby');
    act({ type: 'walk', to: dev.rackId!, side: 'front' });
    act({ type: 'powerButton', deviceId: dev.id });
    expect(w.devices[dev.id].power).toBe('posting');
    advance(w, 400);
    expect(w.devices[dev.id].os).toBe('up');
    act({ type: 'setFlag', name: `viewed:${dev.id}:memory` });
    act({ type: 'selClear', deviceId: dev.id });
    const old = w.trainee.tray.find((p) => p.serial === oldSerial)!;
    act({ type: 'bag', uid: old.uid });
    act({ type: 'tag', uid: old.uid });
    act({ type: 'bin', uid: old.uid, bin: 'rma' });
    const newSerial = w.devices[dev.id].slots[slot]!.serial;
    act({ type: 'ticketWorklog', key, text: `Replaced ${slot}. Old S/N ${oldSerial}, new S/N ${newSerial}. Verified 1024GB in dmidecode.` });
    act({ type: 'ticketTransition', key, to: 'Resolved' });
    const score = evaluate(inst, 'practice');
    expect(w.penalties).toEqual([]);
    expect(score.steps.filter((s) => !s.done).map((s) => s.id)).toEqual([]);
    expect(score.rating).toBe('Gold');
  });

  it('pulling a DIMM from a running host is penalized as a safety violation', () => {
    const { w, dev, key, act } = run('hw-dimm', 99);
    const slot = Object.entries(dev.slots).find(([, c]) => c?.failure)![0];
    act({ type: 'ticketTransition', key, to: 'In Progress' });
    act({ type: 'walk', to: dev.rackId! });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earL', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earR', secure: false });
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'screw', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'latch', secure: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: false });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'open' });
    expect(w.penalties.some((p) => p.rule === 'hot_cold_part' && p.safety)).toBe(true);
    expect(w.penalties.some((p) => p.rule === 'no_esd')).toBe(true);
  });
});

describe('physical fasteners and aisles', () => {
  it('PSU hot-swap: rear aisle only, server must be racked, bail and tab must be worked by hand', () => {
    const { inst, w, dev, key, act } = run('hw-psu', 4242);
    const slot = Object.entries(dev.slots).find(([, c]) => c?.failure)![0];
    const try_ = (a: Action) => applyAction(w, a);
    act({ type: 'ticketTransition', key, to: 'In Progress' });
    act({ type: 'walk', to: dev.rackId! });
    act({ type: 'scanAsset', deviceId: dev.id });
    // From the cold aisle the PSU is out of reach
    expect(try_({ type: 'cord', deviceId: dev.id, psu: slot, outlet: null }).message).toMatch(/hot aisle/);
    // Slid out the front, the rear is unreachable even from the hot aisle
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earL', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earR', secure: false });
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'walk', to: dev.rackId!, side: 'rear' });
    const blocked = try_({ type: 'removePart', deviceId: dev.id, slot });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/service position/);
    act({ type: 'walk', to: dev.rackId!, side: 'front' });
    act({ type: 'servicePosition', deviceId: dev.id, out: false });
    act({ type: 'walk', to: dev.rackId!, side: 'rear' });
    // Bail first, then the cord, then the tab
    expect(try_({ type: 'cord', deviceId: dev.id, psu: slot, outlet: null }).message).toMatch(/bail/);
    act({ type: 'fastener', deviceId: dev.id, target: slot, id: 'bail', secure: false });
    const outlet = dev.powerCords[slot]!;
    act({ type: 'cord', deviceId: dev.id, psu: slot, outlet: null });
    expect(try_({ type: 'removePart', deviceId: dev.id, slot }).message).toMatch(/release tab/);
    act({ type: 'fastener', deviceId: dev.id, target: slot, id: 'tab', secure: false });
    act({ type: 'removePart', deviceId: dev.id, slot });
    const idx = w.spares.findIndex((s) => s.component.partNumber === 'PSU-1600W-AC-TI');
    act({ type: 'insertPart', deviceId: dev.id, slot, source: { spareIndex: idx } });
    act({ type: 'cord', deviceId: dev.id, psu: slot, outlet });
    const cordStep = () => evaluate(inst, 'practice').steps.find((s) => s.id === 'cord')!.done;
    expect(cordStep()).toBe(false); // bail still open
    act({ type: 'fastener', deviceId: dev.id, target: slot, id: 'bail', secure: true });
    expect(cordStep()).toBe(true);
    expect(w.penalties).toEqual([]);
  });

  it('CPU heatsink: screws loosen 4→1, torque 1→4, and a loose heatsink trips on power-on', () => {
    const { w, dev, key, act } = run('hw-cpu', 5);
    const slot = Object.entries(dev.slots).find(([, c]) => c?.failure)![0];
    act({ type: 'ticketTransition', key, to: 'In Progress' });
    act({ type: 'walk', to: dev.rackId! });
    act({ type: 'scanAsset', deviceId: dev.id });
    act({ type: 'esd', on: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earL', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'chassis', id: 'earR', secure: false });
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'screw', secure: false });
    act({ type: 'fastener', deviceId: dev.id, target: 'lid', id: 'latch', secure: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: false });
    expect(applyAction(w, { type: 'heatsink', deviceId: dev.id, cpu: slot, install: false }).ok).toBe(false);
    for (const n of [4, 3, 2, 1]) act({ type: 'fastener', deviceId: dev.id, target: `heatsink:${slot}`, id: `s${n}`, secure: false });
    act({ type: 'heatsink', deviceId: dev.id, cpu: slot, install: false });
    expect(w.penalties.filter((p) => p.rule === 'torque_sequence')).toEqual([]);
    act({ type: 'fastener', deviceId: dev.id, target: slot, id: 'frame', secure: false });
    act({ type: 'removePart', deviceId: dev.id, slot });
    const idx = w.spares.findIndex((s) => s.component.partNumber === 'CPU-X5-64C-2.4');
    act({ type: 'insertPart', deviceId: dev.id, slot, source: { spareIndex: idx }, aligned: true });
    expect(applyAction(w, { type: 'heatsink', deviceId: dev.id, cpu: slot, install: true }).message).toMatch(/load frame/);
    act({ type: 'fastener', deviceId: dev.id, target: slot, id: 'frame', secure: true });
    act({ type: 'heatsink', deviceId: dev.id, cpu: slot, install: true });
    for (const n of [2, 1, 3, 4]) act({ type: 'fastener', deviceId: dev.id, target: `heatsink:${slot}`, id: `s${n}`, secure: true });
    expect(w.penalties.some((p) => p.rule === 'torque_sequence')).toBe(true);
    // Loosen one screw and power on: thermal trip
    act({ type: 'fastener', deviceId: dev.id, target: `heatsink:${slot}`, id: 's3', secure: false });
    if (w.devices[dev.id].power !== 'standby') act({ type: 'powerButton', deviceId: dev.id });
    expect(applyAction(w, { type: 'powerButton', deviceId: dev.id }).message).toMatch(/thermal trip/i);
  });
});

describe('every hardware drill builds and is internally consistent', () => {
  for (const def of hardwareScenarios) {
    it(def.id, () => {
      for (const seed of [1, 2, 3, 42, 777]) {
        const inst = def.build(seed, 'practice');
        const dev = inst.world.devices[inst.focusDeviceId!];
        const failed = Object.entries(dev.slots).filter(([, c]) => c?.failure);
        expect(failed.length).toBe(1);
        const [slot] = failed[0];
        expect(MODELS[dev.model].slots.find((s) => s.id === slot)).toBeTruthy();
        // SEL mentions the failed slot (symptom consistency)
        expect(dev.sel.some((e) => e.sensor.includes(slot) || e.sensor.includes('OCP') || e.sensor.includes('PCIe') || e.sensor.includes('CMOS'))).toBe(true);
        // The correct part is on the cart
        expect(inst.world.spares.some((s) => s.component.partNumber === dev.slots[slot]!.partNumber)).toBe(true);
        expect(evaluate(inst, 'practice').rating).toBe('Incomplete');
      }
    });
  }
});
