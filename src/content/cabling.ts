// M2 — Cabling & termination.
import { addCable, createDevice, SITE } from '../engine/factory';
import { makeTicket } from '../engine/procedure';
import { cableAt, linkState } from '../engine/projectors';
import type { CutsheetRow, ScenarioDef, Step } from '../engine/scenario';
import type { Cable, World } from '../engine/types';
import { standardWorld } from './common';
import { noPenaltyStep, statusStep, worklogStep } from './helpers';

export function cutsheetDone(w: World, r: CutsheetRow): boolean {
  return Object.values(w.cables).some(
    (c) =>
      !!c.a &&
      !!c.b &&
      ((c.a.deviceId === r.a.deviceId && c.a.port === r.a.port && c.b.deviceId === r.b.deviceId && c.b.port === r.b.port) ||
        (c.b.deviceId === r.a.deviceId && c.b.port === r.a.port && c.a.deviceId === r.b.deviceId && c.a.port === r.b.port)),
  );
}

export const cablingScenarios: ScenarioDef[] = [
  {
    id: 'cb-rj45',
    module: 'cabling',
    title: 'Terminate an RJ45 patch cable (T568B)',
    summary: 'Strip, untwist, arrange, trim, crimp and test a Cat6 cable on the bench. The tester catches split pairs that a simple continuity check misses.',
    difficulty: 2,
    tags: ['rj45', 't568b', 'crimp', 'tester'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const flagStep = (id: string, text: string, flag: string, points: number, why?: string, required = true): Step => ({ id, text, why, points, required, done: (w) => !!w.flags[flag] });
      return {
        world: s.w,
        title: 'Terminate an RJ45 patch cable',
        briefing: 'The OOB switch needs a custom-length Cat6 patch. Terminate both ends to T568B and prove it on the cable tester. Wire order: white/orange, orange, white/green, blue, white/blue, green, white/brown, brown.',
        steps: [
          flagStep('strip', 'Strip about 25 mm of jacket without nicking the conductors', 'rj45:strip_ok', 10, 'Nicked insulation causes intermittent shorts that pass a quick test and fail weeks later.'),
          flagStep('orderA', 'End A: arrange the 8 wires in T568B order', 'rj45:order_ok:A', 15),
          flagStep('untwist', 'Keep untwisting to 13 mm or less and trim the wires flush', 'rj45:untwist_ok', 10, 'Cat6 performance depends on the twists. Too much untwist causes NEXT (crosstalk) failures on a certification test.'),
          flagStep('jacket', 'Jacket goes inside the connector under the strain-relief wedge', 'rj45:jacket_ok', 5, 'If the crimp only grips bare wires, the cable pulls apart the first time someone tugs it.', false),
          flagStep('crimpA', 'Crimp end A', 'rj45:crimped:A', 5),
          flagStep('orderB', 'End B: same T568B order (straight-through)', 'rj45:order_ok:B', 15),
          flagStep('crimpB', 'Crimp end B', 'rj45:crimped:B', 5),
          flagStep('test', 'Cable tester: PASS (wiremap 1-8 ↔ 1-8, no split pairs)', 'rj45:test_pass', 20),
        ],
        tools: ['notes'],
        scene: 'rj45',
        rootCause: 'Bench exercise.',
        expertPath: ['Strip ~25 mm', 'Fan out the pairs, then straighten them', 'T568B: W/O O W/G B W/B G W/Br Br (pin 1 → 8), clip facing away from you', 'Trim flush to ~13 mm, push until every conductor reaches the end of the connector', 'Jacket under the strain relief', 'Crimp, do the other end the same, then test'],
        bench: { rj45: { standard: 'B', bothEnds: true } },
      };
    },
  },
  {
    id: 'cb-fiber',
    module: 'cabling',
    title: 'Fiber: inspect, clean, connect',
    summary: 'Patch a 100G uplink with MMF. Inspect before you connect, every time. Get the polarity right. Never look into the end.',
    difficulty: 3,
    tags: ['fiber', 'cleaning', 'polarity', 'optics'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const tor = Object.values(s.w.devices).find((d) => d.rackId === s.rackId && d.role === 'switch')!;
      const spine = createDevice(s.rng, 'tx-4808', { hostname: `${SITE.toLowerCase()}-spine-01`, rackId: null, u: null });
      spine.quirks.push('external_powered');
      s.w.devices[spine.id] = spine;
      const cable: Cable = addCable(s.w, { type: 'fiber_mmf', a: null, b: { deviceId: spine.id, port: 'swp1' }, lengthM: 30, condition: 'dirty', labelA: `${s.rackId}-U42-SWP49`, labelB: 'SPINE01-SWP1' });
      const polarityFlipped = s.rng.chance(0.5);
      const tk = makeTicket(s.w, s.rng, tor, { priority: 'P3', type: 'Cabling', summary: `[CABLING] Patch uplink ${tor.hostname}:swp49 → spine-01:swp1`, description: 'New 100G-SR4 uplink. Fiber trunk is pulled and labelled; connect the ToR end and verify light levels.' });
      return {
        world: s.w,
        title: 'Fiber: inspect, clean, connect',
        briefing: `${tk.key}: connect the new MMF uplink into ${tor.hostname} swp49. The fiber jumper is in the tray, already labelled at the far end. Use the inspection scope.`,
        steps: [
          { id: 'eye', text: 'Never look into a fiber connector with the naked eye', why: 'High-power lasers (and especially MPO trunks) are invisible infrared. They can cause permanent retina damage. Use the scope, which has filters.', points: 10, required: false, guard: true, done: (w) => !w.penalties.some((p) => p.rule === 'fiber_eye') },
          { id: 'inspect', text: 'Inspect the end-face with the scope', points: 10, required: true, done: (w) => !!w.flags['fiber:inspected'] },
          { id: 'clean', text: 'Clean the end-face (one-click cleaner) and re-inspect until clean', why: 'One speck of dust on a 50 µm core can cost several dB, cause CRC errors, and burn into the end-face permanently once powered.', points: 15, required: true, done: (w) => !!w.flags['fiber:inspected_clean'] && w.cables[cable.id]?.condition === 'ok' },
          { id: 'polarity', text: 'Check polarity: Tx must land on Rx (A→B)', points: 15, required: true, done: (w) => !!w.flags['fiber:polarity_ok'] },
          { id: 'connect', text: 'Insert into the optic until it clicks', points: 10, required: true, done: (w) => !!w.cables[cable.id]?.a },
          { id: 'verify', text: `Verify Rx light / link on the switch (show interface transceiver swp49)`, points: 10, required: true, done: (w) => !!w.flags[`viewed:${tor.id}:switchports`] && linkState(w, tor.id, 'swp49').up },
          noPenaltyStep('dirty_connect', ['fiber_dirty_connect'], 'Never connect a dirty connector', 'Mating a dirty connector transfers the dirt to the optic, so now two parts need cleaning or replacing.', 10),
          worklogStep(tk.key, [/swp49|rx|dbm|light/i]),
        ],
        tools: ['ticket', 'terminal', 'notes'],
        scene: 'fiber',
        focusDeviceId: tor.id,
        focusRackId: s.rackId,
        rootCause: `The jumper was dirty out of the bag${polarityFlipped ? ', and the duplex clip was set to A-A (flipped polarity)' : ''}.`,
        expertPath: ['Dust cap off; never look into the end', 'Scope → dirty → clean → scope again → clean', `Polarity: ${polarityFlipped ? 'flip the duplex clip (it was A-A)' : 'A-B already correct'}`, 'Insert → click', 'ssh ToR → show interface transceiver swp49 → Rx around -2 to -3 dBm'],
        bench: { fiber: { cableId: cable.id, dirty: true, polarityFlipped } },
      };
    },
  },
  {
    id: 'cb-patch',
    module: 'cabling',
    title: 'Patch servers to a cut sheet',
    summary: 'Four freshly racked servers need their data and OOB cables. Follow the cut sheet exactly, use the right cable lengths, label both ends, then verify with LLDP.',
    difficulty: 3,
    tags: ['cutsheet', 'dac', 'labels', 'lldp'],
    minutes: 12,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const rack = s.w.racks[s.rackId];
      const tor = Object.values(s.w.devices).find((d) => d.rackId === rack.id && d.role === 'switch')!;
      const oob = Object.values(s.w.devices).find((d) => d.rackId === rack.id && d.role === 'mgmt_switch')!;
      const targets = s.servers.slice(-4);
      const rows: CutsheetRow[] = [];
      for (const d of targets) {
        for (const port of ['nic0p0', 'nic0p1', 'bmc']) {
          const c = cableAt(s.w, d.id, port)!;
          const peer = c.a!.deviceId === d.id ? c.b! : c.a!;
          rows.push({ a: { deviceId: d.id, port }, b: peer, aLabel: c.labelA ?? '', bLabel: c.labelB ?? '', cableType: c.type, lengthM: c.lengthM });
          delete s.w.cables[c.id];
        }
      }
      const tk = makeTicket(s.w, s.rng, null, { priority: 'P3', type: 'Cabling', summary: `[BUILD] Cable 4 nodes in ${rack.location} per cut sheet`, description: `Nodes ${targets.map((d) => d.hostname).join(', ')} are racked and powered. Cable per attached cut sheet; label both ends; verify LLDP.`, location: rack.location });
      return {
        world: s.w,
        title: 'Patch servers to a cut sheet',
        briefing: `${tk.key}: four new nodes in ${rack.location} need 12 cables. Open the Cut Sheet tool, go to the rack's rear view, and patch every port exactly as listed. P0 and P1 are 25G DAC to the ToR; the BMC port is Cat6 to the OOB switch.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          ...targets.map((d, i): Step => ({
            id: `node${i}`,
            text: `${d.hostname}: P0, P1 and BMC cabled exactly per the cut sheet`,
            points: 12,
            required: true,
            done: (w) => rows.filter((r) => r.a.deviceId === d.id).every((r) => cutsheetDone(w, r)),
          })),
          { id: 'labels', text: 'Label both ends of every new cable', why: 'An unlabeled cable gets unplugged by the next person tracing a problem. The label format is the cut-sheet standard: <rack>-U<nn>-<port> > <far end>.', points: 10, required: false, done: (w) => Object.values(w.cables).filter((c) => targets.some((d) => c.a?.deviceId === d.id || c.b?.deviceId === d.id)).every((c) => !!w.flags[`labeled:${c.id}`]) },
          { id: 'nowrong', text: 'No cables to ports that aren\'t on the cut sheet', points: 10, required: true, done: (w) => Object.values(w.cables).filter((c) => targets.some((d) => c.a?.deviceId === d.id || c.b?.deviceId === d.id)).every((c) => rows.some((r) => cutsheetDone({ ...w, cables: { [c.id]: c } } as World, r))) },
          { id: 'lldp', text: `Verify with LLDP (ssh ${tor.hostname} → show lldp neighbors)`, points: 10, required: true, done: (w) => !!w.flags[`viewed:${tor.id}:lldp`] },
          noPenaltyStep('lengths', 'cable_too_long', 'Use sensible cable lengths', 'Coils of extra slack block exhaust airflow and make tracing a nightmare.', 5),
          worklogStep(tk.key, [/lldp|cabled|cut ?sheet/i]),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'terminal', 'cutsheet', 'notes'],
        scene: 'rack',
        startTool: 'cutsheet',
        focusRackId: rack.id,
        rootCause: 'Build task.',
        expertPath: ['Work bottom-up, one server at a time', 'P0 → swpN, P1 → swp(N+24), both 2 m DAC; BMC → mgmtN with Cat6', 'Print labels from the cut sheet and put one on each end', 'Route through the cable managers; velcro, not zip ties', `show lldp neighbors on ${tor.hostname}; the OOB switch ${oob.hostname} shows the BMC links`],
        bench: { cutsheet: rows, rackId: rack.id },
      };
    },
  },
  {
    id: 'cb-power',
    module: 'cabling',
    title: 'Power cords: A and B feeds',
    summary: 'Three servers need power. Every server gets one cord to PDU-A and one to PDU-B, never two to the same side.',
    difficulty: 1,
    tags: ['power', 'pdu', 'redundancy'],
    minutes: 4,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const targets = s.servers.slice(-3);
      for (const d of targets) {
        d.powerCords = { PSU1: null, PSU2: null };
        d.power = 'off';
        d.os = 'down';
        d.drained = true;
      }
      const tk = makeTicket(s.w, s.rng, null, { priority: 'P3', type: 'Rack & Stack', summary: `[BUILD] Power up 3 new nodes in ${s.w.racks[s.rackId].location}`, description: `Connect power for ${targets.map((d) => d.hostname).join(', ')}. PSU1 → PDU-A, PSU2 → PDU-B. Power on and confirm the BMC comes up.`, location: s.w.racks[s.rackId].location });
      return {
        world: s.w,
        title: 'Power cords: A and B feeds',
        briefing: `${tk.key}: plug in and power on three new nodes. A/B power redundancy only works if each server is fed from both PDUs.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          ...targets.map((d, i): Step => ({
            id: `ab${i}`,
            text: `${d.hostname}: PSU1 → PDU-A and PSU2 → PDU-B`,
            points: 15,
            required: true,
            done: (w) => {
              const pc = w.devices[d.id].powerCords;
              return !!pc.PSU1?.includes('-PDU-A:') && !!pc.PSU2?.includes('-PDU-B:');
            },
          })),
          { id: 'on', text: 'Power them on and confirm the BMC is reachable', points: 15, required: true, done: (w) => targets.every((d) => w.devices[d.id].power === 'on' || w.devices[d.id].power === 'posting') },
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'terminal', 'pdu', 'notes'],
        scene: 'rack',
        focusRackId: s.rackId,
        rootCause: 'Build task.',
        expertPath: ['Rear view → PSU1 → plug into a free PDU-A outlet; engage the retention clip', 'PSU2 → PDU-B', 'Power button (or ipmitool power on once the BMC has booted)'],
      };
    },
  },
];
