// Mutation helpers + time/power state machine. All functions mutate a draft World (use with immer).
import { MODELS, partSpec } from './catalog';
import { makeComponent } from './factory';
import { Rng } from './rng';
import { cpuTemp, goodPsuCount, hasAC, installedOfKind } from './projectors';
import type { Device, PendingEvent, SelEntry, Ticket, World } from './types';

export function toast(w: World, kind: 'info' | 'warn' | 'error' | 'success', text: string) {
  w.toastSeq += 1;
  w.toasts.push({ id: w.toastSeq, t: w.t, kind, text });
  if (w.toasts.length > 30) w.toasts.splice(0, w.toasts.length - 30);
}

export function flag(w: World, name: string) {
  const f = w.flags[name];
  if (f) {
    f.last = w.t;
    f.count += 1;
  } else w.flags[name] = { first: w.t, last: w.t, count: 1 };
}

export function hasFlag(w: World, name: string): boolean {
  return !!w.flags[name];
}

export function log(w: World, action: string, detail: string, ok = true) {
  w.log.push({ t: w.t, action, detail, ok });
}

/** Penalties are de-duplicated per rule+key so a repeated mistake isn't punished 20 times. */
export function penalize(w: World, rule: string, points: number, reason: string, opts: { safety?: boolean; key?: string } = {}) {
  const k = `pen:${rule}:${opts.key ?? ''}`;
  if (w.flags[k]) return;
  flag(w, k);
  w.penalties.push({ t: w.t, points, rule, reason, safety: !!opts.safety });
  toast(w, opts.safety ? 'error' : 'warn', `${opts.safety ? '⚠ Safety: ' : '−'}${reason} (−${points})`);
}

export function addSel(w: World, dev: Device, sensor: string, event: string, severity: SelEntry['severity'], dir: SelEntry['dir'] = 'Asserted', t?: number) {
  if (!dev.bmc.responsive && t === undefined) return;
  if (!hasAC(w, dev) && t === undefined) return; // no BMC power, nothing gets logged
  dev.selSeq += 1;
  dev.sel.push({ id: dev.selSeq, t: t ?? w.t, sensor, event, dir, severity });
  dev.sel.sort((a, b) => a.t - b.t);
}

export function schedule(w: World, ev: PendingEvent) {
  w.pending.push(ev);
  w.pending.sort((a, b) => a.at - b.at);
}

export function ticketForDevice(w: World, deviceId: string): Ticket | undefined {
  const dev = w.devices[deviceId];
  if (!dev) return undefined;
  return Object.values(w.tickets).find((t) => t.hostname === dev.hostname || t.assetTag === dev.assetTag);
}

/** A ticket whose stated location points at this device's rack/U (may be a different, stale asset!). */
export function ticketForLocation(w: World, deviceId: string): Ticket | undefined {
  const dev = w.devices[deviceId];
  if (!dev?.rackId) return undefined;
  const loc = `${w.racks[dev.rackId].location}-U${String(dev.u).padStart(2, '0')}`;
  return Object.values(w.tickets).find((t) => t.location === loc);
}

// ---------- power state machine ----------

/** Re-evaluate power after anything touching PSUs, cords or PDUs. */
export function recomputePower(w: World, dev: Device, cause: string) {
  const ac = hasAC(w, dev);
  const wasRunning = dev.power === 'on' || dev.power === 'posting';
  if (!ac) {
    if (dev.power !== 'off') {
      dev.power = 'off';
      dev.os = 'down';
      w.pending = w.pending.filter((p) => p.deviceId !== dev.id || p.type === 'drain_approved');
      if (wasRunning) {
        flag(w, `outage:${dev.id}`);
        if (dev.role === 'server' && !dev.drained) {
          penalize(w, 'unplanned_outage', 25, `${dev.hostname} lost all power while in production (${cause})`, { key: dev.id });
        } else if (dev.role !== 'server') {
          penalize(w, 'switch_outage', 30, `Took down ${dev.hostname}: every host in the rack lost network`, { key: dev.id });
        } else {
          toast(w, 'info', `${dev.hostname} lost AC power (${cause}).`);
        }
      }
    }
    return;
  }
  if (dev.power === 'off') {
    dev.power = 'standby';
    dev.bmc.responsive = !dev.quirks.includes('bmc_hung');
    // BMC boot: logs AC restore
    addSel(w, dev, 'Power Unit', 'AC Restored / BMC boot', 'info');
    // Most hyperscale BIOS policy: restore last power state = on for production nodes
    if (dev.role !== 'server') {
      dev.power = 'on';
      dev.os = 'up';
    }
  }
  if (dev.role === 'server' && (dev.power === 'on' || dev.power === 'posting')) {
    const good = goodPsuCount(w, dev);
    if (good < 2) flag(w, `redundancy_lost:${dev.id}`);
  }
}

