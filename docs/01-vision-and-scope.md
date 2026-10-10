# 01 – Vision & Scope

## Vision

Someone with no datacenter experience should be able to open the app and, after
working through it, walk onto a hyperscale floor already knowing:

- what the job feels like hour to hour (ticket queue, SLAs, handoffs),
- how to diagnose a server remotely (BMC/OOB, serial console, Linux),
- how to identify, safely remove, and replace each common field-replaceable unit (FRU),
- how to rack, stack, cable, label, and verify,
- how to document the work so the next person (or an auditor) can follow it.

The app teaches by **doing, visually**. Text explanations exist but are short
and contextual. The trainee mostly learns by clicking, dragging, typing
commands, and seeing what happens.

## Target audience

| Persona | Needs |
|---------|-------|
| **New hire / career changer** | Guided "Learn" mode, vocabulary, safety, why each step matters |
| **Junior DCT (0–1 yr)** | Practice reps on FRU swaps, Linux triage, ticket hygiene |
| **Experienced DCT** | Timed challenges, multi-fault scenarios, edge cases, interview prep |
| **Trainer / lead** (later) | Assign scenarios, view progress |

## Design principles

1. **One world, many lenses.** All tools read the same simulated state, so
   symptoms are always consistent. Nothing is a canned animation that ignores context.
2. **Process is gameplay.** Skipping ESD, not verifying the serial number, or
   pulling the wrong drive has a consequence in the sim and in the score.
3. **Vendor-neutral by default.** Generic "BMC", generic server chassis, and
   commands that mirror real tools (`ipmitool`, Redfish, `smartctl`, `nvme`,
   `lspci`, `ethtool`, `mdadm`…). Vendor skins (iDRAC/iLO/XClarity-style) are optional later.
4. **Data-driven content.** Scenarios, hardware, and faults are JSON/YAML, so
   new content doesn't need engine changes.
5. **Short loops.** One rep of most drills takes 2–10 minutes. Shift Mode is the long session.
6. **Runs anywhere.** A static site that deploys to the user's own website with no backend required for v1.

## In scope (v1 target)

- Main menu where the trainee picks a practice area (see 04).
- Learn / Practice / Challenge modes for each module.
- Simulated: datacenter floor, racks, servers, components, PDUs, ToR switch,
  patch panels, BMC web UI, BMC CLI / IPMI / Redfish, serial-over-LAN, Linux shell,
  Jira-style ticketing, asset/inventory system, RMA flow.
- Hands-on visual tasks: FRU replacement, RJ45 termination, cable routing,
  rack & stack, rail install, labeling.
- Scoring, feedback, progress saved locally.

## Out of scope (v1)

- Real VMs or real hardware connections. Everything is simulated in the browser.
- Multiplayer or leaderboards (possible later).
- Accounts or login (progress stays in the browser; optional backend later).
- Deep network engineering (BGP, switch config). We cover only what a DCT touches:
  link lights, port mapping, LLDP, optics, and basic `ip`/`ethtool`.
- Electrical work beyond what DCTs do (PDU swaps and power budgeting yes; facility electrical no).

## Success criteria

- A trainee can finish a full "ticket to closed" Shift Mode incident without hints.
- Every FRU in the catalog has a guided swap procedure and a practice version.
- Each scenario's symptoms agree across BMC, Linux, physical, and ticket views (enforced by automated tests).
- Loads fast on a normal laptop (< 3 s first meaningful paint on broadband) and works on tablets at least.
