# 05 – UX & Visual Design

## Screen map

```
Title / Splash
  └─ Main Menu
       ├─ Practice Hub  (module tiles → sub-drill picker → mode picker → difficulty)
       ├─ Shift Mode    (career profile, start shift)
       ├─ Codex         (unlocked component/tool cards, glossary, cheat sheets)
       ├─ Progress      (per-module mastery, badges, history, after-action reviews)
       └─ Settings      (audio, text size, reduced motion, colorblind mode, T568A/B default, reset data)

In-Scenario layout (desktop):
┌──────────────────────────────────────────────────────────────────┐
│ Top bar: scenario title · objectives (collapsible) · timer · hint │
├───────────────┬──────────────────────────────────────────────────┤
│ Tool dock     │                                                  │
│ (vertical)    │           MAIN SCENE / ACTIVE TOOL                │
│ ▣ Ticket      │   (rack, chassis, terminal, BMC UI, bench...)    │
│ ▣ Terminal    │                                                  │
│ ▣ BMC         │                                                  │
│ ▣ Floor map   │                                                  │
│ ▣ Assets      ├──────────────────────────────────────────────────┤
│ ▣ Notes       │ Secondary panel (split view: e.g. terminal under │
│               │ chassis, or ticket beside BMC). Resizable.       │
└───────────────┴──────────────────────────────────────────────────┘
```

- **Split view** is key: real techs look at the BMC and the ticket together.
- Tablet: dock becomes a bottom bar, and only one main view at a time.
- Phone: Learn mode and quizzes only (benches are too fiddly), with a clear notice.

## Interaction patterns

| Pattern | Used for |
|---------|----------|
| Click to inspect, hover to highlight and tooltip | Components, LEDs, ports, labels |
| Drag & drop with snap targets | DIMMs into slots, devices into U, cables to ports, wires into RJ45 order, ticket cards |
| Hold to perform (progress ring) | Crimping, unscrewing, latch release; makes actions feel physical without being tedious |
| Typing | Terminal, worklogs, labels |
| Context radial / action menu | Physical actions on a selected object (Pull, Push, Unlatch, Locate LED) |
| Flag as faulty | Trainee marks their diagnosis (graded) |

Feedback: subtle sound plus a micro-animation on success; a "bonk" and red flash
on an invalid action, with a reason ("Host is powered on").

## Art direction

- **Style:** Clean, semi-realistic flat/isometric vector illustration in a
  "technical manual meets game" look. Readable at a glance, recognizable to real
  techs (blue/orange touchpoints, amber fault LEDs, green link lights), not photoreal.
- **Palette:** Dark UI chrome (DC floors are dim; also easier on the eyes). Hardware
  in neutral greys. Strong semantic colors for LEDs and states: green OK, amber
  warning, red critical, blue identify/locate.
- **Scenes:**
  - *Floor map:* top-down isometric halls, hot/cold aisles, clickable racks.
  - *Rack:* front and rear elevation, U numbers, real LED states, animated server slide-out.
  - *Chassis:* top-down cutaway with layers (lid → shroud → components).
  - *Benches:* large close-ups (RJ45, fiber endface scope, CPU socket, DIMM notch).
- **Motion:** Purposeful (fans spin by RPM, LEDs blink at real rates, servers slide).
  Honors `prefers-reduced-motion`.
- **Sound:** Fan whoosh on power-on, POST beep codes (also a teaching point), click
  latches, ambient DC hum (toggleable).

## Asset pipeline

- SVG components built from a small reusable library (screw, latch, LED, port, slot)
  so new server models are mostly composition plus a YAML layout.
- If 3D is chosen: low-poly GLB models, one per chassis type, components as named
  meshes the engine can address (`dimm_A1`), loaded lazily.
- Generic, unbranded hardware and UIs (no vendor logos or trademarks).

## Accessibility

- Every drag interaction has a keyboard alternative (select, then choose target).
- LED and state colors always pair with an icon or label (colorblind mode adds patterns).
- Text scaling; terminal font size setting; screen reader labels on scene objects.
- No timed pressure in Learn or Practice modes.

## Onboarding

First launch: a 3-minute tutorial ticket ("replace a failed fan") that touches the
ticket, BMC, floor map, chassis, and closing the ticket. It teaches the UI by doing a real task.