export function postTimeFor(dev: Device): number {
  return 70 + (dev.quirks.includes('mem_retrain') ? 150 : 0) + installedOfKind(dev, 'dimm').length * 2;
}

export function powerOn(w: World, dev: Device, via: string): string {
  if (dev.power === 'off') return 'No AC power — nothing happens.';
  if (dev.power === 'on' || dev.power === 'posting') return 'Already powered on.';
  dev.power = 'posting';
  dev.os = 'down';
  dev.bootAt = w.t;
  dev.quirks = dev.quirks.filter((q) => !q.startsWith('post_halt') && q !== 'panicked');
  addSel(w, dev, 'System Event', `Power on (${via})`, 'info');
  flag(w, `power_on:${dev.id}`);
  // Hard stops — POST never completes
  const cpus = installedOfKind(dev, 'cpu');
  if (!dev.slots.CPU0) {
    dev.quirks.push('post_halt:No CPU in socket CPU0');
    addSel(w, dev, 'Processor', 'CPU0 Presence not detected — system halted', 'critical');
    return 'Fans spin up to 100%… POST halts. Front panel blinks amber.';
  }
  if (Object.entries(dev.heatsinks).some(([cpu, on]) => !on && dev.slots[cpu])) {
    dev.quirks.push('post_halt:CPU thermal trip (heatsink missing)');
    addSel(w, dev, 'Processor', 'CPU Thermal Trip — Asserted', 'critical');
    dev.power = 'standby';
    return 'System powers on and immediately shuts off — CPU thermal trip. (Heatsink missing!)';
  }
  if (cpus.length === 2 && cpus[0][1].partNumber !== cpus[1][1].partNumber) {
    dev.quirks.push('post_halt:Processor mismatch');
    addSel(w, dev, 'Processor', 'Processor configuration mismatch — POST halted', 'critical');
    return 'POST halts with "Processor mismatch".';
  }
  if (!installedOfKind(dev, 'dimm').some(([, c]) => c.seated)) {
    dev.quirks.push('post_halt:No memory detected');
    addSel(w, dev, 'Memory', 'No usable memory — POST halted', 'critical');
    return 'POST halts: no memory detected. Beep code 1-3-1.';
  }
  schedule(w, { at: w.t + postTimeFor(dev), type: 'post_complete', deviceId: dev.id });
  return dev.quirks.includes('mem_retrain')
    ? 'Powering on. Memory configuration changed — memory training will take several minutes. Do NOT power cycle.'
    : 'Powering on. POST in progress.';
}

export function powerOff(w: World, dev: Device, how: 'soft' | 'hard', via: string): string {
  if (dev.power === 'off' || dev.power === 'standby') return 'Chassis is already off.';
  if (dev.role === 'server' && !dev.drained) {
    penalize(w, 'power_off_undrained', 20, `Powered off ${dev.hostname} while it was still serving production traffic`, { key: dev.id });
  }
  dev.power = 'standby';
  dev.os = 'down';
  w.pending = w.pending.filter((p) => !(p.deviceId === dev.id && (p.type === 'post_complete' || p.type === 'os_up')));
  addSel(w, dev, 'System Event', how === 'soft' ? `Graceful shutdown (${via})` : `Power off (${via})`, 'info');
  flag(w, `power_off:${dev.id}`);
  return how === 'soft' ? 'Graceful shutdown completed. Chassis power is off (standby).' : 'Chassis power is off.';
}

