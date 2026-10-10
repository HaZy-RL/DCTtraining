# 03 – Simulation Engine

The engine is pure TypeScript with no UI dependencies. It owns the truth about
the simulated datacenter.

## 1. World model

```
Site
 └─ Hall (data hall / colo room)
     └─ Row  (hot aisle / cold aisle orientation)
         └─ Rack (42U/48U/52U, location e.g. "H2-R14-07")
             ├─ PDU A / PDU B (outlets, per-outlet load, breaker rating)
             ├─ ToR switch(es) (ports, optics, link state, LLDP)
             ├─ Patch panel(s)
             └─ Device (server / storage JBOD / GPU node / switch)
                 ├─ identity: asset tag, serial, hostname, MAC(s), BMC IP, rack U
                 ├─ power state, POST state, OS state
                 ├─ Components (FRUs)
                 │   CPU, DIMM, PSU, Fan, Drive (HDD/SATA SSD/NVMe/M.2 boot),
                 │   NIC/OCP card, GPU, Riser, RAID/HBA, BBU/supercap, TPM,
                 │   Motherboard, Backplane, BMC module, CMOS battery
                 ├─ Ports (NIC ports, BMC port, serial, USB)
                 └─ Sensors (temps, fan RPM, voltages, PSU input, intrusion)
Cable { id, type (Cat6/DAC/AOC/LC-LC SMF/MMF/MPO/power C13-C14/C19-C20),
        endpointA, endpointB, label, length, condition }
Ticket, Asset records, Parts inventory, RMA records
```

Each **Component** instance has:
`catalogId`, `slot`, `serial`, `firmware`, `health` (ok/degraded/failed),
`installed` (bool), `seated` (ok/partial), `ledState`, and type-specific fields
(e.g. DIMM: size/speed/rank; drive: SMART attributes; PSU: input/output watts).

## 2. Hardware catalog (content)

YAML definitions describe server models and the parts each one can hold, so
scenes and procedures are generated from data:

```yaml
# content/hardware/servers.yaml
- id: gen-2u-compute
  name: "Generic 2U Compute Node"
  heightU: 2
  slots:
    cpu: 2
    dimm: { count: 32, layout: "A1..A16,B1..B16", population_rules: "white-slots-first" }
    psu: { count: 2, redundancy: "1+1", hotSwap: true }
    fan: { count: 6, redundancy: "N+1", hotSwap: true }
    drive_bay: { count: 12, form: "3.5", hotSwap: true }
    m2_boot: 2
    pcie: [ { riser: 1, slots: 3 }, { riser: 2, slots: 3 } ]
    ocp: 1
  procedures:
    dimm: [power_off, drain_power, esd_strap, remove_lid, remove_air_shroud, open_latches, remove, insert, close_latches, reinstall_shroud, close_lid, power_on, verify]
```

## 3. Fault system

A **FaultDefinition** describes a failure and *how it shows up* in each lens.
**Projectors** turn active faults and state into tool output.

```yaml
# content/faults/dimm-uce.yaml
id: dimm_uncorrectable_ecc
target: { type: dimm }
severity: critical
effects:
  component.health: failed
  device.os_state: crashed_or_reboot_loop   # optional, varies by params
symptoms:
  bmc_sel:
    - "Memory #{{slot}} | Uncorrectable ECC | Asserted"
  bmc_health: { memory: critical }
  led: { target: slot, state: amber }
  dmesg:
    - "EDAC MC{{mc}}: 1 UE memory read error on CPU_SrcID#{{cpu}}_Ha#0_Chan#{{chan}}_DIMM#{{dimm}}"
  mcelog: true
  sol_post: "Memory training failure at {{slot}}"   # only when variant=post_fail
  ticket_symptom: "Host {{hostname}} rebooted unexpectedly 3x in 24h"
resolution:
  replace: { component: dimm, slot: "{{slot}}" }
  verify: [ bmc_sel_clear_or_ack, memory_count_matches, os_boots ]
```

Fault features:
- **Parameters** (`slot`, `severity`, `variant`) are randomized from a seed, so each rep is different.
- **Red herrings**: optional unrelated noise (an old correctable ECC on another DIMM, a fan briefly spiking).
- **Cascades**: one fan failed leads to thermal warnings; a second fan failed leads to CPU throttling and then a thermal shutdown on a timer.
- **Multi-fault** scenarios for advanced challenges.
- **Hidden root cause**: the symptom is in Linux (`nvme` I/O errors) but the actual cause is a bad riser or backplane, found only by swapping or by careful log reading.

