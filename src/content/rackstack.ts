// M3 — Rack & stack: rails, lifting, power budget, full builds, decommission.
import { MODELS } from '../engine/catalog';
import { createDevice, createRack, SITE } from '../engine/factory';
import { makeTicket } from '../engine/procedure';
import { Rng } from '../engine/rng';
import type { BuildRow, CutsheetRow, QuizItem, ScenarioDef, Step } from '../engine/scenario';
import type { Device, World } from '../engine/types';
import { cutsheetDone } from './cabling';
import { standardWorld } from './common';
import { noPenaltyStep, statusStep, worklogStep } from './helpers';

function emptyRackWorld(seed: number) {
  const s = standardWorld(seed, { racks: 2 });
  const rack = createRack('D', s.rng.int(4, 12));
  s.w.racks[rack.id] = rack;
  // ToR + OOB already installed in the new rack
  const tor = createDevice(s.rng, 'tx-4808', { hostname: `${SITE.toLowerCase()}-tor-${rack.id.toLowerCase()}`, rackId: rack.id, u: 42 });
  const oob = createDevice(s.rng, 'mx-4801', { hostname: `${SITE.toLowerCase()}-oob-${rack.id.toLowerCase()}`, rackId: rack.id, u: 41 });
  for (const [i, d] of [tor, oob].entries()) {
    s.w.devices[d.id] = d;
    rack.rails[d.u!] = { heightU: 1, holeOffset: 0 };
    d.powerCords = { PSU1: `${rack.id}-PDU-A:${i + 1}`, PSU2: `${rack.id}-PDU-B:${i + 1}` };
  }
  return { ...s, rack, tor, oob };
}

function stage(w: World, rng: Rng, model: string, rackId: string, u: number): Device {
  const role = model === 'hx-2412s' ? 'sto' : 'cmp';
  const d = createDevice(rng, model, { hostname: `${SITE.toLowerCase()}-${role}-${rackId.toLowerCase()}u${String(u).padStart(2, '0')}`, rackId: null, u: null, bmcIp: `10.250.${100 + rng.int(0, 50)}.${u + 10}` });
  d.power = 'off';
  d.os = 'down';
  d.drained = true;
  d.powerCords = { PSU1: null, PSU2: null };
  w.devices[d.id] = d;
  return d;
}

const railSteps = (rows: BuildRow[], rackId: string): Step[] =>
  rows.map((r, i) => ({
    id: `rails${i}`,
    text: `Rails for U${r.u}${r.note ? ` (${r.note})` : ''}: installed and aligned on the U boundary`,
    why: 'Each U is three holes, and the boundary between U\'s is marked on the post. Start rails one hole off and the server sits crooked, steals a hole from the U above, and the next server won\'t fit.',
    points: 8,
    required: true,
    done: (w) => {
      const rr = w.racks[rackId].rails[r.u];
      return !!rr && rr.holeOffset === 0;
    },
  }));

const mountSteps = (rows: BuildRow[], rackId: string): Step[] =>
  rows.map((r, i) => ({
    id: `mount${i}`,
    text: `Mount ${r.note || 'device'} at U${r.u}`,
    points: 8,
    required: true,
    done: (w) => w.devices[r.deviceId].rackId === rackId && w.devices[r.deviceId].u === r.u,
  }));

