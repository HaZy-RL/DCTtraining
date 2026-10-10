// Builders for the standard "ticket → diagnose → swap → verify → document" loop.
import { decoysFor, KIND_LABEL, MODELS, partSpec } from './catalog';
import { makeComponent } from './factory';
import { locationOf, psuGood } from './projectors';
import { flagAfter, type Step } from './scenario';
import type { Rng } from './rng';
import type { ComponentKind, Device, Ticket, World } from './types';

export function ticketKey(rng: Rng): string {
  return `DCO-${rng.int(41000, 49999)}`;
}

export function makeTicket(w: World, rng: Rng, dev: Device | null, t: Partial<Ticket> & Pick<Ticket, 'summary' | 'description'>): Ticket {
  const key = t.key ?? ticketKey(rng);
  const tk: Ticket = {
    key,
    type: t.type ?? 'Hardware Repair',
    priority: t.priority ?? 'P3',
    status: t.status ?? 'Open',
    summary: t.summary,
    description: t.description,
    reporter: t.reporter ?? 'svc-fleet-health',
    assignee: t.assignee ?? null,
    hostname: t.hostname ?? dev?.hostname,
    assetTag: t.assetTag ?? dev?.assetTag,
    serial: t.serial ?? dev?.serial,
    location: t.location ?? (dev ? locationOf(w, dev) : undefined),
    createdAt: t.createdAt ?? -rng.int(600, 7200),
    slaDueAt: t.slaDueAt ?? (t.priority === 'P1' ? 4 * 3600 : t.priority === 'P2' ? 24 * 3600 : 72 * 3600),
    worklogs: t.worklogs ?? [],
    hostState: t.hostState ?? 'In Production',
    labels: t.labels ?? [],
  };
  w.tickets[key] = tk;
  return tk;
}

/** Put the right part plus look-alike decoys on the parts cart (shuffled). */
export function stockCart(w: World, rng: Rng, pn: string, opts: { decoys?: number; qty?: number } = {}) {
  const parts = [];
  for (let i = 0; i < (opts.qty ?? 1); i++) parts.push(pn);
  const decoys = rng.shuffle(decoysFor(pn)).slice(0, opts.decoys ?? 2);
  for (const d of [...parts, ...decoys]) {
    const c = makeComponent(rng, d);
    w.spares.push({ component: c, label: `${partSpec(d).desc}  [PN ${d}]`, location: 'cart' });
  }
  w.spares = rng.shuffle(w.spares);
}

export const KIND_TOPIC: Record<ComponentKind, string> = {
  dimm: 'memory',
  cpu: 'cpu',
  psu: 'power',
  fan: 'fans',
  hdd: 'storage',
  nvme: 'storage',
  m2: 'raid',
  nic: 'network',
  gpu: 'gpu',
  cmos: 'bios',
  heatsink: 'cpu',
};

interface RepairCtx {
  dev: Device;
  slot: string;
  kind: ComponentKind;
  ticket: Ticket;
  oldSerial: string;
  /** Skip the diagnosis-flag step (e.g. learn drills where the ticket names the slot). */
  slotKnown: boolean;
}

const s = (o: Step) => o;

