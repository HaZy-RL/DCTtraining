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
    act({ type: 'cord', deviceId: dev.id, psu: 'PSU1', outlet: null });
    act({ type: 'cord', deviceId: dev.id, psu: 'PSU2', outlet: null });
    act({ type: 'powerButton', deviceId: dev.id });
    act({ type: 'esd', on: true });
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: false });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'open' });
    act({ type: 'removePart', deviceId: dev.id, slot });
    const idx = w.spares.findIndex((s) => s.component.partNumber === 'MEM-64G-D5-5600-2R');
    act({ type: 'insertPart', deviceId: dev.id, slot, source: { spareIndex: idx }, aligned: true });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'closed' });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: true });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: true });
    act({ type: 'servicePosition', deviceId: dev.id, out: false });
    const cords = { PSU1: `${dev.rackId}-PDU-A:20`, PSU2: `${dev.rackId}-PDU-B:20` };
    act({ type: 'cord', deviceId: dev.id, psu: 'PSU1', outlet: cords.PSU1 });
    act({ type: 'cord', deviceId: dev.id, psu: 'PSU2', outlet: cords.PSU2 });
    expect(w.devices[dev.id].power).toBe('standby');
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
    act({ type: 'servicePosition', deviceId: dev.id, out: true });
    act({ type: 'layer', deviceId: dev.id, layer: 'lid', install: false });
    act({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: false });
    act({ type: 'latch', deviceId: dev.id, slot, state: 'open' });
    expect(w.penalties.some((p) => p.rule === 'hot_cold_part' && p.safety)).toBe(true);
    expect(w.penalties.some((p) => p.rule === 'no_esd')).toBe(true);
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