Starter fault library (v1):
DIMM CE storm / UCE, failed HDD, SSD wear-out, NVMe not detected, PSU failed / PSU
input lost (cable / PDU breaker), fan failed, CPU IERR / CATERR, CMOS battery low,
RAID degraded / foreign config, NIC link down (bad cable / bad optic / wrong port /
disabled port), NIC flapping, BMC unresponsive (needs BMC reset), GPU fell off bus / XID
errors, GPU thermal, boot drive failure (GRUB rescue), kernel panic, filesystem read-only,
motherboard failure (several FRUs fine but no POST), chassis intrusion, mislabeled cable,
wrong-host mixup (ticket lists a serial that doesn't match the physical box).

## 4. Actions & rules

Everything the trainee does is an Action:

| Category | Examples |
|----------|----------|
| Physical | `WalkTo(rack)`, `PullServer(service position)`, `RemoveLid`, `RemoveComponent(slot)`, `InsertComponent(part, slot)`, `ToggleLatch`, `ConnectCable`, `DisconnectCable`, `PressPowerButton`, `ApplyESDStrap`, `ScanAssetTag`, `ApplyLabel` |
| Remote | `RunCommand(shell, line)`, `BmcUiAction(page, control)`, `PowerCycleViaBmc` |
| Process | `TransitionTicket`, `AddWorklog`, `RequestPart`, `CreateRMA`, `UpdateAsset`, `EscalateToTeam` |

The **rules engine** validates actions against reality. Example rules:
- You can't remove a DIMM while the host is powered on (allowed, but it does damage and costs points).
- No ESD strap means a chance of a "latent damage" flag and a penalty.
- Pulling the only working PSU while the other is failed means an unplanned outage and a big penalty.
- Pulling the wrong drive from a degraded RAID means data loss and a scenario fail.
- A server can't slide out if its cable management arm isn't installed or the cables are too short.
- A rack can't exceed its weight or power budget (warning, then fail).

## 5. Objectives & scoring

Each scenario declares objectives the evaluator checks after each action:

```yaml
objectives:
  - id: diagnose
    desc: "Identify the failed component"
    check: { trainee_flagged: { component: "{{fault.target}}" } }
  - id: ticket_before_work
    desc: "Move ticket to In Progress before touching hardware"
    check: { order: [ "ticket.status=In Progress", "first_physical_action" ] }
  - id: replace
    check: { component_health: { slot: "{{fault.slot}}", is: ok } }
  - id: verify
    check: { ran_any: [ "ipmitool sel list", "dmidecode -t memory", "free -g" ] }
  - id: document
    check: { ticket.worklog_contains: [ "{{old_serial}}", "{{new_serial}}" ], ticket.status: Resolved }
```

**Score** = completion + accuracy + process compliance + time bonus − penalties.
**Ratings**: Bronze / Silver / Gold. Gold requires zero safety violations and full documentation.
**After-Action Review**: timeline of the trainee's actions next to the expert path, with missed checks highlighted.

## 6. Scenario file (full shape)

```yaml
id: hw-dimm-001
module: hardware_replacement
title: "Rebooting compute node — memory?"
difficulty: 2           # 1–5
modes: [learn, practice, challenge]
seed: random
world:
  template: single-rack-compute     # prebuilt world chunk
  overrides: { rack: "H1-R03-12" }
faults:
  - use: dimm_uncorrectable_ecc
    on: { device: random_server, slot: random }
noise: [ old_correctable_ecc ]
start:
  ticket: { type: "Hardware Repair", priority: P2, from: "Fleet Health Automation" }
  location: noc_desk                 # start at the desk with BMC + terminal
tools: [ terminal, bmc_web, ticketing, asset_lookup, floor_map, chassis_view ]
hints:
  - after_seconds: 120
    text: "Check what the BMC logged before the reboots."
objectives: [ ... ]
timeLimitSec: 900                    # challenge mode only
```

## 7. Engine testing strategy

- **Symptom consistency tests**: for every fault × server model, assert that each
  projector produces output that references the same slot, serial, and host.
- **Golden-path tests**: each scenario ships with an `expert_path` action list.
  CI replays it and asserts it reaches Gold.
- **Rule tests**: each safety/process rule has a test that triggers it.
- **Fuzz**: random action sequences must never crash the engine.