function postComplete(w: World, dev: Device) {
  if (dev.power !== 'posting') return;
  dev.quirks = dev.quirks.filter((q) => q !== 'mem_retrain');
  // DIMM checks
  for (const [slot, c] of installedOfKind(dev, 'dimm')) {
    if (!c.seated) addSel(w, dev, `Memory ${slot}`, 'Memory training failure — DIMM mapped out', 'critical');
    else if (c.health === 'failed') addSel(w, dev, `Memory ${slot}`, 'Uncorrectable ECC — DIMM disabled by BIOS', 'critical');
  }
  const pnSet = new Set(installedOfKind(dev, 'dimm').map(([, c]) => c.partNumber));
  if (pnSet.size > 1) addSel(w, dev, 'Memory', 'Memory configuration mismatch (mixed DIMM types)', 'warning');
  // PSU mismatch
  const psuPns = new Set(installedOfKind(dev, 'psu').map(([, c]) => c.partNumber));
  if (psuPns.size > 1) addSel(w, dev, 'Power Supply', 'PSU configuration mismatch', 'warning');
  const fanPns = new Set(installedOfKind(dev, 'fan').map(([, c]) => c.partNumber));
  if (fanPns.size > 1) addSel(w, dev, 'Fan', 'Fan type mismatch — fans forced to 100%', 'warning');
  if (dev.quirks.includes('bios_defaults')) {
    addSel(w, dev, 'BIOS', 'CMOS checksum error — defaults loaded', 'warning');
    dev.bootOrder = ['PXE: OCP0 Port 0', 'NVMe: M.2 Boot 0', 'NVMe: M.2 Boot 1', 'UEFI Shell'];
    dev.quirks = dev.quirks.filter((q) => q !== 'bios_defaults');
    dev.quirks.push('clock_reset');
  }
  if (!dev.layers.shroud || !dev.layers.lid) schedule(w, { at: w.t + 60, type: 'thermal_check', deviceId: dev.id });
  dev.power = 'on';
  flag(w, `post_ok:${dev.id}`);
  if (dev.quirks.includes('enter_bios')) {
    dev.quirks = dev.quirks.filter((q) => q !== 'enter_bios');
    dev.quirks.push('in_bios');
    dev.os = 'down';
    flag(w, `in_bios:${dev.id}`);
    return;
  }
  bootFromOrder(w, dev);
}

/** Pick a boot device from the BIOS boot order and start the OS (or loop on PXE). */
export function bootFromOrder(w: World, dev: Device) {
  const bootOk = ['M2_0', 'M2_1'].some((s) => dev.slots[s] && dev.slots[s]!.health !== 'failed' && dev.slots[s]!.seated);
  const first = dev.bootOrder[0] ?? '';
  if (first.startsWith('PXE')) {
    dev.os = 'pxe_loop';
    addSel(w, dev, 'OS Boot', 'PXE boot — no boot filename received', 'warning');
    return;
  }
  if (!bootOk) {
    dev.os = 'pxe_loop';
    addSel(w, dev, 'OS Boot', 'No bootable device found', 'critical');
    return;
  }
  dev.os = 'booting';
  schedule(w, { at: w.t + 35, type: 'os_up', deviceId: dev.id });
}

