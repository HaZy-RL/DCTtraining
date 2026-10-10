# 04 – Training Modules

The main menu shows these modules as tiles. Each one supports **Learn** (guided,
step by step, explains why), **Practice** (untimed, hints on request), and
**Challenge** (timed, randomized, scored, no hints). Inside a module the trainee
can drill one sub-skill (e.g. only PSU swaps) or pick "Random".

---

## M1. Hardware Replacement (FRU swaps)

**Goal:** Safely and correctly replace any common component.

**Sub-drills** (each selectable on its own):
| Component | Hot-swap? | Key teaching points |
|-----------|-----------|---------------------|
| HDD / SATA SSD | Yes | Identify by bay/serial/locate LED, check RAID state first, never pull the wrong one in a degraded array, wait for rebuild |
| NVMe (U.2/E1.S) | Often | Hot-plug readiness, `nvme list`, namespace check |
| M.2 boot drive | No | Riser/carrier removal, mirror rebuild |
| PSU | Yes (if redundant) | Check the *other* PSU first, unplug the power cord, latch, LED states |
| Fan | Yes | Airflow direction, N+1, time limit with lid off |
| DIMM | No | Power down, drain, ESD, slot map and population rules, latches, notch alignment, post-swap memory count |
| CPU | No | Socket pins (no touching!), torque sequence, thermal paste, carrier/clip types |
| NIC / OCP / PCIe card | No | Riser removal, retention, MAC change affects config/ticket |
| GPU | No | Power cables, weight support, retention bracket, `nvidia-smi`-style verify |
| RAID controller / BBU | No | Preserve config, foreign config import |
| CMOS battery | No | BIOS settings reset implications |
| Motherboard | No | Transfer all parts, serial/asset re-binding, BMC/BIOS firmware, MAC update in CMDB |
| Backplane / riser | No | Often the hidden root cause |

**Visuals:** Chassis interior scene. Lid slides off, air shroud lifts, components
highlight on hover, latches animate, parts drag to and from a parts tray. A
"zoom bench" shows close detail (DIMM notch alignment, CPU pin-1 triangle).
**Mechanics:** Ordered procedure with a forgiving free-form mode. Wrong order or
skipped steps are logged. Old/new serial capture. The bad part goes into an
anti-static bag and RMA bin.

---

## M2. Cabling & Termination

**Sub-drills:**
1. **RJ45 termination bench.** Strip the jacket, untwist minimally, order the 8
   wires by T568B (or A), trim, insert, crimp, then verify on the cable tester.
   Drag wires into order; the tester shows a wiremap (open/short/split
   pair/reversed). Also covers keystone jack punch-down.
2. **Fiber handling.** Identify SMF/MMF by jacket color, LC/MPO connectors,
   polarity (A-to-B), *inspect and clean before connecting* (scope view shows a
   dirty vs clean endface), bend radius, dust caps.
3. **DAC/AOC & optics.** Pick the right optic for the port speed and type, seat it,
   check link lights.
4. **Patching to a port map.** Given a cut sheet, patch server NIC ports to the
   correct ToR switch ports. Verify with LLDP from Linux (`lldpctl`) or the switch view.
5. **Cable management & labeling.** Route through managers, velcro (not zip ties),
   service loops, label both ends with the standard format, keep airflow clear.
6. **Power cabling.** A-side and B-side PDU discipline, C13/C14 vs C19/C20, retention clips.

**Visuals:** Close-up bench (2D, Konva) for termination; rack-rear scene for patching and routing.

---

## M3. Rack & Stack

**Sub-drills:**
1. **Read a rack elevation.** Place devices at the correct U per the build sheet.
2. **Rail kit install.** Square-hole vs round-hole, front/rear orientation, correct
   U alignment (the U boundary trap), cage nuts.
3. **Lifting & mounting.** Weight thresholds (team lift / lift assist), heaviest at the
   bottom, server onto rails, lock, CMA.
4. **Power budget.** Sum device draw per PDU, stay under derated breaker capacity,
   balance phases, A/B redundancy.
5. **Full build.** Empty rack to racked, cabled, powered, BMC reachable, asset tags
   scanned, CMDB updated, ticket closed.
6. **Decommission.** Reverse the flow: drain host, power off, uncable, drive removal
   and chain of custody, de-rack, update CMDB.

**Visuals:** Rack elevation (front/rear toggle), drag devices into U slots, rail
alignment close-up, PDU outlet map with live load bars.

---

## M4. Out-of-Band (OOB) / BMC

**Goal:** Diagnose and recover a server without touching it.

