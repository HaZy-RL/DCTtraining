// M7 — Ticketing & workflow (Jira-style).
import { injectFault } from '../engine/faults';
import { makeComponent } from '../engine/factory';
import { makeTicket } from '../engine/procedure';
import { goodPsuCount, linkState } from '../engine/projectors';
import type { ScenarioDef, Step } from '../engine/scenario';
import { pickServer, standardWorld } from './common';
import { finding, findingStep, noPenaltyStep, statusStep } from './helpers';

export const ESCALATION_TEAMS = ['NetEng', 'Service Owner / SRE', 'Facilities', 'Security', 'Vendor Support'] as const;

export const ticketingScenarios: ScenarioDef[] = [
  {
    id: 'tk-triage',
    module: 'ticketing',
    title: 'Triage the queue',
    summary: 'Six tickets arrive at shift start. Put them in the order you would work them: priority, SLA, and one that beats both.',
    difficulty: 2,
    tags: ['priority', 'sla', 'safety-first'],
    minutes: 4,
    build: (seed) => {
      const s = standardWorld(seed);
      const H = 3600;
      const specs = [
        { id: 'smell', priority: 'P3' as const, sla: 20 * H, summary: 'Burning smell reported near row C', description: 'Security guard reports a burning plastic smell near row C during rounds. No alarms yet.' },
        { id: 'p1', priority: 'P1' as const, sla: 1.5 * H, summary: '[DOWN] Rack C07 ToR switch unreachable — 10 hosts offline', description: 'Entire rack offline.' },
        { id: 'p2a', priority: 'P2' as const, sla: 2 * H, summary: '[HW] PSU2 failed on phx1-cmp-c06u11', description: 'Redundancy lost.' },
        { id: 'p2b', priority: 'P2' as const, sla: 9 * H, summary: '[HW] Fan4 failed on phx1-cmp-c08u07', description: 'Fan redundancy lost.' },
        { id: 'p3', priority: 'P3' as const, sla: 30 * H, summary: '[DISK] Predictive failure BAY7 phx1-sto-c07u03', description: 'SMART reallocated sectors.' },
        { id: 'p4', priority: 'P4' as const, sla: 120 * H, summary: '[AUDIT] Re-label cables rack C09', description: 'Labels faded.' },
      ];
      const keyOf: Record<string, string> = {};
      for (const sp of specs) {
        const t = makeTicket(s.w, s.rng, null, { priority: sp.priority, summary: sp.summary, description: sp.description, slaDueAt: sp.sla, createdAt: -600 });
        keyOf[sp.id] = t.key;
      }
      const expected = ['smell', 'p1', 'p2a', 'p2b', 'p3', 'p4'].map((x) => keyOf[x]);
      const shuffled = s.rng.shuffle(expected);
      return {
        world: s.w,
        title: 'Triage the queue',
        briefing: 'Shift just started and these six tickets are waiting. Drag them into the order you would work them, then Submit.',
        steps: [
          { id: 'first', text: 'Pick the right ticket to work FIRST', why: 'Life safety beats every SLA. A burning smell can be a failing PDU or a fire. Investigate or escalate to Facilities immediately, whatever priority automation gave it.', points: 25, required: true, done: (w) => !!w.flags['triage:first_ok'] },
          { id: 'order', text: 'Order the rest by priority, then by SLA remaining', why: 'Within the same priority, the SLA that expires first wins (P2 due in 2h before P2 due in 9h).', points: 25, required: true, done: (w) => !!w.flags['triage:order_ok'] },
        ],
        tools: ['ticket', 'notes'],
        scene: 'triage',
        rootCause: 'Safety first, then P1, then by priority and SLA.',
        expertPath: ['Burning smell (safety)', 'P1 rack down', 'P2 with 2h SLA', 'P2 with 9h SLA', 'P3', 'P4'],
        bench: { triage: { keys: shuffled, expected, explain: 'Safety → P1 → P2 (sooner SLA first) → P3 → P4' } },
      };
    },
  },
  {
    id: 'tk-worklog',
    module: 'ticketing',
    title: 'Write a worklog that survives an audit',
    summary: 'The repair is done. Now document it well enough that an auditor, the vendor and the next shift never need to ask you a question.',
    difficulty: 1,
    tags: ['worklog', 'documentation'],
    minutes: 4,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const psu = s.rng.pick(['PSU1', 'PSU2']);
      const old = dev.slots[psu]!;
      const neu = makeComponent(s.rng, old.partNumber);
      dev.slots[psu] = neu;
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P2', status: 'In Progress', assignee: 'You', summary: `[HW] ${psu} failed — replace | ${dev.hostname}`, description: `${psu} failure detected. Part: ${old.partNumber}`, hostState: 'Drained' });
      s.w.flags[`ticket:${tk.key}:In Progress`] = { first: -100, last: -100, count: 1 };
      s.w.trainee.notes = `Notes from the job:\n- Scanned ${dev.assetTag}, matched S/N ${dev.serial}\n- ${psu} amber LED, SEL "Failure detected"\n- Removed ${psu} S/N ${old.serial}\n- Installed ${psu} S/N ${neu.serial} (PN ${old.partNumber})\n- BMC: PS Redundancy = Fully Redundant\n- Old PSU bagged + tagged, RMA bin`;
      const mustHave = (re: RegExp) => (w: Parameters<Step['done']>[0]) => w.tickets[tk.key].worklogs.some((l) => l.author === 'You' && l.kind === 'worklog' && re.test(l.text));
      return {
        world: s.w,
        title: 'Write a worklog that survives an audit',
        briefing: `The ${psu} swap on ${dev.hostname} is finished and your notes are in the Notes tool. Write the worklog on ${tk.key}, then resolve it.`,
        steps: [
          { id: 'old', text: 'Old part serial', points: 10, required: true, done: mustHave(new RegExp(old.serial, 'i')) },
          { id: 'new', text: 'New part serial', points: 10, required: true, done: mustHave(new RegExp(neu.serial, 'i')) },
          { id: 'pn', text: 'Part number', points: 5, required: false, done: mustHave(new RegExp(old.partNumber, 'i')) },
          { id: 'where', text: 'Which slot (PSU1/PSU2)', points: 5, required: true, done: mustHave(new RegExp(psu, 'i')) },
          { id: 'verify', text: 'How you verified it (redundancy / health)', points: 10, required: true, done: mustHave(/redundan|verified|healthy|green|ok/i) },
          { id: 'disposal', text: 'What happened to the old part (RMA)', points: 5, required: false, done: mustHave(/rma|returned|tagged/i) },
          statusStep(tk.key, 'Resolved'),
          noPenaltyStep('no_self_close', 'self_close', 'Resolve, but don\'t Close it yourself', 'DCO resolves and the requester or automation validates and closes.', 5),
        ],
        tools: ['ticket', 'notes'],
        scene: 'none',
        startTool: 'ticket',
        focusDeviceId: dev.id,
        rootCause: 'Documentation task.',
        expertPath: [`"Replaced ${psu} on ${dev.hostname} (${dev.assetTag}). Old S/N ${old.serial} → new S/N ${neu.serial}, PN ${old.partNumber}. Verified PS Redundancy = Fully Redundant in BMC; front LED green. Old unit bagged/tagged → RMA bin."`, 'Then resolve (not close).'],
      };
    },
  },
  {
    id: 'tk-wfp',
    module: 'ticketing',
    title: 'Waiting for Part, start to finish',
    summary: 'No spare on site. Request it, park the ticket correctly, pick it up when it lands, then finish the job.',
    difficulty: 2,
    tags: ['waiting-for-part', 'logistics', 'sla'],
    minutes: 8,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const f = injectFault(s.w, s.rng, dev, 'psu_failed');
      dev.drained = true;
      const part = dev.slots[f.slot!]!;
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P2', summary: `[HW] ${f.slot} failed — replace | ${dev.hostname}`, description: `${f.slot} failure detected.\nPart: ${part.partNumber}\n\n⚠ No spare staged — site inventory shows 0 on hand. Request from logistics.`, hostState: 'Drained' });
      return {
        world: s.w,
        title: 'Waiting for Part',
        briefing: `${tk.key}: ${f.slot} on ${dev.hostname} needs replacing, but there's no spare on site. Run the parts workflow properly so the SLA clock and reporting stay honest.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'request', text: `Request part ${part.partNumber} (exact PN) from the ticket`, points: 15, required: true, done: (w) => !!w.flags[`part_requested:${tk.key}:${part.partNumber}`] },
          { id: 'wfp', text: 'Move the ticket to Waiting for Part', why: 'Waiting for Part pauses the SLA for the time you can\'t control, and tells the next shift exactly what the ticket is waiting on.', points: 10, required: true, done: (w) => !!w.flags[`ticket:${tk.key}:Waiting for Part`] },
          { id: 'pickup', text: 'When logistics says it landed, pick it up from the parts cage', points: 10, required: true, done: (w) => !!w.flags['picked_up_part'] },
          { id: 'resume', text: 'Move back to In Progress before working', points: 5, required: true, done: (w) => (w.flags[`ticket:${tk.key}:In Progress`]?.count ?? 0) >= 2 },
          { id: 'swap', text: `Replace ${f.slot}`, points: 15, required: true, done: (w) => goodPsuCount(w, w.devices[dev.id]) === 2 },
          { id: 'worklog', text: 'Worklog with old/new serials', points: 10, required: true, done: (w) => w.tickets[tk.key].worklogs.some((l) => l.author === 'You' && l.kind === 'worklog' && l.text.toUpperCase().includes(part.serial.toUpperCase())) },
          statusStep(tk.key, 'Resolved'),
        ],
        tools: ['ticket', 'terminal', 'bmc', 'parts', 'notes'],
        scene: 'rack',
        startTool: 'ticket',
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['In Progress → Request part (exact PN)', 'Waiting for Part', 'Fast-forward until logistics comments "delivered"', 'Walk to the cage → scan out', 'In Progress → swap → verify → worklog → Resolve'],
      };
    },
  },
  {
    id: 'tk-escalate',
    module: 'ticketing',
    title: 'Not a hardware problem: escalate correctly',
    summary: 'A customer says a host is "slow". Prove the hardware is healthy, and hand it to the right team with evidence instead of swapping parts.',
    difficulty: 3,
    tags: ['escalation', 'scope', 'evidence'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Investigation', reporter: 'customer-portal', summary: `Host ${dev.hostname} is slow`, description: 'Our application latency on this host doubled since this morning. Please replace whatever is broken.' });
      return {
        world: s.w,
        title: 'Escalate correctly',
        briefing: `${tk.key}: the customer wants "whatever is broken" replaced on ${dev.hostname}. Check the hardware and decide whose problem this is.`,
        steps: [
          statusStep(tk.key, 'In Progress'),
          { id: 'bmc', text: 'Check hardware health in the BMC (dashboard + SEL)', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:health`] && !!w.flags[`sel_viewed:${dev.id}`] },
          { id: 'os', text: 'Check the OS side: links, errors, temperatures', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:network`] || !!w.flags[`viewed:${dev.id}:logs`] },
          findingStep('hw', 'Is there any hardware fault? (yes/no)', 10),
          { id: 'escalate', text: 'Escalate to the Service Owner / SRE with your evidence', why: 'DCO owns the physical layer. Application performance belongs to the service owner, and swapping healthy parts wastes money and hides the real cause.', points: 20, required: true, done: (w) => Object.keys(w.flags).some((k) => k.startsWith(`escalated:${tk.key}:Service Owner`)) },
          noPenaltyStep('no_touch', ['power_off_undrained', 'unplanned_outage', 'pulled_healthy_drive'], 'No reboots or part swaps on a healthy production host', 'Rebooting or swapping parts on a healthy host turns a performance complaint into an outage.', 10),
          { id: 'healthy', text: 'Host still healthy and in production at the end', points: 5, required: false, done: (w) => w.devices[dev.id].os === 'up' && linkState(w, dev.id, 'nic0p0').up },
        ],
        tools: ['ticket', 'terminal', 'bmc', 'notes'],
        scene: 'none',
        startTool: 'ticket',
        focusDeviceId: dev.id,
        rootCause: 'No hardware fault. The latency was an application/workload issue, outside DCO scope.',
        expertPath: ['BMC: all green, SEL clean', 'ssh: links up, no errors in dmesg, temps normal', 'Comment with evidence: "HW healthy: BMC OK, SEL clean, links 25G up, no MCE/EDAC/IO errors"', 'Escalate → Service Owner / SRE'],
        bench: { findings: [finding('hw', 'yes / no', ['no'], 'No. Everything is healthy.')] },
      };
    },
  },
];
