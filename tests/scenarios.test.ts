import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MODULES, SCENARIOS } from '../src/content';
import { evaluate } from '../src/engine/scenario';
import { advance } from '../src/engine/sim';

describe('scenario registry', () => {
  it('every module has scenarios and ids are unique', () => {
    for (const m of MODULES) expect(SCENARIOS.some((s) => s.module === m.id)).toBe(true);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });
  for (const def of SCENARIOS) {
    it(`${def.id} builds for many seeds, is not trivially complete, and survives time passing`, () => {
      for (const seed of [1, 9, 123, 4567, 98765]) {
        for (const mode of ['learn', 'practice', 'challenge'] as const) {
          const inst = def.build(seed, mode);
          expect(inst.steps.length).toBeGreaterThan(0);
          const r = evaluate(inst, mode);
          expect(r.allRequired).toBe(false);
          // world must be immer-friendly and advance without throwing
          const w2 = produce(inst.world, (d) => advance(d, 1500));
          expect(w2.t).toBe(1500);
        }
      }
    });
  }
});
