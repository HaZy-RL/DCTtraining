// M4 — Out-of-band management: BMC, IPMI, Redfish, SOL, BIOS.
import { KIND_LABEL } from '../engine/catalog';
import { injectBmcHung, injectFault, injectPxeBoot } from '../engine/faults';
import { makeTicket } from '../engine/procedure';
import type { ScenarioDef } from '../engine/scenario';
import { addSel } from '../engine/sim';
import type { FailureMode } from '../engine/types';
import { pickServer, standardWorld } from './common';
import { finding, findingStep, noPenaltyStep, statusStep, worklogStep } from './helpers';

const TOOLS = ['ticket', 'terminal', 'bmc', 'assets', 'notes'] as const;

export const oobScenarios: ScenarioDef[] = [
  {
    id: 'oob-triage',
    module: 'oob',
    title: 'Remote triage: what failed?',
    summary: 'A host is unhealthy. Using only the BMC (web UI, ipmitool or Redfish), identify the failed part and order a replacement — without walking to the floor.',
    difficulty: 2,
    tags: ['bmc', 'sel', 'ipmitool', 'remote'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const pool: Array<[FailureMode, 'hx-2208c' | 'hx-2412s']> = [
        ['psu_failed', 'hx-2208c'],
        ['fan_failed', 'hx-2208c'],
        ['dimm_uce', 'hx-2208c'],
        ['hdd_failed', 'hx-2412s'],
        ['cmos_low', 'hx-2208c'],
      ];
      const [mode, model] = s.rng.pick(pool);
      const dev = pickServer(s, model);
      const fault = injectFault(s.w, s.rng, dev, mode);
      const slot = fault.slot!;
      const part = dev.slots[slot]!;
      const tk = makeTicket(s.w, s.rng, dev, {
        priority: 'P3',
        type: 'Investigation',
        summary: `[HEALTH] ${dev.hostname} hardware health CRITICAL`,
        description: `Fleet health reports ${dev.hostname} as CRITICAL. No further detail from automation.\n\nDCO: triage remotely via the BMC (${dev.hostname}-bmc / ${dev.bmc.ip}), identify the failed component, request the correct part and update the ticket.`,
      });
      return {
        world: s.w,
        title: 'Remote triage: what failed?',
        briefing: `You're on the DCO desk. ${tk.key} says ${dev.hostname} is CRITICAL. Stay at your desk: use the BMC web UI, or \`ipmitool -I lanplus -H ${dev.hostname}-bmc -U admin -E sel elist\` from the jump host, to find out what failed. Then order the right part.`,
        steps: [
          statusStep(tk.key, 'In Progress', `Take ${tk.key} (In Progress)`),
          { id: 'sel', text: 'Read the System Event Log (SEL)', why: 'The SEL is the BMC\'s black box: timestamps, sensor and event. It survives OS crashes and reboots.', points: 10, required: true, done: (w) => !!w.flags[`sel_viewed:${dev.id}`] },
          { id: 'flag', text: 'Flag the failed component (BMC inventory → Flag as faulty)', points: 15, required: true, done: (w) => w.trainee.flagged.includes(`${dev.id}:${slot}`) },
          findingStep('pn', 'Record the part number of the failed component', 10),
          { id: 'request', text: 'Request the replacement part (exact PN) from the ticket', points: 10, required: true, done: (w) => !!w.flags[`part_requested:${tk.key}:${part.partNumber}`] },
          statusStep(tk.key, 'Waiting for Part', 'Move the ticket to Waiting for Part', 5),
          worklogStep(tk.key, [slot, part.serial], 'Worklog: which component (slot + serial) and the SEL evidence'),
          noPenaltyStep('no_reboot', ['power_off_undrained'], 'Do not power-cycle a production host while triaging', 'Rebooting "to see if it clears" destroys evidence and causes customer impact.'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'bmc',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: fault.rootCause,
        expertPath: ['Ticket → In Progress', 'BMC dashboard: which subsystem is red?', 'SEL: find the asserted critical event and its sensor/slot', 'Inventory/FRU: get the part number and serial for that slot', 'Flag the part, request the exact PN, move to Waiting for Part', `Worklog: "${KIND_LABEL[part.kind]} ${slot} S/N ${part.serial} failed per SEL <event>; requested ${part.partNumber}"`],
        bench: {
          findings: [finding('pn', `Part number of the failed ${KIND_LABEL[part.kind].toLowerCase()}`, [part.partNumber], `It was ${part.partNumber} (${slot}). Order by exact PN, not by description.`, 'e.g. PSU-1600W-AC-TI')],
        },
      };
    },
  },
  {
    id: 'oob-bmc-hung',
    module: 'oob',
    title: 'BMC unresponsive — recover it without touching the host',
    summary: 'Monitoring lost the BMC. The host is fine and in production. Recover the BMC with an in-band cold reset, without an outage.',
    difficulty: 3,
    tags: ['bmc', 'ipmitool', 'in-band', 'gotcha'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const fault = injectBmcHung(s.w, dev);
      const tk = makeTicket(s.w, s.rng, dev, {
        priority: 'P3',
        type: 'Investigation',
        summary: `[OOB] BMC unreachable: ${dev.hostname}-bmc`,
        description: `OOB monitoring cannot reach ${dev.hostname}-bmc (${dev.bmc.ip}) for 3 consecutive polls. Host is IN PRODUCTION and serving traffic.\n\nRestore BMC reachability. Do not impact the host.`,
      });
      return {
        world: s.w,
        title: 'BMC unresponsive',
        briefing: `${tk.key}: the BMC of ${dev.hostname} stopped answering. The host itself is serving production traffic. Bring the BMC back without causing an outage.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'confirm', text: 'Confirm the BMC is down (ping/ipmitool from the jump host)', points: 10, required: true, done: (w) => !!w.flags[`pinged:${dev.id}:bmc`] || !!w.log.find((l) => l.action === 'bmcPower' && !l.ok) },
          { id: 'host_ok', text: 'Confirm the host OS itself is healthy (ssh in)', why: 'The host OS can talk to its own BMC over the in-band KCS interface, even when the BMC network stack is hung.', points: 10, required: true, done: (w) => !!w.flags[`ssh:${dev.id}`] },
          { id: 'reset', text: 'Cold-reset the BMC in-band: sudo ipmitool mc reset cold', why: 'A BMC reset restarts only the management controller, not the host. Pulling AC would also "fix" it, by taking production down.', points: 20, required: true, done: (w) => !!w.flags[`bmc_reset:${dev.id}`] },
          { id: 'recovered', text: 'Wait about 90 s and verify the BMC answers again', points: 10, required: true, done: (w) => !!w.flags[`bmc_recovered:${dev.id}`] && (!!w.flags[`pinged:${dev.id}:bmc`] && w.flags[`pinged:${dev.id}:bmc`].last >= w.flags[`bmc_recovered:${dev.id}`].first) },
          noPenaltyStep('no_outage', ['unplanned_outage', 'power_off_undrained'], 'No host outage', 'An AC drain or a host power-cycle would have recovered the BMC, and caused a customer outage.', 15),
          worklogStep(tk.key, [/reset/i], 'Worklog: symptoms, what you ran, result'),
          statusStep(tk.key, 'Resolved', 'Resolve the ticket'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'terminal',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: fault.rootCause,
        expertPath: ['From the jump host: ping <host>-bmc → no reply', 'ssh <host> → the OS is up', 'sudo ipmitool mc info → KCS timeout (BMC hung)', 'sudo ipmitool mc reset cold', 'Wait ~90 s → ping <host>-bmc → replies', 'Worklog + resolve'],
      };
    },
  },
  {
    id: 'oob-panic',
    module: 'oob',
    title: 'Host hung — capture the console and power-cycle via IPMI',
    summary: 'A host stopped responding. Look at the serial console, capture what it says, power-cycle it from the BMC, and watch it boot.',
    difficulty: 2,
    tags: ['sol', 'ipmitool', 'power'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      dev.os = 'panic';
      dev.quirks.push('panicked');
      dev.drained = true;
      addSel(s.w, dev, 'OS Critical Stop', 'Run-time critical stop (kernel panic)', 'critical', 'Asserted', -900);
      const tk = makeTicket(s.w, s.rng, dev, {
        priority: 'P2',
        type: 'Break/Fix',
        summary: `[DOWN] ${dev.hostname} unresponsive`,
        description: `${dev.hostname} stopped heartbeating 15 minutes ago. Service owner has already failed it out (host is out of rotation).\n\nPlease capture the console, recover the host and report what you saw.`,
        hostState: 'Drained',
      });
      return {
        world: s.w,
        title: 'Host hung',
        briefing: `${tk.key}: ${dev.hostname} is dead to the network but the BMC is alive. Find out why, recover it, and record evidence for the service owner.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'sol', text: 'Open the serial console (ipmitool … sol activate, or BMC → Console)', why: 'The serial console shows what the OS printed last, even after the network stack died. A panic message is the most valuable evidence you can capture.', points: 15, required: true, done: (w) => !!w.flags[`sol:${dev.id}`] },
          findingStep('panic', 'Record what the console shows', 10),
          { id: 'cycle', text: 'Power-cycle the host via the BMC', points: 15, required: true, done: (w) => !!w.flags[`power_cycle:${dev.id}`] || !!w.flags[`power_on:${dev.id}`] },
          { id: 'boot', text: 'Watch it boot and confirm the OS is back', points: 10, required: true, done: (w) => !!w.flags[`os_up:${dev.id}`] },
          worklogStep(tk.key, [/panic/i], 'Worklog: console output (panic reason), action, result'),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'terminal',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: 'The kernel panicked on a fatal machine check (MCE). The console showed it; a power-cycle recovered the host. Repeat MCE panics should be escalated as a hardware ticket (likely a DIMM or CPU).',
        expertPath: ['ipmitool -I lanplus -H <host>-bmc -U admin -E sol activate', 'Read/copy the panic message ("Fatal machine check")', 'Exit SOL with ~~. (not ~.)', 'ipmitool ... chassis power cycle', 'Re-open SOL to watch POST → boot', 'Worklog the panic text; suggest HW follow-up'],
        bench: { findings: [finding('panic', 'What did the console show? (key words)', (s) => /panic|machine check|mce/i.test(s), 'Kernel panic — "Fatal machine check".', 'e.g. Kernel panic - …')] },
      };
    },
  },
  {
    id: 'oob-pxe',
    module: 'oob',
    title: 'PXE boot loop — fix the boot order in BIOS',
    summary: 'After maintenance a host loops on PXE. Use SOL to reach BIOS setup, fix the boot order and the clock, and boot the OS.',
    difficulty: 4,
    tags: ['sol', 'bios', 'boot-order', 'gotcha'],
    minutes: 8,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const fault = injectPxeBoot(s.w, dev);
      dev.quirks.push('clock_reset');
      dev.drained = true;
      const tk = makeTicket(s.w, s.rng, dev, {
        priority: 'P2',
        type: 'Break/Fix',
        summary: `[BOOT] ${dev.hostname} not booting after CMOS work`,
        description: `Previous shift replaced the CMOS battery on ${dev.hostname}. Host never came back. Provisioning sees repeated PXE requests with no boot file configured.\n\nHost is out of rotation.`,
        hostState: 'Drained',
      });
      return {
        world: s.w,
        title: 'PXE boot loop',
        briefing: `${tk.key}: after a CMOS battery swap, ${dev.hostname} won't boot its OS. Use the serial console to see what is happening and fix it in BIOS setup.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'sol', text: 'Open SOL and observe the PXE loop', points: 10, required: true, done: (w) => !!w.flags[`sol:${dev.id}`] },
          { id: 'bios', text: 'Power-cycle and press F2 during POST to enter Setup', why: 'The F2 window is only a few seconds long. Watch for "Press <F2> Setup".', points: 15, required: true, done: (w) => !!w.flags[`in_bios:${dev.id}`] },
          { id: 'order', text: 'Put "NVMe: M.2 Boot 0" first in the boot order and save (F10)', points: 15, required: true, done: (w) => w.devices[dev.id].bootOrder[0]?.startsWith('NVMe') ?? false },
          { id: 'clock', text: 'Fix the system clock (it reset to 2017)', why: 'A wrong clock breaks TLS certificates, Kerberos and log correlation. Fleet automation will reject the host.', points: 10, required: false, done: (w) => !!w.flags[`clock_fixed:${dev.id}`] },
          { id: 'boot', text: 'Confirm the OS boots', points: 10, required: true, done: (w) => !!w.flags[`os_up:${dev.id}`] },
          worklogStep(tk.key, [/boot order|boot-order|bios/i]),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'terminal',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: fault.rootCause,
        expertPath: ['sol activate → PXE-E18 loop', 'chassis power cycle (in another session, or from the BMC UI)', 'Press F2 at "Press <F2> Setup"', 'Boot tab: move M.2 Boot 0 to the top (+)', 'Main: sync the clock', 'F10 Save & Exit → watch it boot', 'Worklog: root cause = BIOS defaults after CMOS swap'],
      };
    },
  },
  {
    id: 'oob-redfish',
    module: 'oob',
    title: 'Redfish API basics',
    summary: 'Query a BMC\'s Redfish API with curl: system health, power supplies and the SEL, the way automation does.',
    difficulty: 3,
    tags: ['redfish', 'api', 'curl'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const fault = injectFault(s.w, s.rng, dev, 'psu_failed');
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P4', type: 'Investigation', summary: `[TRAINING] Redfish health check for ${dev.hostname}`, description: `Use the Redfish API on ${dev.hostname}-bmc to report system health and PSU status.\n\nExample:\ncurl -k -u admin:$IPMI_PASSWORD https://${dev.hostname}-bmc/redfish/v1/Systems/1` });
      return {
        world: s.w,
        title: 'Redfish API basics',
        briefing: 'Fleet automation talks to BMCs over Redfish (a REST API), not by clicking web UIs. Practice reading the same data the robots read.',
        steps: [
          { id: 'sys', text: 'GET /redfish/v1/Systems/1 and read Status.Health', points: 15, required: true, done: (w) => !!w.flags['used_redfish'] },
          { id: 'power', text: 'GET /redfish/v1/Chassis/1/Power', points: 15, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:power`] },
          findingStep('psu', 'Which PSU failed? (from Redfish)', 15),
          worklogStep(tk.key, [fault.slot!]),
        ],
        tools: [...TOOLS],
        scene: 'none',
        startTool: 'terminal',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: fault.rootCause,
        expertPath: [`curl -k -u admin:$IPMI_PASSWORD https://${dev.hostname}-bmc/redfish/v1/Systems/1`, `curl -k -u admin:$IPMI_PASSWORD https://${dev.hostname}-bmc/redfish/v1/Chassis/1/Power`, 'Read PowerSupplies[].Status.Health'],
        bench: { findings: [finding('psu', 'Failed PSU', [fault.slot!], `${fault.slot} reported Critical.`, 'PSU1 or PSU2')] },
      };
    },
  },
];
