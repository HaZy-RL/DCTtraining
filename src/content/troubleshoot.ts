// M6 — End-to-end troubleshooting: vague symptoms, red herrings, hidden root causes.
import { MODELS } from '../engine/catalog';
import { injectFault, injectLooseCord } from '../engine/faults';
import { expertPathFor, makeTicket, repairSteps, stockCart } from '../engine/procedure';
import { cableAt, cpuTemp, goodPsuCount, linkState, locationOf } from '../engine/projectors';
import type { ScenarioDef, Step } from '../engine/scenario';
import { addSel } from '../engine/sim';
import type { FailureMode } from '../engine/types';
import { pickServer, standardWorld } from './common';
import { finding, findingStep, noPenaltyStep, statusStep, worklogStep } from './helpers';

const TOOLS = ['ticket', 'terminal', 'bmc', 'assets', 'parts', 'notes'] as const;

const VAGUE: Partial<Record<FailureMode, string>> = {
  dimm_uce: 'Host rebooted unexpectedly 2x in the last 24h. Customer workloads affected.',
  hdd_failed: 'Storage service marked one disk on this node as failed; disk already evacuated.',
  psu_failed: 'Power redundancy alert for this host.',
  fan_failed: 'Cooling alert raised by fleet health.',
  nvme_missing: 'Node is missing one data SSD; capacity reduced.',
  m2_failed: 'OS reports a degraded boot device.',
  gpu_fell_off_bus: 'GPU jobs failing on this node.',
};

