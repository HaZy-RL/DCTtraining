# 02 – Architecture

## Recommended stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **TypeScript** | The sim has many interacting types (components, faults, states); strict typing prevents bugs |
| Build | **Vite** | Fast dev loop, outputs a plain static `dist/` that drops onto any web host |
| UI framework | **React 18** | Large ecosystem, works with every library below |
| State | **Zustand** (+ Immer) | Simple global store for the world state; easy snapshots for undo, replay, and save |
| Routing | **React Router** (hash or browser mode) | Hash mode works on any static host with no rewrite rules |
| 2D scenes | **SVG + Framer Motion**, **Konva** for drag-heavy benches | Crisp vector art and easy hit-testing for clicks, drags, and highlights |
| 3D scenes (selective) | **react-three-fiber + drei** | Optional 3D for chassis interiors and racks; can be dropped to 2.5D if perf or art cost is too high |
| Terminal | **xterm.js** | Real terminal look and feel; input goes to *our* simulated shell |
| Drag & drop | **dnd-kit** | Accessible DnD for cable routing, component placement, ticket boards |
| Content format | **YAML → JSON at build** with **Zod** schemas | Easy to write by hand, validated at build time so bad content fails CI |
| Persistence | **localStorage / IndexedDB** (via `idb-keyval`) | No backend needed for v1 |
| Audio | **Howler.js** | Fan spin-up, beeps, POST codes, click feedback |
| Testing | **Vitest** (engine/unit), **Playwright** (E2E) | Engine logic is pure TS and easy to unit-test |
| Lint/format | ESLint + Prettier | — |

> Alternative if 3D is unnecessary: drop r3f and do everything in SVG/Konva at 2.5D
> (isometric). That makes the bundle smaller and the art pipeline simpler. See open questions.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  APP SHELL   main menu · module picker · settings · progress    │
├─────────────────────────────────────────────────────────────────┤
│  MODULES     HW Replace · Cabling · Rack&Stack · OOB · Linux ·  │
│              Troubleshoot · Ticketing · Safety · Shift Mode     │
│   (each = a scenario selection + which tools/scenes are open)   │
├───────────────────────┬─────────────────────────────────────────┤
│  TOOLS (interactive)  │  SCENES (visual)                        │
│  • Terminal/shell     │  • DC floor map    • Rack elevation     │
│  • BMC web UI         │  • Server chassis  • Component closeup  │
│  • BMC CLI / IPMI     │  • Patch panel     • RJ45 bench         │
│  • Ticketing (Jira-ish)│ • PDU / power     • Cable tray          │
│  • Asset/CMDB lookup  │  • Parts cage / RMA desk                │
│  • Cable tester/OTDR  │                                         │
├───────────────────────┴─────────────────────────────────────────┤
│  SIMULATION ENGINE  (pure TS, no React)                         │
│  WorldState · HardwareCatalog · FaultEngine · SymptomProjectors │
│  ActionBus · ObjectiveEvaluator · Scoring · Clock · RNG(seeded) │
├─────────────────────────────────────────────────────────────────┤
│  CONTENT     scenarios/*.yaml · hardware/*.yaml · lessons/*.md  │
├─────────────────────────────────────────────────────────────────┤
│  PERSISTENCE progress · settings · in-progress save (IndexedDB) │
└─────────────────────────────────────────────────────────────────┘
```

### Key rule: tools and scenes never hold the source of truth

They **read** projections of the world state and **emit actions** to the
ActionBus (`RemoveComponent`, `RunCommand`, `TransitionTicket`, `ConnectCable`…).
The engine applies each action, updates state, and records it in an action log.
Because all changes go through the log, we get:

- consistent symptoms across every view,
- replays and an after-action review ("here's what you did, here's what an expert did"),
- deterministic tests (seeded RNG plus an action log gives the same outcome),
- save/resume.

## Simulated shell design (important subsystem)

The Linux, BMC CLI, and switch CLI are **not** real OSes. Each one is a
command interpreter over a virtual environment:

- `ShellSession` has a prompt, cwd, env, history, a virtual filesystem (`/proc`,
  `/sys`, `/var/log`, `/dev`), and a command registry.
- Each command is a small TS function: `(args, ctx) => { stdout, stderr, exit, actions[] }`.
- Output is **generated from WorldState**, so `lsblk` shows the drive that is
  actually present, `smartctl -a /dev/sdc` shows the injected reallocated sectors,
  and `ipmitool sel list` shows the fault's SEL entries.
- Supports pipes plus a basic `grep`/`less`/`head`/`tail`/`wc`, tab-completion, and `man`/`--help`.
- Unknown commands return realistic "command not found". Hint mode can suggest the right tool.
- Shell flavors: `linux` (bash-like), `bmc` (BMC SSH CLI / racadm-ish generic),
  `ipmitool` (run from a jump host), `sol` (serial console with BIOS/POST/GRUB/boot output),
  `switch` (very limited: `show interface`, `show lldp neighbors`).

## Hosting & deployment

- `npm run build` outputs a static `dist/`. Upload it to any path on the user's website.
- `base` in `vite.config.ts` is set by env var (e.g. `/dct-training/`) so it works in a subfolder.
- Hash routing by default, so no server rewrite config is needed. Switch to browser routing if the host supports SPA fallback.
- All assets are local, with no CDN dependency at runtime. Works offline as a PWA (optional, later).
- Asset budget: initial JS < 400 KB gzip. 3D models and big sprites load lazily per module.

## Folder layout

```
src/
  app/            AppShell, routes, MainMenu, ModulePicker, Settings, Progress
  engine/
    world/        types (Site, Hall, Row, Rack, Device, Component, Port, Cable), store
    catalog/      hardware definitions loader
    faults/       fault definitions, injection, propagation
    projectors/   state → BMC SEL, sensors, dmesg, smart, LEDs, POST codes, ticket text
    actions/      action types, reducer, validation (e.g. "can't pull PSU B while A is out")
    objectives/   goal checks, scoring, penalties
    scenario/     loader, runner, hint system
    shells/       shell core + command packs (linux, bmc, ipmi, sol, switch)
  tools/          Terminal, BmcWebUi, Ticketing, AssetLookup, CableTester, Clipboard/Notes
  scenes/         FloorMap, RackElevation, ChassisView, ComponentBench, PatchPanel, Rj45Bench, PduView
  modules/        one folder per training module (config + any module-specific UI)
  content/
    hardware/     servers.yaml, components.yaml, switches.yaml, cables.yaml
    scenarios/    <module>/<id>.yaml
    lessons/      short markdown lessons shown in Learn mode
  ui/             buttons, panels, toasts, tooltips, theme tokens
tests/
  engine/         unit tests (fault → symptom consistency, scoring)
  e2e/            Playwright flows per module
```
