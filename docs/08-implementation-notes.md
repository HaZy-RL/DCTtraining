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

## v0.2: physical work, aisles, walking, coaching

* **Fasteners** (`engine/catalog.ts` → `FASTENERS`, state in `Device.fasteners`, helpers in `engine/fasteners.ts`).
  Every part and cover is held by something the trainee works by hand: the PSU cord bail and the green release tab,
  the fan finger latch, the lid lock screw and cam latch, riser thumbscrews, the GPU bracket screw, the M.2 screw, the CMOS clip,
  the CPU load-frame lever, the four heatsink screws (loosen 4→1, torque 1→4), and the rack-ear latches. The `fastener`
  action toggles one; `removePart`/`layer` refuse while anything gating removal is still engaged; freshly inserted parts
  come back with spring catches engaged and screws loose, and the repair steps require them secured again.
  A heatsink that isn't torqued down thermally trips on power-on.
* **Aisles** (`Trainee.side`). The front of the rack (cold aisle: bays, power button, rack ears, everything inside once
  slid out) and the back (hot aisle: PSUs, cords, NIC, cables, PDUs) are different places. `walk` with a `side` goes
  round the end of the row (costs time). Rear work is refused while the server is slid out to the service position,
  because its back end is then buried mid-rack behind the cable-management arm.
* **Walking** (`app/scenes/RackScene.tsx` → `WalkController`, state in `scenes/three/walker.ts`). WASD/arrows, drag to
  look, Shift to run, V to toggle. Reaching a rack face dispatches `arrive` (no time cost: real time already passed).
  The row is solid, and opposite rows bound the aisles. In inspect mode an avatar marks where you stand.
* **Coach** (`engine/coach.ts`, `Step.coach`). Repair steps expose a live checklist of micro-actions ("flip the bail",
  "loosen screw 4") with a 3D target. Learn mode always shows it, with a gold beacon over the server and a glow on the exact
  latch or screw. Practice mode reveals it per objective with "💡 Show me how" (counts as a hint). Every non-challenge run also
  has a "📖 playbook" (the scenario's expert path).
* **Menus** use a bright theme (`body[data-theme='bright']`) with XP, levels, ranks, a streak, badges and stars
  (`app/progress.ts` → `rankOf`, `badgesOf`, `starsFor`). The play screen keeps the dark HUD over a bright data hall.

## v0.3: DCO workroom, full racks, rendering

* **DCO workroom** (`scenes/three/Workroom.tsx`) at the end of the hall, through a doorway. Locations `noc` (laptop desk)
  and `cage` (shelves + RMA station) are both "in the room" (`inRoom()` in `actions.ts`). Shifts start at the desk.
  The laptop (`play/Laptop.tsx`) is a tabbed browser with Jira, BMC, CMDB, inventory/RMA, PDU manager, etc.
* **Spares live on shelves** (`SparePart.location === 'cage'`), one labelled bin per part kind with look-alikes mixed in.
  `pickPart`/`returnPart` need you in the room; only parts on your cart can be installed. `bin` needs the RMA station.
* **Racks are full**: 19 2U nodes U3–U40 per rack, 3-phase 415 V / 32 A PDUs (`Pdu.phases`), blanking panels in empty U.
* **LOD**: only the selected / coached / cabling server is a full interactive model; the rest are one baked-texture box
  with live LEDs (`LowServer`). Cable plugs and switch ports are detailed only in the focus rack.
* **Look** (`scenes/three/Look.tsx`): environment lighting + N8AO + bloom (LEDs are pushed above 1.0) + SMAA + vignette,
  shared by every 3D scene. Post-processing only runs on High quality.

## Known limitations / next steps

* Vendor tracks (2026-10-18): Dell PowerEdge R760, HPE ProLiant DL380 Gen11, Supermicro SYS-221H/621C and Lenovo
  ThinkSystem SR650 V3, each in an 8x NVMe compute and a 12x LFF storage flavour. See "Vendor tracks" below.

## Vendor tracks

| Piece | Where |
|---|---|
| Registry: names, part numbers per generic PN, slot labels, serial / Service Tag formats, BMC product, dispatch text | `src/engine/vendors.ts` |
| Vendor parts and models are generated from the generic ones (same slot ids, so faults and grading are unchanged) | `src/engine/catalog.ts` |
| SEL → Dell Lifecycle Log IDs, HPE IML, Lenovo FQXSP events, Supermicro health log | `src/engine/vendorlog.ts` |
| SSH shells: iDRAC `racadm`, iLO SMASH CLP, XCC CLI, Supermicro SMASH-CLP; `racadm -r` on the jump host | `src/engine/shells/vendorcli.ts` |
| BMC web UI skin and log tables | `src/app/tools/BmcTool.tsx` |
| Logos (canvas recreations), vendor front panels, baked faces | `src/app/brand.tsx`, `src/app/scenes/three/VendorFront.tsx`, `common.tsx` |
| Scenarios: every hardware drill per vendor | `src/content/vendors.ts` (via `drillScenario` in `hardware.ts`) |

Part numbers, message IDs and labels follow each vendor's real style closely but are illustrative. DCT Training is
not affiliated with or endorsed by any vendor; the menu footer says so.
* The AI/GPU cluster pack (liquid cooling, InfiniBand) from Phase 7 is not started.
* The motherboard swap (moving every component) is not a drill yet.
* No accounts or cloud saves; progress lives in localStorage (export it as JSON from Settings).
* Phones get the menus and quizzes; 3D benches are designed for laptop/tablet screens.
* The three.js chunk is about 250 KB gzipped and is lazy-loaded when a scenario starts.