/** Full step list for replacing one FRU. Steps are graded on world flags/state. */
export function repairSteps(c: RepairCtx): Step[] {
  const { dev, slot, kind, ticket } = c;
  const def = MODELS[dev.model].slots.find((x) => x.id === slot)!;
  const cold = !def.hotSwap;
  const internal = def.access === 'internal';
  const id = dev.id;
  const label = KIND_LABEL[kind];
  const topic = KIND_TOPIC[kind];
  const failedPn = dev.slots[slot]!.partNumber;
  const dataBearing = !!partSpec(failedPn).dataBearing;
  const replacedAt = (w: World) => w.flags[`replaced_ok:${id}:${slot}`]?.last ?? Infinity;
  const steps: Step[] = [];

  steps.push(
    s({
      id: 'in_progress',
      text: `Take ${ticket.key} and move it to In Progress`,
      why: 'Never touch hardware without an active ticket. It tells everyone (and the automation) that a human is working on this host.',
      hint: 'Open the Ticket tool → Assign to me / In Progress.',
      points: 5,
      required: true,
      done: (w) => !!w.flags[`ticket:${ticket.key}:In Progress`] && (!w.flags[`physical_work:${id}`] || w.flags[`ticket:${ticket.key}:In Progress`].first <= w.flags[`physical_work:${id}`].first),
    }),
  );
  if (!c.slotKnown) {
    steps.push(
      s({
        id: 'diagnose',
        text: `Identify the failed ${label.toLowerCase()} remotely (BMC SEL / sensors / Linux) and flag it`,
        why: 'Confirm the failure yourself before you walk to the floor. Tickets are sometimes wrong, and the evidence goes in your worklog.',
        hint: 'Check the SEL in the BMC (or `ipmitool sel elist`), then click the part and choose "Flag as faulty".',
        points: 15,
        required: true,
        done: (w) => w.trainee.flagged.includes(`${id}:${slot}`),
      }),
    );
  }
  if (cold) {
    steps.push(
      s({
        id: 'drain',
        text: 'Get the host drained/released before taking it down',
        why: 'Powering off a production host without a drain causes customer impact. The service owner (or automation) migrates workloads first.',
        hint: 'Ticket → "Request drain", then wait for the release comment.',
        points: 8,
        required: true,
        done: (w) => !!w.flags[`drained:${ticket.key}`] && !w.penalties.some((p) => p.rule === 'power_off_undrained' || p.rule === 'unplanned_outage'),
      }),
    );
  }
  steps.push(
    s({
      id: 'scan',
      text: `Walk to ${dev.rackId} and scan the asset tag to confirm it's the right box`,
      why: 'Hostnames lie and machines get moved. Matching the asset tag or serial to the ticket keeps you from working on the wrong server.',
      hint: 'Walk to the rack, click the server, then "Scan asset tag".',
      points: 5,
      required: false,
      done: (w) => !!w.flags[`scanned:${id}`] && (!w.flags[`physical_work:${id}`] || w.flags[`scanned:${id}`].first <= w.flags[`physical_work:${id}`].first),
    }),
  );
  if (kind === 'hdd' || kind === 'nvme') {
    steps.push(
      s({
        id: 'locate',
        text: 'Light up the locate LED on the failed drive bay',
        why: 'A 12-bay chassis looks the same in every bay. A blinking locate LED (ledctl or BMC) makes sure you pull the right one, because pulling a healthy drive is a data incident.',
        hint: '`sudo ledctl locate=/dev/<disk>` on the host, or BMC → Storage → Blink.',
        points: 5,
        required: false,
        done: (w) => !!w.flags[`drive_locate:${id}:${slot}`],
      }),
    );
  }
  if (cold) {
    steps.push(
      s({
        id: 'power_off',
        text: 'Gracefully shut the host down',
        why: 'A graceful shutdown flushes filesystems. Hard power-off is a last resort.',
        points: 5,
        required: true,
        done: (w) => !!w.flags[`power_off:${id}`] || !!w.flags[`unplugged:${id}`],
      }),
      s({
        id: 'unplug',
        text: 'Unplug BOTH power cords and drain residual power',
        why: 'Standby power is live on the board even when the server is "off". Pull both cords, then hold the power button about 15 s to drain flea power.',
        hint: 'Rear view → each PSU → Unplug cord. Then press the power button with no AC.',
        points: 8,
        required: true,
        done: (w) => !w.penalties.some((p) => p.rule === 'standby_power' || p.rule === 'hot_cold_part') && !!w.flags[`unplugged:${id}`],
      }),
    );
  }
  if (internal || cold) {
    steps.push(
      s({
        id: 'esd',
        text: 'Put on an ESD wrist strap and clip it to bare chassis metal',
        why: 'Static discharge you can\'t even feel (<3000 V) can damage a DIMM or CPU. The damage is often latent, so the part fails weeks later.',
        points: 5,
        required: false,
        guard: true,
        done: (w) => !w.penalties.some((p) => p.rule === 'no_esd'),
      }),
    );
  }
  steps.push(
    s({
      id: 'remove',
      text: `Remove the failed ${label.toLowerCase()} from ${slot}`,
      points: 10,
      required: true,
      done: (w) => !!w.flags[`removed:${id}:${slot}`] && !w.flags[`removed_healthy:${id}:${slot}`],
    }),
    s({
      id: 'install',
      text: `Install the replacement — exact part number ${failedPn} — fully seated`,
      why: 'Look-alike parts are on the cart. Match the PN on the label to the part you pulled, not just the description.',
      points: 15,
      required: true,
      done: (w) => {
        const p = w.devices[id].slots[slot];
        return !!p && p.health === 'ok' && p.seated && !w.flags[`wrong_pn:${id}:${slot}`] && p.serial !== c.oldSerial;
      },
    }),
  );
  if (internal) {
    steps.push(
      s({
        id: 'reassemble',
        text: 'Reassemble: shroud, risers, heatsinks, lid, slide back in',
        why: 'A missing air shroud means CPUs overheat within minutes. Leaving the lid off breaks the airflow path.',
        points: 8,
        required: true,
        done: (w) => {
          const d = w.devices[id];
          if (!w.flags[`removed:${id}:${slot}`]) return false;
          return d.layers.lid && d.layers.shroud && d.layers.riser1 && d.layers.riser2 && Object.values(d.heatsinks).every(Boolean) && !d.servicePosition;
        },
      }),
    );
  }
  if (cold) {
    steps.push(
      s({
        id: 'power_on',
        text: 'Reconnect both power cords (A and B side) and power on',
        why: 'Plug PSU1→PDU-A and PSU2→PDU-B. Two cords on the same PDU defeats power redundancy.',
        points: 6,
        required: true,
        done: (w) => {
          const d = w.devices[id];
          const sides = Object.values(d.powerCords).filter(Boolean).map((o) => o!.split('-PDU-')[1]?.[0]);
          return (d.power === 'on' || d.power === 'posting') && sides.includes('A') && sides.includes('B');
        },
      }),
      s({
        id: 'boot',
        text: 'Wait for POST and OS boot. Do not interrupt memory training',
        why: 'After a memory/CPU change, POST can take several minutes for memory training. Power-cycling mid-training is a classic mistake.',
        points: 5,
        required: true,
        done: (w) => flagAfter(w, `os_up:${id}`, replacedAt(w)),
      }),
    );
  } else if (kind === 'psu') {
    steps.push(
      s({
        id: 'cord',
        text: 'Plug the power cord back into the new PSU and engage the retention clip',
        points: 6,
        required: true,
        done: (w) => !!w.flags[`replaced_ok:${id}:${slot}`] && !!w.devices[id].powerCords[slot] && psuGood(w, w.devices[id], slot),
      }),
    );
  }
  steps.push(
    s({
      id: 'verify',
      text: `Verify the fix (${topic} view in the BMC or Linux) after the replacement`,
      why: 'You are not done until you have seen the system report healthy again. Put that evidence in the ticket.',
      hint: topic === 'memory' ? 'e.g. `dmidecode -t memory`, `free -g`, BMC → Memory' : topic === 'storage' ? 'e.g. `lsblk`, `smartctl -H`, BMC → Storage' : 'BMC dashboard / `ipmitool sdr`',
      points: 10,
      required: true,
      done: (w) => flagAfter(w, `viewed:${id}:${topic}`, replacedAt(w)) || flagAfter(w, `viewed:${id}:health`, replacedAt(w)),
    }),
    s({
      id: 'sel',
      text: 'Review and then clear the SEL so the health LED goes green',
      why: 'On most platforms the front health LED stays amber until the old critical SEL events are cleared, and the next tech would chase a ghost. Save or read the log first.',
      points: 5,
      required: false,
      done: (w) => flagAfter(w, `sel_cleared:${id}`, replacedAt(w)) && !w.penalties.some((p) => p.rule === 'sel_cleared_unread'),
    }),
    s({
      id: 'dispose',
      text: dataBearing ? 'Bag the failed drive and put it in the SECURE DESTRUCTION bin' : 'Bag + tag the failed part and drop it in the RMA bin',
      why: dataBearing
        ? 'Data-bearing devices never leave the site. They are shredded or degaussed on-site with chain of custody.'
        : 'Defective parts go back to the vendor for credit/analysis. They need an anti-static bag and a defect tag.',
      points: 6,
      required: false,
      done: (w) => !!w.flags[`binned:${dataBearing ? 'secure_destruction' : 'rma'}:${c.oldSerial}`],
    }),
    s({
      id: 'worklog',
      text: 'Write a worklog with the OLD and NEW serial numbers and what you verified',
      why: 'Auditors, RMA, and the next tech rely on this. "Replaced DIMM, fixed" is not a worklog.',
      hint: `Include ${c.oldSerial} (old) and the new part's S/N.`,
      points: 10,
      required: true,
      done: (w) => {
        const newSerial = w.devices[id].slots[slot]?.serial;
        return w.tickets[ticket.key].worklogs.some(
          (l) => l.author === w.trainee.name && l.kind === 'worklog' && l.text.toUpperCase().includes(c.oldSerial.toUpperCase()) && !!newSerial && l.text.toUpperCase().includes(newSerial.toUpperCase()),
        );
      },
    }),
    s({
      id: 'resolve',
      text: `Resolve ${ticket.key}`,
      why: 'DCO resolves the ticket and the requester or automation closes it after validation.',
      points: 5,
      required: true,
      done: (w) => w.tickets[ticket.key].status === 'Resolved',
    }),
  );
  return steps;
}

