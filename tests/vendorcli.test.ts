import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { vendorScenarios } from '../src/content/vendors';
import { applyAction, type Action } from '../src/engine/actions';
import { createSession } from '../src/engine/shells/packs';
import { expressServiceCode } from '../src/engine/shells/vendorcli';
import type { World } from '../src/engine/types';

function setup(id: string, seed = 7) {
  const inst = vendorScenarios.find((s) => s.id === id)!.build(seed, 'practice');
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
  return { s, dev, get w() { return w; } };
}

const strip = (x: string) => x.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

describe('vendor BMC shells', () => {
  it('Dell: ssh lands in racadm, lclog shows MEM0001 for the failed DIMM, flags the log as viewed', () => {
    const t = setup('dell-dimm');
    const { s, dev } = t;
    const h = dev().hostname;
    expect(strip(s.exec(`ssh root@${h}-bmc`))).toContain(`Service Tag ${dev().serial}`);
    expect(strip(s.prompt())).toBe('racadm>> ');
    expect(s.exec('lclog view -n 20')).toContain('MEM0001');
    expect(s.exec('racadm getsysinfo')).toContain(`Express Svc Code        = ${expressServiceCode(dev().serial)}`);
    expect(s.exec('hwinventory')).toContain('DIMM.Socket.');
    expect(t.w.flags[`sel_viewed:${dev().id}`]).toBeTruthy();
  });

  it('Dell: remote racadm refuses the old calvin default and works with the vaulted password', () => {
    const { s, dev } = setup('dell-psu');
    const h = dev().hostname;
    expect(s.exec(`racadm -r ${h}-bmc -u root -p calvin getsel`)).toContain("'calvin' is not the default");
    const out = s.exec(`racadm -r ${h}-bmc -u root -p $IDRAC_PASSWORD getsel`);
    expect(out).toContain('Power supply');
  });

  it('HPE: iLO CLI prompt, IML shows the power supply failure, power reports state', () => {
    const { s, dev } = setup('hpe-psu');
    s.exec(`ssh Administrator@${dev().hostname}-bmc`);
    expect(strip(s.prompt())).toBe('</>hpiLO-> ');
    expect(s.exec('show /system1/log1')).toMatch(/Power Supply Failure \(Power Supply \d\)/);
    expect(s.exec('power')).toContain('server power is currently: On');
  });

  it('Lenovo: XCC readlog uses FQXSP event ids; identify blinks the LED', () => {
    const { s, dev } = setup('lenovo-fan');
    s.exec(`ssh USERID@${dev().hostname}-bmc`);
    expect(strip(s.prompt())).toBe('system> ');
    expect(s.exec('readlog')).toMatch(/FQXSPFN0004[IGM]/);
    s.exec('identify -s on');
    expect(dev().locateLed).toBe(true);
  });

  it('Supermicro: SMASH-CLP health log names the DIMM the Supermicro way', () => {
    const { s, dev } = setup('supermicro-dimm');
    s.exec(`ssh ADMIN@${dev().hostname}-bmc`);
    expect(strip(s.prompt())).toBe('-> ');
    expect(s.exec('show /system1/log1')).toMatch(/Uncorrectable ECC @DIMM[A-H]1\(CPU[12]\)/);
  });
});
