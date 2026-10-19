import { describe, expect, it } from 'vitest';
import { decoysFor, MODELS, partSpec, slotLabel } from '../src/engine/catalog';
import { injectFault } from '../src/engine/faults';
import { vendorEvent } from '../src/engine/vendorlog';
import { VENDOR_IDS, VENDORS } from '../src/engine/vendors';
import { pickServer, standardWorld } from '../src/content/common';

describe('vendor hardware', () => {
  for (const v of VENDOR_IDS) {
    it(`${v}: every generic part has a vendor version and models only use ${v} parts`, () => {
      const info = VENDORS[v];
      for (const form of ['compute', 'storage'] as const) {
        const m = MODELS[info.models[form].id];
        expect(m.vendor).toBe(v);
        for (const pn of Object.values(m.defaultParts)) expect(partSpec(pn!).vendor).toBe(v);
        // the default boot SSD fits the vendor's M.2 carrier
        expect(partSpec(m.defaultParts.m2!).formFactor).toBe(m.slotFormFactor.m2);
      }
    });

    it(`${v}: decoys stay within the vendor and every decoy has a gotcha`, () => {
      const m = MODELS[VENDORS[v].models.compute.id];
      for (const pn of Object.values(m.defaultParts)) {
        for (const d of decoysFor(pn!)) {
          expect(partSpec(d).vendor).toBe(v);
          expect(partSpec(d).gotcha).toBeTruthy();
        }
      }
    });

    it(`${v}: a rack of ${v} servers gets vendor serials, BMC firmware and log wording`, () => {
      const s = standardWorld(42, { vendor: v });
      const dev = pickServer(s, VENDORS[v].models.compute.id);
      expect(dev.bmc.mac.startsWith(VENDORS[v].oui)).toBe(true);
      injectFault(s.w, s.rng, dev, 'dimm_uce', 'DIMM_A3');
      const ev = dev.sel.map((e) => vendorEvent(dev, e));
      const uce = ev.find((e) => /ncorrectable|Multi-bit/.test(e.text))!;
      expect(uce).toBeTruthy();
      expect(uce.text).toContain(v === 'supermicro' ? 'DIMMC1(CPU1)' : slotLabel(dev.model, 'DIMM_A3').replace('Proc 1 DIMM 3', 'Processor 1, DIMM 3'));
    });
  }

  it('Dell: Service Tag is 7 characters, MEM0001 for multi-bit errors, PPID part serials', () => {
    const s = standardWorld(7, { vendor: 'dell' });
    const dev = pickServer(s, 'dell-r760');
    expect(dev.serial).toMatch(/^[0-9A-Z]{7}$/);
    expect(dev.slots.PSU1!.serial).toMatch(/^CN0[A-Z0-9]{5}/);
    injectFault(s.w, s.rng, dev, 'dimm_uce', 'DIMM_B2');
    expect(dev.sel.map((e) => vendorEvent(dev, e).code)).toContain('MEM0001');
  });

  it('Lenovo events use FQXSP ids with a severity suffix', () => {
    const s = standardWorld(7, { vendor: 'lenovo' });
    const dev = pickServer(s, 'lnv-sr650v3');
    injectFault(s.w, s.rng, dev, 'psu_failed', 'PSU2');
    const codes = dev.sel.map((e) => vendorEvent(dev, e).code!);
    expect(codes.every((c) => /^FQXSP[A-Z]{2}\d{4}[IGM]$/.test(c))).toBe(true);
  });
});
