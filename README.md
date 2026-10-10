# DCT Training — Hyperscale Datacenter Technician Simulator

An interactive, 3D, game-style web app that trains datacenter technicians (DCTs) for
hyperscale work: triage through the BMC/OOB network, dig through Linux, walk to the rack,
swap the failed part, cable, rack & stack, and document it all in a Jira-style ticket.

> **Status:** v0.1 is playable. 10 modules and 46 scenarios, each with Learn, Practice
> and Challenge modes. Engine tests and headless-browser E2E tests pass.

## The core idea

Every module runs on the **same simulated datacenter** (`src/engine`). A failed DIMM in
`DIMM_A1` shows up consistently everywhere you look:

| Lens | What you see |
|------|--------------|
| BMC web UI / `ipmitool sel elist` / Redfish | SEL "Uncorrectable ECC" on DIMM_A1, Memory = CRITICAL |
| Linux (`ssh` via the jump host) | EDAC lines in `dmesg`, `ras-mc-ctl --error-count`, 960 GB in `free -g` |
| Serial console (SOL) | "DIMM_A1: Uncorrectable errors recorded — DIMM mapped out" during POST |
| 3D chassis | amber fault LED next to slot A1 once the lid is off |
| Ticket | "Host rebooted unexpectedly 2x in 24h…" |

Everything you do is an **action** that goes through one reducer with real rules. Pull a
DIMM from a running host, skip the ESD strap, power off an undrained production host, send
a drive to RMA instead of secure destruction, rack a 34 kg server alone, or look into a live
fiber, and you are penalized. All of it shows up in the after-action review.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173/DCTtraining/
npm test             # 65 engine/shell/scenario tests (vitest)
npm run build        # static build in dist/ (base path /DCTtraining/)
node scripts/smoke.mjs out/     # headless browser smoke test of every scene (needs `npx playwright install chromium`)
node scripts/e2e-psu.mjs out/   # full PSU swap through the real UI, expects Gold
```

## Deploy to cloudcody.cc/DCTtraining

The site is served by FastAPI `StaticFiles(html=True)` mounted at `/` from
`/home/cody/antigrav/chorebot/backend/public`, behind a cloudflared tunnel. Deploying means copying
the build into `public/DCTtraining/`:

```bash
npm run deploy       # = scripts/deploy.sh: build, then copy dist/ → chorebot/backend/public/DCTtraining/
```

No backend changes are needed. The app uses hash routing and relative asset paths under
`/DCTtraining/`, and progress lives in the browser's localStorage. Override the target with
`DCT_DEPLOY_DIR=…`, or build for a different path with `DCT_BASE=/other/ npm run build`.

## What's inside

| Module | Scenarios |
|--------|-----------|
| 🔧 Hardware Replacement | HDD, NVMe U.2, PSU, fan, DIMM, CPU (+heatsink torque order, pin-1), M.2 boot (md RAID1), OCP NIC (MAC → CMDB), GPU on riser, CMOS (+BIOS boot-order fix) |
| 🩺 Troubleshooting | Mystery incident with red herrings, PSU "failure" that's a loose cord, wrong host / stale CMDB, tripped PDU breaker, link down (cable vs wrong port vs admin-down → NetEng), CPU throttling from a missing shroud |
| 📡 Out-of-Band / BMC | Remote SEL triage, hung BMC → in-band `mc reset cold`, kernel panic via SOL + power cycle, PXE loop → BIOS setup, Redfish API |
| 🐧 Linux for DCTs | Basics/sudo/pipes, which disk is dying (serial vs `/dev/sdX`), CE storm → DIMM label, one link down (LLDP), degraded boot mirror, GPU Xid 79, read-only root FS |
| 🔌 Cabling | RJ45 T568B crimp + wiremap tester (split-pair gotcha), fiber inspect/clean/polarity, patch to a cut sheet + labels + LLDP, A/B power cords |
| 🗄️ Rack & Stack | Rails & U-boundary holes + lifting, full rack build to BMC ping, power budget & A/B math quiz, decommission with drive chain of custody |
| 🎫 Ticketing | Queue triage (safety > P1 > SLA), audit-proof worklog, Waiting-for-Part flow, escalate a non-hardware issue |
| 🦺 Safety & Security | 3D spot-the-hazard aisle, safety/security quiz |
| 🗺️ Floor Navigation | Find the rack from a location code (3D hall), location/U/aisle quiz |
| ⏱️ Shift Mode | Day shift (DCT I) and night shift (DCT II): live queue, a P1 page, SLAs, handoff |

Simulated tools: jump host shell (`ssh`, `ping`, `ipmitool`, `curl` Redfish, `cmdb`), full
Linux host command pack, BMC SSH CLI, read-only ToR switch CLI, serial-over-LAN with live
POST output and a BIOS setup screen (`~.` vs `~~.` gotcha included), BMC web console, ticket
system, CMDB, parts cart/tray/bins, PDU panel, cut sheets, notes.

## Docs

| Doc | What it covers |
|-----|----------------|
| [01 – Vision & Scope](docs/01-vision-and-scope.md) | Audience, goals, scope |
| [02 – Architecture](docs/02-architecture.md) | Stack, layers, folder layout, hosting |
| [03 – Simulation Engine](docs/03-simulation-engine.md) | World model, faults, actions, scoring |
| [04 – Training Modules](docs/04-training-modules.md) | Module specs |
| [05 – UX & Visual Design](docs/05-ux-and-visuals.md) | Screens, interaction, art direction |
| [06 – Roadmap](docs/06-roadmap.md) | Phases and what's done |
| [07 – Open Questions](docs/07-open-questions.md) | Decisions (answered) |
| [08 – Implementation Notes](docs/08-implementation-notes.md) | How the code is organized, how to add content, known limitations |

## Code layout

```
src/
  engine/            pure TS simulation (no React)
    types.ts         world model
    catalog.ts       server/switch models, slot layouts, part numbers + look-alike decoys
    factory.ts       racks, devices, cabling, serials, MACs
    projectors.ts    world → sensors, LEDs, link state, health (single source of truth)
    sim.ts           time, power state machine, POST/boot, pending events, penalties
    actions.ts       the action reducer + all safety/process rules
    faults.ts        fault injection with consistent SEL history
    procedure.ts     standard repair-loop steps (with "why" explanations)
    scenario.ts      scenario contract + scoring (Gold/Silver/Bronze)
    shells/          simulated terminals: core, linux, ipmitool, jump/BMC/switch packs, SOL+BIOS
  content/           scenarios for all 10 modules + codex/glossary
  app/               React UI: store, screens, play HUD, tools, 3D scenes (react-three-fiber)
tests/               vitest suites
scripts/             deploy + headless smoke/E2E
```
