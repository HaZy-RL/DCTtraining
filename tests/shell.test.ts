import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { hardwareScenarios } from '../src/content/hardware';
import { applyAction, type Action } from '../src/engine/actions';
import { createSession } from '../src/engine/shells/packs';
import { advance } from '../src/engine/sim';
import type { World } from '../src/engine/types';

function setup(id: string, seed = 7) {
  const inst = hardwareScenarios.find((s) => s.id === id)!.build(seed, 'practice');
  let w: World = inst.world;
  const api = {
    getWorld: () => w,
    dispatch: (a: Action) => {
      let r = { ok: false, message: '' };
      w = produce(w, (d) => {
        r = applyAction(d, a);
      });
      return r;
    },
  };
  const s = createSession(api);
  const dev = () => w.devices[inst.focusDeviceId!];
  return { s, dev, api, tick: (sec: number) => (w = produce(w, (d) => advance(d, sec))), get w() { return w; } };
}

const strip = (x: string) => x.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

describe('jump host + ipmitool', () => {
  it('requires lanplus and the BMC address', () => {
    const { s, dev } = setup('hw-dimm');
    const h = dev().hostname;
    expect(s.exec(`ipmitool -H ${h}-bmc -U admin -E sel elist`)).toContain('lanplus');
    expect(s.exec(`ipmitool -I lanplus -H ${h} -U admin -E sel elist`)).toContain('PRODUCTION');
    const out = s.exec(`ipmitool -I lanplus -H ${h}-bmc -U admin -E sel elist`);
    expect(out).toMatch(/Uncorrectable ECC/);
  });
  it('ssh into the host, sudo required for dmesg, sees EDAC for the failed DIMM', () => {
    const { s, dev } = setup('hw-dimm');
    const slot = Object.entries(dev().slots).find(([, c]) => c?.failure)![0];
    s.exec(`ssh ${dev().hostname}`);
    expect(s.frame.kind).toBe('host');
    expect(s.exec('dmesg')).toContain('Operation not permitted');
    expect(s.exec('sudo dmidecode -t memory')).toContain(slot);
    expect(s.exec('sudo ras-mc-ctl --error-count | grep ' + slot)).toMatch(new RegExp(`${slot}\\s+\\d+\\s+2`));
    expect(s.exec('free -g')).toContain('Mem:');
    s.exec('exit');
    expect(s.frame.kind).toBe('jump');
  });
  it('lsblk serial mapping and smartctl FAILED on the bad HDD', () => {
    const { s, dev } = setup('hw-hdd', 11);
    const [slot, c] = Object.entries(dev().slots).find(([, x]) => x?.failure)!;
    const name = dev().osNames[slot];
    s.exec(`ssh ${dev().hostname}`);
    expect(s.exec('lsblk -o NAME,SERIAL')).toContain(c!.serial);
    expect(s.exec(`sudo smartctl -H /dev/${name}`)).toContain('FAILED');
    s.exec(`sudo ledctl locate=/dev/${name}`);
    expect(s.api.getWorld().flags[`drive_locate:${dev().id}:${slot}`]).toBeTruthy();
  });
  it('pipes and filters work', () => {
    const { s, dev } = setup('hw-dimm');
    s.exec(`ssh ${dev().hostname}`);
    expect(Number(s.exec('sudo dmidecode -t memory | grep -c Size:'))).toBe(16);
  });
});

describe('SOL', () => {
  it('~. kills the jump ssh, ~~. exits SOL only', () => {
    const t = setup('hw-psu');
    const h = t.dev().hostname;
    t.s.exec(`ipmitool -I lanplus -H ${h}-bmc -U admin -E sol activate`);
    expect(t.s.raw).toBe(true);
    t.s.key('\r');
    t.s.key('~');
    t.s.key('~');
    t.s.key('.');
    expect(t.s.frame.kind).toBe('jump');
    t.s.exec(`ipmitool -I lanplus -H ${h}-bmc -U admin -E sol activate`);
    t.s.key('\r');
    t.s.key('~');
    t.s.key('.');
    expect(t.s.frame.kind).toBe('laptop');
  });
  it('power cycle + F2 enters BIOS and boot order can be saved', () => {
    const t = setup('hw-psu');
    const h = t.dev().hostname;
    t.api.dispatch({ type: 'setFlag', name: 'x' });
    // drain first to avoid penalty noise
    t.s.exec(`ipmitool -I lanplus -H ${h}-bmc -U admin -E sol activate`);
    t.api.dispatch({ type: 'bmcPower', deviceId: t.dev().id, op: 'cycle' });
    t.tick(5);
    expect(strip(t.s.tick())).toContain('Generic Hyperscale BIOS');
    t.s.key('\x1bOQ');
    t.tick(400);
    const screen = strip(t.s.tick());
    expect(screen).toContain('BIOS Setup Utility');
    expect(t.s.frame.kind).toBe('bios');
    t.s.key('\x1b[21~');
    expect(t.s.frame.kind).toBe('sol');
    t.tick(60);
    expect(t.w.devices[t.dev().id].os).toBe('up');
  });
});