export const rackstackScenarios: ScenarioDef[] = [
  {
    id: 'rs-rails',
    module: 'rackstack',
    title: 'Rails, U boundaries and lifting',
    summary: 'Install rail kits at the right U and the right hole, then lift and mount three servers safely. Heaviest at the bottom.',
    difficulty: 2,
    tags: ['rails', 'u-alignment', 'lifting', 'gotcha'],
    minutes: 8,
    build: (seed) => {
      const s = emptyRackWorld(seed);
      const a = stage(s.w, s.rng, 'hx-2412s', s.rack.id, 1);
      const b = stage(s.w, s.rng, 'hx-2208c', s.rack.id, 3);
      const c = stage(s.w, s.rng, 'hx-2208c', s.rack.id, 5);
      const rows: BuildRow[] = [
        { deviceId: a.id, u: 1, note: `${a.hostname} (storage, 34 kg)` },
        { deviceId: b.id, u: 3, note: b.hostname },
        { deviceId: c.id, u: 5, note: c.hostname },
      ];
      const tk = makeTicket(s.w, s.rng, null, { priority: 'P3', type: 'Rack & Stack', summary: `[BUILD] Rack 3 nodes in ${s.rack.location}`, description: rows.map((r) => `U${String(r.u).padStart(2, '0')}–U${String(r.u + 1).padStart(2, '0')}: ${r.note}`).join('\n'), location: s.rack.location });
      return {
        world: s.w,
        title: 'Rails, U boundaries and lifting',
        briefing: `${tk.key}: rack three 2U servers into the new rack ${s.rack.location}, following the build sheet. U1 is at the bottom.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          ...railSteps(rows, s.rack.id),
          ...mountSteps(rows, s.rack.id),
          noPenaltyStep('lift', 'solo_lift', 'Team lift or lift assist for anything over 23 kg', 'A 2U server is 27–34 kg. Back injuries are the #1 injury in data centers.', 10),
          noPenaltyStep('aligned', 'rails_off', 'No crooked servers (rails off by a hole)', 'Fixing misaligned rails afterwards means de-racking the server again.', 10),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'notes'],
        scene: 'rackbuild',
        focusRackId: s.rack.id,
        rootCause: 'Build task.',
        expertPath: ['Read the build sheet: U numbers count from the bottom', 'Rails: find the U boundary marks on the post; the rail\'s bottom hook goes in the bottom hole of the U', 'Check front and rear are level', 'Lift assist on, slide in, lock'],
        bench: { build: rows, rackId: s.rack.id },
      };
    },
  },
  {
    id: 'rs-build',
    module: 'rackstack',
    title: 'Full rack build: rails to BMC ping',
    summary: 'Rack, power and cable four servers from a build sheet and cut sheet, power them on, verify OOB reachability and hand the rack over.',
    difficulty: 4,
    tags: ['build', 'cutsheet', 'power', 'end-to-end'],
    minutes: 20,
    build: (seed) => {
      const s = emptyRackWorld(seed);
      const models = ['hx-2412s', 'hx-2412s', 'hx-2208c', 'hx-2208c'];
      const devs = models.map((m, i) => stage(s.w, s.rng, m, s.rack.id, 3 + i * 2));
      const rows: BuildRow[] = devs.map((d, i) => ({ deviceId: d.id, u: 3 + i * 2, note: d.hostname }));
      const cut: CutsheetRow[] = [];
      devs.forEach((d, i) => {
        const n = i + 1;
        const lab = (u: number, p: string) => `${s.rack.id}-U${String(u).padStart(2, '0')}-${p}`;
        const u = 3 + i * 2;
        cut.push({ a: { deviceId: d.id, port: 'nic0p0' }, b: { deviceId: s.tor.id, port: `swp${n}` }, aLabel: `${lab(u, 'P0')} > ${lab(42, `SWP${n}`)}`, bLabel: `${lab(42, `SWP${n}`)} > ${lab(u, 'P0')}`, cableType: 'dac', lengthM: 2 });
        cut.push({ a: { deviceId: d.id, port: 'nic0p1' }, b: { deviceId: s.tor.id, port: `swp${n + 24}` }, aLabel: `${lab(u, 'P1')} > ${lab(42, `SWP${n + 24}`)}`, bLabel: `${lab(42, `SWP${n + 24}`)} > ${lab(u, 'P1')}`, cableType: 'dac', lengthM: 2 });
        cut.push({ a: { deviceId: d.id, port: 'bmc' }, b: { deviceId: s.oob.id, port: `mgmt${n}` }, aLabel: `${lab(u, 'BMC')} > ${lab(41, `MGMT${n}`)}`, bLabel: `${lab(41, `MGMT${n}`)} > ${lab(u, 'BMC')}`, cableType: 'cat6', lengthM: 2 });
      });
      const tk = makeTicket(s.w, s.rng, null, { priority: 'P3', type: 'Rack & Stack', summary: `[BUILD] ${s.rack.location}: install + cable 4 nodes`, description: `Build sheet:\n${rows.map((r) => `U${String(r.u).padStart(2, '0')}: ${r.note} (${MODELS[s.w.devices[r.deviceId].model].name})`).join('\n')}\n\nCut sheet attached. Power: PSU1→A, PSU2→B. Verify every BMC answers ping from the jump host. Hand over to provisioning.`, location: s.rack.location });
      return {
        world: s.w,
        title: 'Full rack build',
        briefing: `${tk.key}: build out ${s.rack.location}. Rails, mount, power, cable, verify. The storage nodes are heavy, so they go at the bottom.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          ...railSteps(rows, s.rack.id),
          ...mountSteps(rows, s.rack.id),
          { id: 'power', text: 'Every node: PSU1 → PDU-A, PSU2 → PDU-B', points: 10, required: true, done: (w) => devs.every((d) => w.devices[d.id].powerCords.PSU1?.includes('-PDU-A:') && w.devices[d.id].powerCords.PSU2?.includes('-PDU-B:')) },
          { id: 'cabled', text: 'All 12 cables per the cut sheet', points: 15, required: true, done: (w) => cut.every((r) => cutsheetDone(w, r)) },
          { id: 'labels', text: 'Every cable labelled at both ends', points: 5, required: false, done: (w) => Object.values(w.cables).filter((c) => devs.some((d) => c.a?.deviceId === d.id)).every((c) => !!w.flags[`labeled:${c.id}`]) },
          { id: 'bmc', text: 'All four BMCs answer ping from the jump host', points: 10, required: true, done: (w) => devs.every((d) => !!w.flags[`pinged:${d.id}:bmc`]) },
          noPenaltyStep('lift', 'solo_lift', 'Team lift for every server', 'All four nodes weigh more than 23 kg.', 5),
          worklogStep(tk.key, [/bmc|ping|cabled|racked/i]),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'terminal', 'cutsheet', 'pdu', 'notes'],
        scene: 'rackbuild',
        focusRackId: s.rack.id,
        rootCause: 'Build task.',
        expertPath: ['Rails for all four, aligned', 'Mount bottom-up with lift assist', 'Power cords A/B, retention clips', 'DAC P0/P1 → ToR, Cat6 BMC → OOB, label as you go', 'BMCs boot on standby power: ping <host>-bmc for each', 'Worklog, resolve'],
        bench: { build: rows, cutsheet: cut, rackId: s.rack.id },
      };
    },
  },
  {
    id: 'rs-power',
    module: 'rackstack',
    title: 'Power budget & A/B math',
    summary: 'Breaker ratings, the 80% rule, and why an A/B rack must fit on ONE side. Calculations generated fresh every time.',
    difficulty: 3,
    tags: ['power', 'math', 'pdu', '80-percent'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const r = new Rng(seed);
      const amps = r.pick([20, 30, 32]);
      const volts = r.pick([208, 230]);
      const cap = amps * volts;
      const der = Math.round(cap * 0.8);
      const nodeW = r.pick([650, 720, 800, 950]);
      const n = Math.floor(der / nodeW);
      const quiz: QuizItem[] = [
        { q: `A rack PDU is ${volts} V on a ${amps} A breaker. What is its nameplate capacity?`, options: [`${cap} W`, `${Math.round(cap * 0.8)} W`, `${amps * 120} W`, `${cap * 2} W`], answer: 0, why: `Power = V × A = ${volts} × ${amps} = ${cap} W.` },
        { q: 'What is the maximum CONTINUOUS load you should plan on that circuit?', options: [`${cap} W (100%)`, `${der} W (80%)`, `${Math.round(cap * 0.5)} W (50%)`, `${Math.round(cap * 0.9)} W (90%)`], answer: 1, why: 'Breakers are rated for 80% continuous load (NEC). Planning above that risks nuisance trips.' },
        { q: `The rack has PDU-A and PDU-B (same rating) and every server has one PSU on each. Servers draw ${nodeW} W each. How many can you install without losing redundancy?`, options: [`${n} servers`, `${n * 2} servers`, `${Math.floor(cap / nodeW)} servers`, `${Math.floor((cap * 2) / nodeW)} servers`], answer: 0, why: `If one feed fails, the other carries everything. Total load must fit in ONE PDU's 80%: ${der} W ÷ ${nodeW} W = ${n}. A common mistake is to add the two PDUs together (${n * 2}).` },
        { q: `In normal operation with ${n} servers, roughly what does each PDU carry?`, options: [`~${Math.round((n * nodeW) / 2)} W`, `~${n * nodeW} W`, `~${der} W`, '0 W on B'], answer: 0, why: 'Load shares roughly 50/50 across both PSUs, so each PDU sits under 40% of its rating. That headroom is what lets it absorb a failover.' },
        { q: 'A breaker tripped on PDU-B. Before resetting it you should…', options: ['Reset it immediately, it\'s a P1', 'Check the PDU-B load reading and what was plugged in recently; reset once; if it trips again, stop and call Facilities', 'Move all the B cords to PDU-A', 'Replace the PDU'], answer: 1, why: 'A breaker trips for a reason. Moving cords to A can overload A and drop the whole rack.' },
        { q: 'Why does it matter which outlet *bank* (L1/L2/L3) you plug into on a 3-phase PDU?', options: ['It doesn\'t', 'Balancing load across phases avoids overloading one phase and the upstream breaker', 'Only for DC power', 'Higher-numbered outlets are faster'], answer: 1, why: 'An unbalanced 3-phase PDU can trip one phase while the others are nearly idle.' },
      ];
      return {
        world: s.w,
        title: 'Power budget & A/B math',
        briefing: 'Power planning questions, with fresh numbers every run. Get at least 5 of 6.',
        steps: [{ id: 'quiz', text: 'Score at least 5/6', points: 50, required: true, done: (w) => Object.keys(w.flags).filter((k) => k.startsWith('quiz:') && k.endsWith(':correct')).length >= 5 }],
        tools: ['notes'],
        scene: 'quiz',
        rootCause: 'Knowledge check.',
        expertPath: ['P = V × A', '80% continuous', 'A/B: the whole rack must fit on one side'],
        bench: { quiz, quizPass: 5 },
      };
    },
  },
  {
    id: 'rs-decom',
    module: 'rackstack',
    title: 'Decommission a server',
    summary: 'Retire a host: verify the release, power down, uncable, pull every drive into secure destruction with chain of custody, de-rack safely, and update the records.',
    difficulty: 3,
    tags: ['decom', 'chain-of-custody', 'security'],
    minutes: 12,
    build: (seed) => {
      const s = standardWorld(seed, { racks: 1 });
      const dev = s.servers.find((d) => d.model === 'hx-2412s')!;
      dev.drained = true;
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P4', type: 'Decommission', summary: `[DECOM] Retire ${dev.hostname}`, description: `Asset ${dev.assetTag} (S/N ${dev.serial}) is end of life. Host is drained and released.\n\n1. Power down\n2. Remove all cables\n3. Remove ALL data-bearing drives → secure destruction (chain of custody)\n4. De-rack\n5. Record drive serials in this ticket`, hostState: 'Drained' });
      const driveSlots = MODELS[dev.model].slots.filter((x) => x.kind === 'hdd' || x.kind === 'm2' || x.kind === 'nvme').map((x) => x.id);
      const serials = driveSlots.map((sl) => dev.slots[sl]!.serial);
      return {
        world: s.w,
        title: 'Decommission a server',
        briefing: `${tk.key}: retire ${dev.hostname}. Every one of its 14 drives (12 HDD + 2 M.2) is data-bearing, and every one must end up in secure destruction.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'off', text: 'Power off', points: 5, required: true, done: (w) => !!w.flags[`power_off:${dev.id}`] || w.devices[dev.id].power === 'off' },
          { id: 'cords', text: 'Unplug both power cords', points: 5, required: true, done: (w) => !Object.values(w.devices[dev.id].powerCords).some(Boolean) },
          { id: 'cables', text: 'Disconnect all network cables', points: 5, required: true, done: (w) => !Object.values(w.cables).some((c) => c.a?.deviceId === dev.id || c.b?.deviceId === dev.id) },
          { id: 'drives', text: 'Remove all 14 drives (12 front HDD + 2 internal M.2)', points: 15, required: true, done: (w) => driveSlots.every((sl) => !w.devices[dev.id].slots[sl]) },
          { id: 'destroy', text: 'Every drive → secure destruction bin (none to RMA or e-waste)', points: 20, required: true, done: (w) => serials.every((sn) => w.bins.secure_destruction.some((c) => c.serial === sn)) },
          { id: 'derack', text: 'De-rack the chassis (lift assist)', points: 10, required: true, done: (w) => w.devices[dev.id].rackId === null },
          noPenaltyStep('lift', 'solo_lift', 'Team lift', 'Even with the drives out it is over 23 kg.', 5),
          worklogStep(tk.key, [serials[0], serials[serials.length - 1]], 'Worklog: list the drive serials sent to destruction (chain of custody)'),
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'terminal', 'assets', 'notes'],
        scene: 'rack',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: 'Decommission task.',
        expertPath: ['Confirm the host is drained/released', 'Graceful power off, unplug A+B', 'Uncable (keep the labels for reuse)', 'Pull 12 front HDDs + 2 internal M.2: don\'t forget the boot drives inside!', 'Log every serial; secure destruction bin', 'De-rack with lift assist; blanking panels over the gap', 'Worklog with serials; resolve'],
      };
    },
  },
];
