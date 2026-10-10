// M10 — Shift Mode: a queue of mixed tickets arriving over time, SLAs ticking.
import { injectBmcHung, injectFault, injectLooseCord } from '../engine/faults';
import { makeTicket, stockCart } from '../engine/procedure';
import { goodPsuCount } from '../engine/projectors';
import type { Rng } from '../engine/rng';
import type { ScenarioDef, Step } from '../engine/scenario';
import { addSel, schedule } from '../engine/sim';
import type { Device, Ticket, World } from '../engine/types';
import { standardWorld } from './common';

interface Incident {
  ticket: Ticket;
  fixed: (w: World) => boolean;
  rootCause: string;
  arriveAt: number; // 0 = at shift start
}

type Maker = (w: World, rng: Rng, dev: Device, arriveAt: number) => Incident;

const H = 3600;
const SLA = { P1: 0.5 * H, P2: 2 * H, P3: 4 * H, P4: 8 * H };

function tk(w: World, rng: Rng, dev: Device | null, t: Parameters<typeof makeTicket>[3], arriveAt: number): Ticket {
  const ticket = makeTicket(w, rng, dev, { ...t, createdAt: arriveAt, slaDueAt: arriveAt + SLA[t.priority ?? 'P3'] });
  if (arriveAt > 0) {
    delete w.tickets[ticket.key];
    w.ticketQueue.push(ticket);
    schedule(w, { at: arriveAt, type: 'ticket_arrives', ticketKey: ticket.key });
  }
  return ticket;
}

const makers: Record<string, { model: 'hx-2208c' | 'hx-2412s'; make: Maker }> = {
  psu: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      const f = injectFault(w, rng, dev, 'psu_failed');
      dev.drained = true;
      stockCart(w, rng, dev.slots[f.slot!]!.partNumber, { decoys: 1 });
      const t = tk(w, rng, dev, { priority: 'P2', summary: `[HW] ${f.slot} failed — replace | ${dev.hostname}`, description: `${f.slot} failure detected. Part ${dev.slots[f.slot!]!.partNumber}. Hot-swap.`, hostState: 'Drained' }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => goodPsuCount(ww, ww.devices[dev.id]) === 2 };
    },
  },
  hdd: {
    model: 'hx-2412s',
    make: (w, rng, dev, at) => {
      const f = injectFault(w, rng, dev, 'hdd_failed');
      dev.drained = true;
      const c = dev.slots[f.slot!]!;
      stockCart(w, rng, c.partNumber, { decoys: 1 });
      const t = tk(w, rng, dev, { priority: 'P3', summary: `[DISK] ${f.slot} failed | ${dev.hostname}`, description: `Disk in ${f.slot} (S/N ${c.serial}) failed, evacuated. Replace hot.`, hostState: 'Drained' }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => { const p = ww.devices[dev.id].slots[f.slot!]; return !!p && p.health === 'ok' && p.seated && ww.bins.secure_destruction.some((x) => x.serial === c.serial); } };
    },
  },
  cord: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      const psu = rng.pick(['PSU1', 'PSU2'] as const);
      const f = injectLooseCord(w, dev, psu);
      dev.drained = true;
      const t = tk(w, rng, dev, { priority: 'P2', summary: `[HW] ${psu} AC lost | ${dev.hostname}`, description: `${psu} reports AC lost. Redundancy lost.`, hostState: 'Drained' }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => goodPsuCount(ww, ww.devices[dev.id]) === 2 && !ww.flags[`removed:${dev.id}:${psu}`] };
    },
  },
  bmc: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      const f = injectBmcHung(w, dev);
      const t = tk(w, rng, dev, { priority: 'P3', type: 'Investigation', summary: `[OOB] BMC unreachable ${dev.hostname}-bmc`, description: 'OOB monitoring lost the BMC. Host is in production.' }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => ww.devices[dev.id].bmc.responsive && ww.devices[dev.id].os === 'up' };
    },
  },
  panic: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      dev.os = 'panic';
      dev.quirks.push('panicked');
      dev.drained = true;
      addSel(w, dev, 'OS Critical Stop', 'Run-time critical stop (kernel panic)', 'critical', 'Asserted', at - 120);
      const t = tk(w, rng, dev, { priority: 'P1', type: 'Break/Fix', summary: `[P1][DOWN] ${dev.hostname} hard down — customer impact`, description: 'Host stopped heartbeating; customer-facing. Out of rotation. Recover ASAP and capture the console.', hostState: 'Drained' }, at);
      return { ticket: t, arriveAt: at, rootCause: 'Kernel panic (fatal MCE). Power cycle recovered it.', fixed: (ww) => ww.devices[dev.id].os === 'up' };
    },
  },
  fan: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      const f = injectFault(w, rng, dev, 'fan_failed');
      dev.drained = true;
      stockCart(w, rng, dev.slots[f.slot!]!.partNumber, { decoys: 1 });
      const t = tk(w, rng, dev, { priority: 'P2', summary: `[HW] ${f.slot} 0 RPM | ${dev.hostname}`, description: `${f.slot} failed. Hot-swap with lid open; minimize time.`, hostState: 'Drained' }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => { const d = ww.devices[dev.id]; const p = d.slots[f.slot!]; return !!p && p.health === 'ok' && d.layers.lid && !d.servicePosition; } };
    },
  },
  dimm: {
    model: 'hx-2208c',
    make: (w, rng, dev, at) => {
      const f = injectFault(w, rng, dev, 'dimm_uce');
      stockCart(w, rng, dev.slots[f.slot!]!.partNumber, { decoys: 2 });
      const t = tk(w, rng, dev, { priority: 'P2', summary: `[HW] ${f.slot} UCE — replace DIMM | ${dev.hostname}`, description: `Uncorrectable ECC on ${f.slot}. Host in production — drain required.` }, at);
      return { ticket: t, arriveAt: at, rootCause: f.rootCause, fixed: (ww) => { const d = ww.devices[dev.id]; const p = d.slots[f.slot!]; return !!p && p.health === 'ok' && p.seated && d.os === 'up' && d.layers.shroud && d.layers.lid; } };
    },
  },
};