**Teaches:** What a BMC is and how the OOB network differs from the production
network; BMC web UI (health dashboard, SEL, sensors, FRU inventory, power control,
virtual console, firmware); `ipmitool` (`chassis status`, `power cycle`, `sel list/elist`,
`sdr`, `fru`, `mc reset cold`, `sol activate`); Redfish via `curl` (later); serial
console (watch POST, enter BIOS setup, boot order, GRUB); BMC unresponsive (cold
reset, or physical AC drain as a last resort).

**Visuals:** A generic but realistic BMC web interface (fake vendor brand), a
terminal on a "jump host", and a SOL console that renders POST/BIOS screens.

---

## M5. Linux for DCTs

**Goal:** Comfort with the commands a tech uses to triage and verify hardware.

**Command packs (simulated):**
- *System/HW inventory:* `dmidecode`, `lshw`, `lscpu`, `lspci`, `lsusb`, `lsblk`, `free`, `uptime`, `hostnamectl`
- *Logs:* `dmesg`, `journalctl`, `/var/log/messages`, `mcelog`, `edac-util`
- *Storage:* `smartctl`, `nvme list/smart-log`, `mdadm --detail`, `cat /proc/mdstat`, `storcli`-like RAID tool, `df`, `mount`, `fsck` (concept)
- *Network:* `ip a`, `ip link`, `ethtool`, `ethtool -m` (optic DOM), `lldpctl`, `ping`, `ss`
- *GPU:* `nvidia-smi`-style tool, XID errors
- *Ops:* `systemctl`, `reboot`/`shutdown`, `sudo`, `ssh`, `scp` (log collection), basic `grep`/`less`/`tail -f`
- *Safety rails:* destructive commands (`dd`, `mkfs`, `wipefs`) trigger warnings and penalties in the wrong context

**Mechanics:** Mini-lessons, then "find X" puzzles (which disk has reallocated
sectors? which NIC is down? which DIMM is logging errors?), then incidents.

---

## M6. Troubleshooting (end-to-end incidents)

**Goal:** Go from a vague symptom to a verified fix using every tool.

**Loop:** Read the ticket → check monitoring/BMC → form a hypothesis → check in
Linux/SOL → identify the FRU → request the part → schedule or drain → repair → verify → document.
**Features:** Randomized faults, red herrings, hidden root causes (riser vs card,
cable vs optic vs port), "rule out" mechanic (the trainee writes the reason they
ruled something out, and it's graded on keywords). A troubleshooting flowchart
fills in as they go.

---

## M7. Ticketing & Workflow (Jira-style)

**Goal:** Ticket hygiene and process, which is a big part of how DCTs are evaluated.

**Teaches:** Ticket anatomy (summary, priority, SLA, components, assignee,
watchers, linked issues), statuses and transitions (Open → In Progress → Waiting
for Part → Resolved → Closed), good vs bad worklogs (old/new serials, steps taken,
evidence attached), escalation to the right team, linking RMA/part-request tickets,
SLA timers, change/maintenance windows, "don't work without a ticket", and handoffs at shift change.
**Visuals:** A believable but generically branded ticket tracker: board view
(drag cards between columns), ticket detail view, comment editor, SLA clock.
**Grading:** Worklog checklist (contains serials, actions, verification, no vague
"fixed it"), correct transitions, correct escalation.

---

## M8. Safety, Security & Process

ESD (strap, mat, bags); lifting; hot aisle heat and hearing protection; PPE;
lockout/tagout concepts; badge access and no tailgating; escort rules; clean desk;
**data-bearing device chain of custody** (drives never leave the secure area, shred/degauss
logs); fire suppression awareness; emergency power off (EPO) — *do not touch*; incident reporting.
**Format:** Short interactive scenes ("spot the hazard" in a photo-like scene) and
quizzes. Safety rules are also enforced inside every other module.

---

## M9. Datacenter Floor Navigation & Inventory

Reading location codes (Site-Hall-Row-Rack-U), finding a rack fast on the floor map,
locate LEDs, asset tag scanning, cycle counts in the parts cage, receiving and shipping RMAs.
Feeds Shift Mode (walking time counts on the clock).

---

## M10. Shift Mode (career / capstone)

A simulated 8–12 hour shift compressed to about 30–60 minutes:
- A ticket queue with mixed priorities arrives over time, and SLAs tick.
- The trainee chooses what to work on (prioritization is graded).
- Includes walking between racks, part requests that take time to arrive, interruptions
  (P1 page), and a handoff note at end of shift.
- Career progression: DCT I → II → III → Lead. Promotions unlock harder fault pools,
  GPU/AI clusters, and storage-dense racks.

---

## Cross-cutting: Learn content & glossary

- Glossary popovers on jargon (FRU, BMC, SEL, ToR, CMA, PDU, SOL, RMA, CMDB, POST…).
- A "Codex" unlocks illustrated cards for each component and tool as the trainee meets them.
- Quick reference sheets (T568B order, ipmitool cheatsheet, LED meanings).