export function expertPathFor(kind: ComponentKind, hotSwap: boolean, internal: boolean): string[] {
  const p = ['Read the ticket; move it to In Progress', 'Confirm the failure remotely: BMC SEL + sensors, or Linux logs', 'Note the failed part number and serial'];
  if (!hotSwap) p.push('Request a drain; wait for the release', 'Graceful shutdown (OS or BMC soft-off)');
  p.push('Walk to the rack; scan the asset tag and match the serial to the ticket');
  if (kind === 'hdd' || kind === 'nvme') p.push('Blink the bay locate LED (ledctl / BMC)');
  if (!hotSwap) p.push('Unplug both power cords, then hold the power button to drain flea power');
  if (internal || !hotSwap) p.push('ESD strap on, clipped to the chassis');
  if (internal) p.push('Slide out to the service position, remove the lid (and shroud/riser/heatsink as needed)');
  p.push('Remove the failed part; verify the replacement PN matches EXACTLY; install and seat it (latches closed)');
  if (internal) p.push('Reinstall the shroud/riser/heatsink and lid; slide in');
  if (!hotSwap) p.push('Cords back to PDU-A and PDU-B; power on; wait out memory training/POST');
  p.push('Verify healthy in BMC/Linux', 'Review → clear the SEL', 'Bag and tag; RMA bin, or secure destruction for drives', 'Worklog with old/new S/N and verification; resolve the ticket');
  return p;
}