function buildShift(seed: number, plan: Array<[keyof typeof makers, number]>, title: string, minutes: number) {
  const s = standardWorld(seed, { racks: 3 });
  const all = Object.values(s.w.devices).filter((d) => d.role === 'server');
  const used = new Set<string>();
  const incidents: Incident[] = [];
  for (const [kind, at] of plan) {
    const m = makers[kind];
    const dev = s.rng.pick(all.filter((d) => d.model === m.model && !used.has(d.id)));
    used.add(dev.id);
    incidents.push(m.make(s.w, s.rng, dev, at));
  }
  const steps: Step[] = incidents.map((inc) => ({
    id: `fix_${inc.ticket.key}`,
    text: `${inc.ticket.priority} ${inc.ticket.key}: fixed and Resolved — ${inc.ticket.summary.replace(/^\[[^\]]+\]\s*/, '').slice(0, 60)}`,
    points: inc.ticket.priority === 'P1' ? 20 : 12,
    required: true,
    done: (w) => !!w.tickets[inc.ticket.key] && w.tickets[inc.ticket.key].status === 'Resolved' && inc.fixed(w),
  }));
  steps.push({
    id: 'sla',
    text: 'Every ticket resolved within its SLA',
    why: 'SLAs are contractual. Prioritize by priority, then by time remaining.',
    points: 15,
    required: false,
    done: (w) => incidents.every((inc) => { const t = w.tickets[inc.ticket.key]; const r = w.flags[`ticket:${inc.ticket.key}:Resolved`]; return !!t && !!r && r.first <= t.slaDueAt; }),
  });
  const p1 = incidents.find((i) => i.ticket.priority === 'P1');
  if (p1)
    steps.push({
      id: 'p1_ack',
      text: 'Pick up the P1 within 5 minutes of it landing',
      why: 'A P1 page interrupts whatever you are doing. Park your current job safely (never leave a server open) and go.',
      points: 10,
      required: false,
      done: (w) => { const t = w.tickets[p1.ticket.key]; const ip = w.flags[`ticket:${p1.ticket.key}:In Progress`]; return !!t && !!ip && ip.first - t.createdAt <= 300; },
    });
  steps.push(
    { id: 'safety', text: 'Zero safety violations all shift', points: 10, required: false, guard: true, done: (w) => !w.penalties.some((p) => p.safety) },
    { id: 'handoff', text: 'Write a shift handoff in Notes (open items, anything odd)', why: 'The next shift starts from your handoff. Missing context there turns into repeated work and outages.', points: 10, required: true, done: (w) => w.trainee.notes.trim().length >= 80 },
  );
  return {
    world: s.w,
    title,
    briefing: `Your ${minutes}-minute shift has started. ${incidents.filter((i) => i.arriveAt === 0).length} tickets are waiting, and more will arrive. Prioritize, work them properly, and write a handoff before you end the shift.`,
    steps,
    tools: ['ticket', 'terminal', 'bmc', 'assets', 'parts', 'notes', 'pdu'] as const,
    scene: 'rack' as const,
    startTool: 'ticket' as const,
    focusRackId: s.rackId,
    rootCause: incidents.map((i) => `${i.ticket.key}: ${i.rootCause}`).join('\n'),
    expertPath: ['Triage: P1 > P2 (SLA) > P3', 'Batch work per rack to save walking', 'Hot-swaps first while you wait for drains', 'When the P1 lands: finish the safe step you are on, then go', 'Handoff: open tickets, parts on order, anything weird'],
    timeLimitSec: minutes * 60,
  };
}

export const shiftScenarios: ScenarioDef[] = [
  {
    id: 'sh-day',
    module: 'shift',
    title: 'Day shift (DCT I)',
    summary: 'Four tickets plus a P1 that lands mid-shift. Hot-swaps, a BMC that\'s hung, and something that isn\'t what the ticket says.',
    difficulty: 3,
    tags: ['shift', 'prioritization', 'sla'],
    minutes: 30,
    build: (seed) => {
      const b = buildShift(seed, [['psu', 0], ['hdd', 0], ['cord', 0], ['bmc', 420], ['panic', 900]], 'Day shift (DCT I)', 30);
      return { ...b, tools: [...b.tools] };
    },
  },
  {
    id: 'sh-night',
    module: 'shift',
    title: 'Night shift (DCT II)',
    summary: 'Six tickets including a cold DIMM swap that needs a drain, a fan swap with the lid open, and a P1, with half the usual time per ticket.',
    difficulty: 5,
    tags: ['shift', 'cold-swap', 'pressure'],
    minutes: 45,
    build: (seed) => {
      const b = buildShift(seed, [['dimm', 0], ['fan', 0], ['psu', 0], ['cord', 300], ['hdd', 600], ['panic', 1200]], 'Night shift (DCT II)', 45);
      return { ...b, tools: [...b.tools] };
    },
  },
];