export const troubleshootScenarios: ScenarioDef[] = [
  {
    id: 'ts-random',
    module: 'troubleshoot',
    title: 'Mystery hardware incident',
    summary: 'A vague ticket from monitoring. Diagnose remotely, find the failed part (there may be red herrings), repair, verify and document. Different every time.',
    difficulty: 4,
    tags: ['random', 'end-to-end', 'red-herring'],
    minutes: 15,
    build: (seed) => {
      const s = standardWorld(seed);
      const pool: Array<[FailureMode, 'hx-2208c' | 'hx-2412s']> = [
        ['dimm_uce', 'hx-2208c'],
        ['hdd_failed', 'hx-2412s'],
        ['psu_failed', 'hx-2208c'],
        ['fan_failed', 'hx-2208c'],
        ['nvme_missing', 'hx-2208c'],
        ['m2_failed', 'hx-2208c'],
        ['gpu_fell_off_bus', 'hx-2208c'],
      ];
      const [mode, model] = s.rng.pick(pool);
      const dev = pickServer(s, model);
      const f = injectFault(s.w, s.rng, dev, mode);
      const slot = f.slot!;
      const part = dev.slots[slot]!;
      // Red herring: old, deasserted correctable ECC on an unrelated DIMM + a fan blip
      const herring = s.rng.pick(['DIMM_A2', 'DIMM_B6', 'DIMM_B1'].filter((x) => x !== slot));
      addSel(s.w, dev, `Memory ${herring}`, 'Correctable ECC | Asserted', 'warning', 'Asserted', -86400 * 9);
      addSel(s.w, dev, `Memory ${herring}`, 'Correctable ECC', 'info', 'Deasserted', -86400 * 9 + 60);
      addSel(s.w, dev, 'Fan FAN2', 'Lower Non-critical going low', 'warning', 'Asserted', -86400 * 3);
      addSel(s.w, dev, 'Fan FAN2', 'Lower Non-critical going low', 'info', 'Deasserted', -86400 * 3 + 20);
      const def = MODELS[dev.model].slots.find((x) => x.id === slot)!;
      if (def.hotSwap) dev.drained = true;
      const tk = makeTicket(s.w, s.rng, dev, {
        priority: 'P2',
        type: 'Break/Fix',
        summary: `[FLEET] ${dev.hostname}: ${VAGUE[mode]?.split('.')[0]}`,
        description: `${VAGUE[mode]}\n\nNo component identified by automation. DCO: diagnose, repair and verify.`,
        hostState: def.hotSwap ? 'Drained' : 'In Production',
      });
      stockCart(s.w, s.rng, part.partNumber, { decoys: 2 });
      return {
        world: s.w,
        title: 'Mystery hardware incident',
        briefing: `${tk.key} landed in your queue: "${VAGUE[mode]}" for ${dev.hostname}. Nobody has told you which part. Work it out from the evidence, and watch out for old events that have nothing to do with this incident.`,
        steps: repairSteps({ dev, slot, kind: part.kind, ticket: tk, oldSerial: part.serial, slotKnown: false }),
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'ticket',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: `${f.rootCause} (Red herrings: a 9-day-old correctable ECC on ${herring} and a 3-day-old fan blip, both already deasserted.)`,
        expertPath: ['Read the SEL and focus on recent, still-Asserted critical events', 'Ignore old events that have since Deasserted', 'Correlate with Linux (dmesg / smartctl / mdstat / nvidia-smi)', ...expertPathFor(part.kind, def.hotSwap, def.access === 'internal').slice(3)],
      };
    },
  },
  {
    id: 'ts-loose-cord',
    module: 'troubleshoot',
    title: 'PSU redundancy lost… or is it?',
    summary: 'BMC says a PSU lost AC input. The cart has a spare PSU. Do you need it?',
    difficulty: 2,
    tags: ['power', 'gotcha', 'check-the-simple-stuff'],
    minutes: 5,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const psu = s.rng.pick(['PSU1', 'PSU2'] as const);
      const f = injectLooseCord(s.w, dev, psu);
      dev.drained = true;
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P2', summary: `[HW] ${psu} redundancy lost — replace PSU | ${dev.hostname}`, description: `${psu} reporting AC lost. Automation suggests PSU replacement.\nPart number: PSU-1600W-AC-TI\nSpare staged on cart.`, hostState: 'Drained' });
      stockCart(s.w, s.rng, 'PSU-1600W-AC-TI', { decoys: 1 });
      const replaced = (w: Parameters<Step['done']>[0]) => !!w.flags[`removed:${dev.id}:${psu}`];
      return {
        world: s.w,
        title: 'PSU redundancy lost… or is it?',
        briefing: `${tk.key}: automation wants ${psu} on ${dev.hostname} replaced. Before you swap hardware, find out what is actually wrong.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'check', text: 'Check the PSU sensor: "AC lost" is not the same as "Failure detected"', why: 'An "AC lost" event means the PSU sees no input. Check the cord, the PDU outlet and the breaker before you blame the PSU.', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:power`] || !!w.flags[`viewed:${dev.id}:health`] },
          { id: 'reseat', text: 'Fix the real problem at the rack', points: 20, required: true, done: (w) => !!w.flags[`cord_reseated:${dev.id}:${psu}`] },
          { id: 'no_swap', text: 'Do NOT replace a healthy PSU', why: 'Swapping a healthy part costs money, needs an RMA, and the vendor returns it "No Fault Found".', points: 15, required: false, guard: true, done: (w) => !replaced(w) },
          { id: 'redundant', text: 'Verify PSU redundancy is restored', points: 10, required: true, done: (w) => goodPsuCount(w, w.devices[dev.id]) === 2 },
          worklogStep(tk.key, [/cord|cable/i], 'Worklog: root cause (not a PSU fault) and what you did'),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'bmc',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['BMC sensors: PSU status = "AC lost", not "Failure detected"', 'Walk to the rack: the PSU LED is blinking amber (no input), not solid amber (fault)', 'Rear view: the cord is half out → reseat it and lock the retention clip', 'BMC: redundancy regained', 'Worklog: "PSU OK, cord unseated. Reseated and clipped. No part used."', 'Resolve; the spare goes back to stock'],
      };
    },
  },
  {
    id: 'ts-wrong-host',
    module: 'troubleshoot',
    title: 'The server isn\'t where the ticket says',
    summary: 'The ticket sends you to a U position, but the box there isn\'t the one in the ticket. Find the real one without touching the wrong server.',
    difficulty: 3,
    tags: ['cmdb', 'asset-verification', 'gotcha', 'locate-led'],
    minutes: 8,
    build: (seed) => {
      const s = standardWorld(seed);
      const comps = s.servers.filter((d) => d.model === 'hx-2208c');
      const [real, decoy] = s.rng.shuffle(comps);
      const f = injectFault(s.w, s.rng, real, 'psu_failed');
      real.drained = true;
      const staleLoc = locationOf(s.w, decoy);
      real.quirks.push(`cmdb_stale:${staleLoc}`);
      const part = real.slots[f.slot!]!;
      const tk = makeTicket(s.w, s.rng, real, {
        priority: 'P2',
        summary: `[HW] ${f.slot} failed — replace PSU | ${real.hostname}`,
        description: `${f.slot} failure detected on ${real.hostname}.\nAsset: ${real.assetTag}  S/N ${real.serial}\nLocation (CMDB): ${staleLoc}\nPart: ${part.partNumber}`,
        location: staleLoc,
        hostState: 'Drained',
      });
      stockCart(s.w, s.rng, part.partNumber, { decoys: 1 });
      return {
        world: s.w,
        title: "The server isn't where the ticket says",
        briefing: `${tk.key}: replace ${f.slot} on ${real.hostname}, which the CMDB says is at ${staleLoc}. Verify before you touch anything.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'mismatch', text: 'Scan the asset at the ticket location and notice the mismatch', points: 15, required: true, done: (w) => !!w.flags[`mismatch_found:${decoy.id}`] },
          { id: 'hands_off', text: 'Do not work on the wrong server', points: 15, required: true, guard: true, done: (w) => !w.penalties.some((p) => p.rule === 'wrong_host') },
          { id: 'locate', text: 'Find the real server: turn on its chassis locate LED through its BMC', why: 'The BMC is bound to the physical box. Blinking it remotely is the most reliable way to find a server with a stale CMDB location.', points: 15, required: true, done: (w) => !!w.flags[`locate:${real.id}`] },
          { id: 'scan_real', text: 'Scan the blinking server to confirm it matches the ticket', points: 5, required: true, done: (w) => !!w.flags[`scanned:${real.id}`] },
          { id: 'swap', text: `Replace ${f.slot} on the correct server`, points: 15, required: true, done: (w) => { const p = w.devices[real.id].slots[f.slot!]; return !!p && p.health === 'ok' && p.serial !== part.serial; } },
          worklogStep(tk.key, [/cmdb|location/i, part.serial], 'Worklog: old PSU serial, plus the CMDB location correction (actual U)'),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'ticket',
        focusDeviceId: decoy.id,
        focusRackId: s.rackId,
        rootCause: `CMDB had ${real.hostname} at ${staleLoc}, but it is actually at ${locationOf(s.w, real)}. It was moved without a CMDB update. The box at ${staleLoc} is ${decoy.hostname}.`,
        expertPath: ['Walk to the ticket location and scan → serial mismatch: STOP', 'Comment on the ticket', `ipmitool -H ${real.hostname}-bmc chassis identify force`, 'Find the blinking blue LED in the rack and scan it → match', 'Hot-swap the PSU', 'Worklog including the CMDB location correction; turn the locate LED off'],
      };
    },
  },
  {
    id: 'ts-breaker',
    module: 'troubleshoot',
    title: 'Half the rack lost redundancy',
    summary: 'Ten hosts alert at once. It is not ten bad PSUs.',
    difficulty: 3,
    tags: ['power', 'pdu', 'breaker', 'pattern-recognition'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const rack = s.w.racks[s.rackId];
      const pdu = rack.pdus[1];
      pdu.breakerTripped = true;
      for (const d of Object.values(s.w.devices).filter((x) => x.rackId === rack.id && x.role === 'server')) {
        addSel(s.w, d, 'Power Supply PSU2', 'Power Supply AC lost | Asserted', 'critical', 'Asserted', -600);
        addSel(s.w, d, 'Power Unit', 'Redundancy Lost | Asserted', 'critical', 'Asserted', -600);
        d.drained = false;
      }
      const tk = makeTicket(s.w, s.rng, null, {
        priority: 'P1',
        type: 'Break/Fix',
        summary: `[POWER] ${s.servers.length} hosts in ${rack.location} lost PSU redundancy`,
        description: `Fleet health: every server in rack ${rack.location} reports PSU2 AC lost at the same time.\nHosts are running on PSU1 only. A second failure would take the whole rack down.`,
        location: rack.location,
      });
      return {
        world: s.w,
        title: 'Half the rack lost redundancy',
        briefing: `${tk.key} (P1): every server in ${rack.location} lost PSU2 input at the same time. Find the common cause, fast.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          findingStep('cause', 'What is the common cause?', 15),
          { id: 'walk', text: 'Go to the rack and inspect PDU-B', points: 5, required: true, done: (w) => !!w.flags[`at:${rack.id}`] },
          { id: 'reset', text: 'Check load is within the breaker rating, then reset the PDU-B breaker', why: 'Only reset a breaker when you know why it tripped and the load is under 80% of rating. If it trips again, stop and call Facilities.', points: 20, required: true, done: (w) => !!w.flags[`breaker_reset:${rack.id}:B`] },
          { id: 'restored', text: 'Verify redundancy restored on every host', points: 10, required: true, done: (w) => Object.values(w.devices).filter((d) => d.rackId === rack.id && d.role === 'server').every((d) => goodPsuCount(w, d) === 2) },
          noPenaltyStep('no_swaps', ['pulled_healthy_drive'], 'No unnecessary PSU swaps', 'Ten simultaneous alerts point to one shared upstream cause.', 5),
          worklogStep(tk.key, [/breaker|pdu/i]),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS, 'pdu'],
        scene: 'rack',
        startTool: 'ticket',
        focusRackId: s.rackId,
        rootCause: `The ${pdu.id} breaker tripped. Every server's PSU2 is fed from PDU-B, so all of them lost redundancy at once.`,
        expertPath: ['Many hosts, same PSU, same timestamp → shared upstream cause', 'Walk to the rack → PDU-B display is dark / breaker tripped', 'Check the PDU-A load: can it carry the whole rack? Is the B load sane?', 'Reset the PDU-B breaker', 'Verify redundancy in the BMC on a couple of hosts', 'Worklog; notify Facilities if it trips again'],
        bench: { findings: [finding('cause', 'Common cause', (x) => /pdu|breaker|b side|b-side|feed/i.test(x), `${pdu.id} breaker tripped.`, 'e.g. ...')] },
      };
    },
  },
  {
    id: 'ts-link',
    module: 'troubleshoot',
    title: 'Link down: cable, port, or config?',
    summary: 'A server NIC link is down. It could be a bad cable, the wrong switch port, or a port disabled on the switch. Each has a different correct fix.',
    difficulty: 4,
    tags: ['network', 'cabling', 'escalation', 'switch'],
    minutes: 10,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const cable = cableAt(s.w, dev.id, 'nic0p0')!;
      const tor = s.w.devices[cable.b!.deviceId];
      const rightPort = cable.b!.port;
      const variant = s.rng.pick(['damaged', 'wrong_port', 'admin_down'] as const);
      let rc = '';
      if (variant === 'damaged') {
        cable.condition = 'damaged';
        rc = `The DAC between ${dev.hostname} eth0 and ${tor.hostname} ${rightPort} was crushed. Replacing the cable fixed it.`;
      } else if (variant === 'wrong_port') {
        const wrong = `swp${40 + s.rng.int(0, 7)}`;
        cable.b = { deviceId: tor.id, port: wrong };
        tor.quirks.push(`admin_down:${wrong}`);
        rc = `Someone plugged eth0's cable into ${wrong} (unprovisioned, admin-down) instead of ${rightPort}. The label still says ${rightPort}.`;
      } else {
        tor.quirks.push(`admin_down:${rightPort}`);
        rc = `${tor.hostname} ${rightPort} was administratively disabled by a NetEng change (CHG-88213). The cabling was fine, so this is a NetEng issue and DCO escalates.`;
      }
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Cabling', summary: `[NET] eth0 link down on ${dev.hostname}`, description: `eth0 on ${dev.hostname} has been down for 40 minutes. bond0 running on eth1.\nExpected: ${dev.hostname}:eth0 → ${tor.hostname}:${rightPort} (per cut sheet)` });
      const linkUp = (w: Parameters<Step['done']>[0]) => linkState(w, dev.id, 'nic0p0').up;
      const fix: Step =
        variant === 'admin_down'
          ? { id: 'fix', text: 'Escalate to NetEng with evidence. Do not re-cable a correctly cabled port', points: 25, required: true, done: (w) => Object.keys(w.flags).some((k) => k.startsWith(`escalated:${tk.key}:NetEng`)) }
          : { id: 'fix', text: 'Fix the physical problem and bring the link up', points: 25, required: true, done: linkUp };
      return {
        world: s.w,
        title: 'Link down: cable, port, or config?',
        briefing: `${tk.key}: ${dev.hostname} eth0 is down. Expected path: ${tor.hostname}:${rightPort}. Find out which layer is broken, and fix it, or hand it to the right team.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'host', text: 'Check the host side (ip link / ethtool eth0)', points: 5, required: false, done: (w) => !!w.flags[`viewed:${dev.id}:network`] },
          { id: 'switch', text: `Check the switch side (ssh ${tor.hostname} → show interface ${rightPort} / show logging)`, points: 10, required: true, done: (w) => !!w.flags[`viewed:${tor.id}:switchports`] },
          findingStep('cause', 'Root cause: (a) bad cable  (b) plugged into the wrong port  (c) port disabled on the switch', 15),
          fix,
          noPenaltyStep('no_collateral', ['switch_outage', 'unplanned_outage'], 'No collateral damage', 'Do not take down the ToR or the host while fixing one link.', 5),
          worklogStep(tk.key, [/swp|port|cable/i]),
        ],
        tools: [...TOOLS, 'cutsheet'],
        scene: 'rack',
        startTool: 'ticket',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: rc,
        expertPath: ['Host: ethtool eth0 → no link', `Switch: show interface ${rightPort} → admin up or down? show logging`, 'At the rack: trace the cable from eth0 and read the label', 'Bad cable → replace; wrong port → move it to the labeled port; admin down → escalate to NetEng'],
        bench: {
          findings: [
            finding(
              'cause',
              'a, b or c',
              (x) => x.trim().toLowerCase().startsWith({ damaged: 'a', wrong_port: 'b', admin_down: 'c' }[variant]),
              rc,
            ),
          ],
        },
      };
    },
  },
  {
    id: 'ts-thermal',
    module: 'troubleshoot',
    title: 'CPU throttling after maintenance',
    summary: 'A host has run hot ever since someone worked on it yesterday. Find out what was left undone.',
    difficulty: 3,
    tags: ['thermal', 'airflow', 'shroud', 'gotcha'],
    minutes: 10,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      dev.layers.shroud = false;
      addSel(s.w, dev, 'Temp CPU0', `CPU temperature Upper Critical going high (${cpuTemp(dev, 0)}C) — throttling`, 'critical', 'Asserted', -3600);
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P2', type: 'Break/Fix', summary: `[THERMAL] ${dev.hostname} CPU throttling`, description: 'CPU thermal throttling since yesterday\'s DIMM replacement (DCO-41877). Performance degraded ~40%.' });
      return {
        world: s.w,
        title: 'CPU throttling after maintenance',
        briefing: `${tk.key}: ${dev.hostname} has been throttling since a DIMM swap yesterday. Find out why and fix it properly.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'sensors', text: 'Check temperatures and fans in the BMC', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:health`] || !!w.flags[`viewed:${dev.id}:fans`] },
          findingStep('cause', 'What is wrong? (Fans OK… look inside)', 15),
          { id: 'drain', text: 'Request a drain before opening it up', points: 10, required: true, done: (w) => !!w.flags[`drained:${tk.key}`] },
          { id: 'fix', text: 'Install the air shroud', points: 15, required: true, done: (w) => w.devices[dev.id].layers.shroud },
          { id: 'temps', text: 'Back in service with normal temperatures', points: 10, required: true, done: (w) => { const d = w.devices[dev.id]; return d.os === 'up' && d.layers.lid && cpuTemp(d, 0) < 85; } },
          worklogStep(tk.key, [/shroud/i]),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: [...TOOLS],
        scene: 'rack',
        startTool: 'bmc',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: 'The previous tech never reinstalled the air shroud after the DIMM swap. Without it, the fans can\'t force air through the heatsinks.',
        expertPath: ['BMC: CPU temps critical, all fans OK at high RPM → airflow problem, not cooling hardware', 'Request a drain → shut down → slide out → lid off → the shroud is missing (often found on top of the rack or the cart)', 'Install the shroud → lid → power on → temps normal', 'Worklog + feedback to the previous tech'],
        bench: { findings: [finding('cause', 'Cause', (x) => /shroud|baffle|air ?duct/i.test(x), 'Air shroud missing.')] },
      };
    },
  },
];
