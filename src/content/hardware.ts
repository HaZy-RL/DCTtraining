// M1 — Hardware replacement drills (one per FRU type).
import { KIND_LABEL, MODELS, partSpec } from '../engine/catalog';
import { injectFault } from '../engine/faults';
import { expertPathFor, makeTicket, repairSteps, stockCart } from '../engine/procedure';
import type { ScenarioDef } from '../engine/scenario';
import type { ComponentKind, FailureMode } from '../engine/types';
import { pickServer, standardWorld } from './common';

interface Drill {
  kind: ComponentKind;
  mode: FailureMode;
  model: 'hx-2208c' | 'hx-2412s';
  difficulty: 1 | 2 | 3 | 4 | 5;
  minutes: number;
  title: string;
  symptom: (slot: string) => string;
  tags: string[];
}

const DRILLS: Drill[] = [
  { kind: 'hdd', mode: 'hdd_failed', model: 'hx-2412s', difficulty: 1, minutes: 5, title: 'Replace a failed HDD (hot-swap)', symptom: (s) => `Drive in ${s} reported failed by storage service. Disk evacuated from pool; OK to replace hot.`, tags: ['hot-swap', 'storage', 'data-bearing'] },
  { kind: 'nvme', mode: 'nvme_missing', model: 'hx-2208c', difficulty: 2, minutes: 5, title: 'Replace an NVMe SSD (U.2 hot-swap)', symptom: (s) => `NVMe in ${s} no longer enumerates. Namespace offline; data re-replicated. Replace hot.`, tags: ['hot-swap', 'storage', 'nvme'] },
  { kind: 'psu', mode: 'psu_failed', model: 'hx-2208c', difficulty: 1, minutes: 4, title: 'Replace a failed PSU (hot-swap)', symptom: (s) => `${s} failure detected, PSU redundancy lost. Host is running on a single PSU.`, tags: ['hot-swap', 'power'] },
  { kind: 'fan', mode: 'fan_failed', model: 'hx-2208c', difficulty: 2, minutes: 5, title: 'Replace a fan module (hot-swap, lid open)', symptom: (s) => `${s} reads 0 RPM; fan redundancy lost. Replace hot. Minimize time with the lid off.`, tags: ['hot-swap', 'thermal', 'service-position'] },
  { kind: 'dimm', mode: 'dimm_uce', model: 'hx-2208c', difficulty: 3, minutes: 10, title: 'Replace a DIMM (cold)', symptom: (s) => `Uncorrectable ECC on ${s}. Host has panicked twice in 24h; BIOS has mapped the DIMM out.`, tags: ['cold', 'memory', 'esd'] },
  { kind: 'cpu', mode: 'cpu_ierr', model: 'hx-2208c', difficulty: 5, minutes: 15, title: 'Replace a CPU (cold, heatsink + socket)', symptom: (s) => `Repeated IERR / uncorrected MCE on ${s}. Board diagnostics point to the processor. Replace CPU.`, tags: ['cold', 'cpu', 'torque', 'esd'] },
  { kind: 'm2', mode: 'm2_failed', model: 'hx-2208c', difficulty: 3, minutes: 10, title: 'Replace an M.2 boot drive (cold)', symptom: (s) => `Boot mirror degraded — ${s} failed. md RAID1 running on one disk.`, tags: ['cold', 'boot', 'raid', 'data-bearing'] },
  { kind: 'nic', mode: 'nic_hw_fault', model: 'hx-2208c', difficulty: 3, minutes: 10, title: 'Replace an OCP 3.0 NIC (cold)', symptom: () => 'Host unreachable in-band. OCP NIC firmware fatal error logged by BMC. Replace NIC; update MACs in CMDB.', tags: ['cold', 'network', 'oob'] },
  { kind: 'gpu', mode: 'gpu_fell_off_bus', model: 'hx-2208c', difficulty: 4, minutes: 12, title: 'Replace a GPU on a riser (cold)', symptom: () => 'GPU in Riser1 Slot1 fell off the bus (Xid 79) and is not recovered by reset. Replace GPU.', tags: ['cold', 'gpu', 'riser'] },
  { kind: 'cmos', mode: 'cmos_low', model: 'hx-2208c', difficulty: 3, minutes: 8, title: 'Replace the CMOS battery (and fix BIOS after)', symptom: () => 'CMOS battery voltage low. Replace battery; verify BIOS clock and boot order afterwards.', tags: ['cold', 'bios', 'gotcha'] },
];