export function processPending(w: World) {
  while (w.pending.length && w.pending[0].at <= w.t) {
    const ev = w.pending.shift()!;
    const dev = ev.deviceId ? w.devices[ev.deviceId] : undefined;
    switch (ev.type) {
      case 'post_complete':
        if (dev) postComplete(w, dev);
        break;
      case 'os_up':
        if (dev && dev.power === 'on' && dev.os === 'booting') {
          dev.os = dev.quirks.includes('readonly_fs') ? 'readonly_fs' : 'up';
          flag(w, `os_up:${dev.id}`);
          toast(w, 'success', `${dev.hostname} finished booting.`);
        }
        break;
      case 'drain_approved': {
        const t = ev.ticketKey ? w.tickets[ev.ticketKey] : undefined;
        if (t) {
          t.hostState = 'Drained';
          t.worklogs.push({ t: w.t, author: 'svc-fleet-automation', kind: 'system', text: `Host ${t.hostname} drained and released to DCO for maintenance. Workloads migrated. OK to power off.` });
          const d = Object.values(w.devices).find((x) => x.hostname === t.hostname);
          if (d) d.drained = true;
          flag(w, `drained:${t.key}`);
          toast(w, 'info', `${t.key}: host released to DCO — safe to power off.`);
        }
        break;
      }
      case 'bmc_reset_done':
        if (dev) {
          dev.bmc.responsive = true;
          dev.quirks = dev.quirks.filter((q) => q !== 'bmc_hung');
          addSel(w, dev, 'BMC', 'BMC firmware restarted (cold reset)', 'info');
          flag(w, `bmc_recovered:${dev.id}`);
          toast(w, 'success', `BMC for ${dev.hostname} is back online.`);
        }
        break;
      case 'thermal_check':
        if (dev && dev.power === 'on') {
          const t = Math.max(cpuTemp(dev, 0), cpuTemp(dev, 1));
          if (t >= 95) {
            addSel(w, dev, 'Temp CPU', `CPU temperature Upper Critical going high (${t}C) — throttling`, 'critical');
            flag(w, `thermal:${dev.id}`);
            if (!dev.layers.shroud) penalize(w, 'shroud_missing', 10, `${dev.hostname} overheating — the air shroud was left out`, { key: dev.id });
          }
        }
        break;
      case 'part_arrives': {
        const t = ev.ticketKey ? w.tickets[ev.ticketKey] : undefined;
        const pn = String(ev.payload?.pn ?? '');
        if (t) t.worklogs.push({ t: w.t, author: 'parts-logistics', kind: 'system', text: `Part ${pn} delivered to the parts cage. Pick up and scan out.` });
        if (pn && MODELS && partSpec(pn)) {
          const c = makeComponent(new Rng(w.seed + Math.round(w.t)), pn);
          w.spares.push({ component: c, label: `${partSpec(pn).desc}  [PN ${pn}]`, location: 'cage' });
        }
        flag(w, `part_arrived:${ev.ticketKey}`);
        break;
      }
      case 'ticket_arrives': {
        const idx = w.ticketQueue.findIndex((q) => q.key === ev.ticketKey);
        if (idx >= 0) {
          const [tk] = w.ticketQueue.splice(idx, 1);
          const age = tk.slaDueAt - tk.createdAt;
          w.tickets[tk.key] = { ...tk, createdAt: w.t, slaDueAt: w.t + age };
          toast(w, 'info', `New ticket ${tk.key} (${tk.priority}): ${tk.summary}`);
        }
        break;
      }
    }
  }
}

/** Advance simulation time. Called by the UI clock and by actions that take time. */
export function advance(w: World, dt: number) {
  if (dt <= 0) return;
  const target = w.t + dt;
  while (w.pending.length && w.pending[0].at <= target) {
    w.t = Math.max(w.t, w.pending[0].at);
    processPending(w);
  }
  w.t = target;
  // continuous rules
  for (const dev of Object.values(w.devices)) {
    if (dev.role !== 'server' || dev.power !== 'on') continue;
    if (!dev.layers.lid) {
      const k = `lid_open_since:${dev.id}`;
      if (!w.flags[k]) flag(w, k);
      else if (w.t - w.flags[k].first > 300) penalize(w, 'lid_open_long', 5, `${dev.hostname} ran with the lid off for over 5 minutes`, { key: dev.id });
    } else delete w.flags[`lid_open_since:${dev.id}`];
  }
}

export function nextPendingAt(w: World): number | null {
  return w.pending.length ? w.pending[0].at : null;
}

export function modelSlot(dev: Device, slot: string) {
  return MODELS[dev.model].slots.find((s) => s.id === slot);
}

export function expectedPn(dev: Device, slot: string): string | undefined {
  const def = modelSlot(dev, slot);
  return def ? MODELS[dev.model].defaultParts[def.kind] : undefined;
}

export function partLabel(pn: string): string {
  return partSpec(pn).desc;
}
