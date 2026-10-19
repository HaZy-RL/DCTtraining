# 06 – Roadmap

> **Status (2026-10-09, v0.1):** Phases 0–6 are built and playable. Phase 7 is partly done
> (sound, Codex, accessibility basics). Vendor tracks (Dell, HPE, Supermicro, Lenovo) with BMC skins, CLIs and
> branded hardware were added 2026-10-18; the AI-cluster pack and PWA/offline are still open.
> See [08 – Implementation Notes](08-implementation-notes.md).

Phases build on each other. Each phase ends with something playable that can be
deployed to the website for testing.

## Phase 0 — Foundations (scaffold)
- Vite + React + TS project, lint/format, Vitest, Playwright, CI script.
- Configurable `base` path and a deploy script for the user's website.
- App shell: main menu, module tiles (placeholder), settings, local progress store.
- UI kit: panels, dock, split view, toasts, tooltips, theme tokens.
**Exit:** Empty but navigable app deployed at the target URL.

## Phase 1 — Engine core + first vertical slice
- World model, hardware catalog loader with Zod schemas, ActionBus, rules, objectives, scoring, seeded RNG.
- One server model (generic 2U), one rack, one fault family (**PSU** and **fan**: hot-swap, simplest).
- Scenes: rack elevation, chassis view (lid, PSU, fans).
- Tools: ticketing (minimal), BMC web UI (health + SEL + sensors).
- Learn/Practice/Challenge for "Replace PSU" and "Replace fan".
- After-action review screen.
**Exit:** A trainee can take a PSU ticket from open to closed with grading.

## Phase 2 — Terminal & Linux / OOB
- Shell core (xterm.js, parser, pipes, completion, virtual FS).
- Command packs: linux basics, hw inventory, logs, `ipmitool`, SOL console with POST/BIOS screens.
- Faults: DIMM CE/UCE, disk failure, SMART wear, NIC link down.
- Modules M4 (OOB) and M5 (Linux) playable.
**Exit:** Diagnose a DIMM failure entirely remotely, then swap it.

## Phase 3 — Full hardware catalog (M1 complete)
- All FRUs in the M1 table, with procedures, zoom benches, RAID logic, and the CPU/GPU/motherboard flows.
- Parts tray, anti-static bags, RMA bin, serial capture.
- Symptom consistency test suite across all faults.

## Phase 4 — Cabling & Rack-and-Stack (M2, M3)
- RJ45 termination bench and cable tester; keystone punch-down.
- Fiber inspect/clean, optics, port-map patching, LLDP verification.
- Rack elevation builder, rail install, power budget, full build and decom flows.

## Phase 5 — Ticketing depth, Safety, Floor (M7, M8, M9)
- Full Jira-style board, workflows, SLAs, escalations, worklog grading.
- Safety "spot the hazard" scenes and chain-of-custody flows.
- Floor map navigation and walking time; parts cage/inventory.

## Phase 6 — Troubleshooting & Shift Mode (M6, M10)
- Multi-fault/red-herring scenario generator, hidden root causes, rule-out mechanic.
- Shift Mode with a ticket queue over time, career progression, and handoff notes.

## Phase 7 — Polish & extras
- Sound, Codex, badges, PWA/offline, accessibility audit, performance pass.
- Optional: vendor-styled BMC skins, GPU/AI cluster pack (liquid cooling, InfiniBand), trainer dashboard with a backend.

## Rough effort guide
| Phase | Relative size |
|-------|---------------|
| 0 | S |
| 1 | L (engine design lives here) |
| 2 | L |
| 3 | L (mostly content and art) |
| 4 | M–L |
| 5 | M |
| 6 | M–L |
| 7 | M |