export const hardwareScenarios: ScenarioDef[] = DRILLS.map((d) => ({
  id: `hw-${d.kind}`,
  module: 'hardware',
  title: d.title,
  summary: d.symptom('the slot'),
  difficulty: d.difficulty,
  tags: d.tags,
  minutes: d.minutes,
  build: (seed, mode) => {
    const s = standardWorld(seed, { racks: 3 });
    const dev = pickServer(s, d.model);
    const fault = injectFault(s.w, s.rng, dev, d.mode);
    const slot = fault.slot!;
    s.w.meta.hlDevice = dev.id;
    s.w.meta.hlSlot = slot;
    const part = dev.slots[slot]!;
    const def = MODELS[dev.model].slots.find((x) => x.id === slot)!;
    const ticket = makeTicket(s.w, s.rng, dev, {
      priority: d.kind === 'psu' || d.kind === 'fan' ? 'P2' : 'P3',
      summary: `[HW] ${KIND_LABEL[d.kind]} ${slot} — replace | ${dev.hostname}`,
      description: `${d.symptom(slot)}\n\nComponent: ${slot}\nFailed part: ${partSpec(part.partNumber).desc}\nPart number: ${part.partNumber}\nComponent S/N: ${part.serial}\n\nSpare has been staged on the parts cart at the end of row ${s.w.racks[s.rackId].row}.`,
      labels: ['auto-generated', d.kind],
      hostState: def.hotSwap ? 'Drained' : 'In Production',
    });
    if (def.hotSwap) dev.drained = true; // hot-swap work doesn't need a drain
    stockCart(s.w, s.rng, part.partNumber, { decoys: mode === 'learn' ? 1 : 2 });
    const steps = repairSteps({ dev, slot, kind: d.kind, ticket, oldSerial: part.serial, slotKnown: true });
    if (d.kind === 'cmos') {
      steps.splice(steps.length - 3, 0, {
        id: 'bios_fix',
        text: 'After the CMOS swap, enter BIOS setup (SOL) and put M.2 Boot 0 first in the boot order',
        why: 'Pulling the CMOS battery wipes BIOS settings. Defaults put PXE first, so the host loops on PXE until you fix the boot order. Check the clock too.',
        hint: '`ipmitool ... sol activate`, power cycle, press F2 at POST → Boot tab.',
        points: 10,
        required: true,
        done: (w) => w.devices[dev.id].bootOrder[0]?.startsWith('NVMe') && !!w.flags[`os_up:${dev.id}`] && (w.flags[`os_up:${dev.id}`].last > (w.flags[`replaced_ok:${dev.id}:${slot}`]?.first ?? Infinity)),
      });
    }
    if (d.kind === 'nic') {
      steps.splice(steps.length - 2, 0, {
        id: 'cmdb_mac',
        text: 'Record the new NIC MAC addresses in the worklog (CMDB/DHCP must be updated)',
        why: 'New NIC = new MACs. If DHCP/provisioning still has the old MAC, the host will not get its IP or PXE config.',
        points: 8,
        required: false,
        done: (w) => {
          const t = w.tickets[ticket.key];
          return t.worklogs.some((l) => /([0-9A-F]{2}:){5}[0-9A-F]{2}/i.test(l.text) && l.author === w.trainee.name);
        },
      });
    }
    return {
      world: s.w,
      title: d.title,
      briefing: `You're the DCO tech on shift in ${s.w.site}. Fleet automation opened ${ticket.key} for ${dev.hostname} (${ticket.location}). ${d.symptom(slot)} Work the ticket from start to finish: confirm, swap, verify, document.`,
      steps,
      tools: ['ticket', 'terminal', 'bmc', 'assets', 'parts', 'notes'],
      scene: 'rack',
      startTool: 'ticket',
      focusDeviceId: dev.id,
      focusRackId: s.rackId,
      rootCause: fault.rootCause,
      expertPath: expertPathFor(d.kind, def.hotSwap, def.access === 'internal'),
      timeLimitSec: d.minutes * 60 * 2,
    };
  },
}));
