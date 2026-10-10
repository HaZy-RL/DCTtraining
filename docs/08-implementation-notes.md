# 08 – Implementation Notes (v0.1)

## Changes from the original plan

| Plan (docs 02/03) | What was built | Why |
|---|---|---|
| YAML content + Zod | Scenarios are typed TypeScript modules in `src/content/` | Steps are predicates over world state (`done: (w) => …`). TypeScript type-checks them at build time, which YAML+Zod could not. |
| 2.5D SVG by default | Full 3D (react-three-fiber), per doc 07 | User decision. |
| React Router | A tiny hash router in `App.tsx` | Works on the FastAPI static mount with no rewrite rules. |
| dnd-kit, Howler | Native drag (triage), WebAudio synth (`app/audio.ts`) | Fewer dependencies, no audio assets. |
| Konva benches | 3D benches (RJ45 plug, LC fiber) with 2D control panels | One rendering stack. |

## How a scenario works

```ts
// src/content/<module>.ts
export const myScenarios: ScenarioDef[] = [{
  id: 'hw-psu', module: 'hardware', title: '…', summary: '…', difficulty: 1, tags: [], minutes: 4,
  build: (seed, mode) => {
    const s = standardWorld(seed);              // 3 production racks, cabled + powered
    const dev = pickServer(s, 'hx-2208c');
    const f = injectFault(s.w, s.rng, dev, 'psu_failed');   // SEL history, health, LEDs…
    const ticket = makeTicket(s.w, s.rng, dev, { summary: '…', description: '…' });
    stockCart(s.w, s.rng, dev.slots[f.slot!]!.partNumber);  // right part + look-alike decoys
    return { world: s.w, steps: repairSteps({ … }), tools: […], scene: 'rack', … };
  },
}];
```

* **Steps** are graded every render from `world.flags` and world state. Flags are set by actions
  (`removed:<dev>:<slot>`, `ticket:<key>:In Progress`, `viewed:<dev>:memory` when you run
  `dmidecode -t memory` or open BMC → Inventory, …).
* **Guard steps** (`guard: true`) are "don't break this" rules. They only score once half the
  required work is done, so idling earns nothing.
* **Penalties** come from the reducer (`actions.ts`) and are de-duplicated per rule+key.
* **Seeds** make every run reproducible. "Retry same scenario" replays the seed, and "New
  variation" picks a new one. Linux disk names are shuffled per seed on purpose.

## Adding content

1. New fault mode → `FailureMode` in `types.ts`, a case in `faults.ts`, and projector output where
   it should show up (`linux.ts` kernel log, `ipmitool`/sensors, LEDs).
2. New part or decoy → `PARTS` in `catalog.ts` (give decoys a `gotcha` string, which is shown to the trainee).
3. New scenario → add to a module file, and it is picked up by `content/index.ts`. The test
   `tests/scenarios.test.ts` automatically builds it for 5 seeds × 3 modes.

## Real-world gotchas modeled

* Front health LED stays amber until the SEL is cleared, and clearing it without reading it is penalized.
* `/dev/sdX` and `nvmeXn1` don't follow bay order; map by serial and blink with `ledctl`.
* `ipmitool` without `-I lanplus` fails; pointing `-H` at the production hostname fails.
* `~.` in SOL kills your jump-host SSH; `~~.` exits SOL.
* Hung BMC: `sudo ipmitool mc reset cold` in-band fixes it with no host outage.
* Standby power on "off" servers: unplug both cords and drain flea power before cold swaps.
* HDD spin-down before pulling; the wrong drive in an in-service host is penalized.
* Look-alike spares: DDR5-4800 vs 5600, 32 GB vs 64 GB, -48 V DC PSU, E1.S vs U.2, 2280 vs 22110,
  SAS on SATA, QSFP NIC, mismatched CPU SKU, CR2025 vs CR2032.
* CPU: heatsink screw order, pin-1 alignment (bent pins = new motherboard).
* Memory retraining makes the first POST long, and power-cycling during it is a classic mistake.
* CMOS swap → BIOS defaults → PXE first + wrong clock → fix it in BIOS setup over SOL.
* Data-bearing drives go to secure destruction, never RMA.
* Two cords on the same PDU defeats A/B; the whole rack must fit on ONE PDU at 80%.
* Rails one hole off the U boundary; team lift over 23 kg; one server extended at a time.
* Stale CMDB location → find the box with the BMC locate LED.
* Switch config is NetEng's job; DCO's switch role is read-only, so escalate.
* Fiber: never look into the end, inspect → clean → inspect, polarity A→B.
* RJ45: a split pair passes continuity but fails the wiremap test.

## Known limitations / next steps

* Vendor-specific BMC skins (iDRAC/iLO-style) are not built yet (planned per doc 07).
* The AI/GPU cluster pack (liquid cooling, InfiniBand) from Phase 7 is not started.
* The motherboard swap (moving every component) is not a drill yet.
* No accounts or cloud saves; progress lives in localStorage (export it as JSON from Settings).
* Phones get the menus and quizzes; 3D benches are designed for laptop/tablet screens.
* The three.js chunk is about 250 KB gzipped and is lazy-loaded when a scenario starts.
