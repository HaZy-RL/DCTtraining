// ipmitool — in-band (on the host, /dev/ipmi0) and out-of-band (-I lanplus from the jump host).
import { MODELS, partSpec } from '../catalog';
import { hasAC, healthLed, sensors } from '../projectors';
import type { Device } from '../types';
import type { CmdCtx, CmdOut } from './core';

function selDate(t: number): string {
  const d = new Date(Date.UTC(2026, 9, 9, 14, 0, 0) + t * 1000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getUTCFullYear()} | ${d.toISOString().slice(11, 19)}`;
}

export function selLines(dev: Device, extended: boolean): string {
  if (!dev.sel.length) return 'SEL has no entries';
  return dev.sel
    .map((e) => {
      const id = e.id.toString(16).padStart(4, ' ');
      const sensorType = e.sensor.split(' ')[0];
      return extended
        ? `${id} | ${selDate(e.t)} | ${e.sensor} | ${e.event} | ${e.dir}`
        : `${id} | ${selDate(e.t)} | ${sensorType} #0x${(e.id * 7 % 255).toString(16).padStart(2, '0')} | ${e.event.split(' |')[0]} | ${e.dir}`;
    })
    .join('\n');
}

function sdr(ctx: CmdCtx, dev: Device, filter?: string): string {
  const s = sensors(ctx.w, dev);
  ctx.api.dispatch({ type: 'setFlag', name: `viewed:${dev.id}:health` });
  for (const t of ['power', 'fans', 'bios', 'memory', 'cpu', 'gpu']) ctx.api.dispatch({ type: 'setFlag', name: `viewed:${dev.id}:${t}` });
  const f = filter?.toLowerCase();
  return s
    .filter((x) => {
      if (!f) return true;
      if (f.startsWith('fan')) return x.name.startsWith('Fan');
      if (f.startsWith('temp')) return x.unit.includes('degrees');
      if (f.startsWith('power')) return x.name.startsWith('PSU') || x.name.startsWith('PS ');
      if (f.startsWith('mem')) return x.name.startsWith('Memory') || x.name.startsWith('DIMM');
      return x.name.toLowerCase().includes(f);
    })
    .map((x) => `${x.name.padEnd(17)}| ${(x.value === 'na' ? 'no reading' : `${x.value} ${x.unit === 'discrete' ? '' : x.unit}`).padEnd(18)}| ${x.status}`)
    .join('\n');
}

function fru(dev: Device): string {
  const m = MODELS[dev.model];
  const out = [
    `FRU Device Description : Builtin FRU Device (ID 0)\n Chassis Type          : Rack Mount Chassis\n Chassis Part Number   : ${m.id.toUpperCase()}\n Chassis Serial        : ${dev.serial}\n Board Mfg             : Generic Hyperscale\n Board Product         : ${m.name.split(' ')[0]}-MB\n Board Serial          : MB${dev.serial.slice(2)}\n Product Name          : ${m.name.split(' ')[0]}\n Product Serial        : ${dev.serial}\n Product Asset Tag     : ${dev.assetTag}`,
  ];
  for (const p of ['PSU1', 'PSU2']) {
    const c = dev.slots[p];
    if (c) out.push(`FRU Device Description : ${p} (ID ${p === 'PSU1' ? 1 : 2})\n Board Product         : ${partSpec(c.partNumber).desc}\n Board Serial          : ${c.serial}\n Board Part Number     : ${c.partNumber}`);
  }
  return out.join('\n\n');
}

/** Run ipmitool against a device. `inband` = executed on the host itself. */
export function ipmitoolCmd(ctx: CmdCtx, dev: Device, inband: boolean): CmdOut {
  const args = ctx.args.filter((a, i, arr) => !['-I', '-H', '-U', '-P'].includes(arr[i - 1]) && !['-I', '-H', '-U', '-P', '-E'].includes(a));
  const [a0, a1, a2] = args;
  const timeout = { err: 'Error: Unable to establish IPMI v2 / RMCP+ session', code: 1 };
  // In-band resets can still reach a hung BMC through KCS.
  const isReset = a0 === 'mc' && a1 === 'reset';
  if (!hasAC(ctx.w, dev)) return inband ? { err: 'Could not open device', code: 1 } : timeout;
  if (!dev.bmc.responsive && !(inband && isReset)) {
    return inband ? { err: 'ipmi_kcs: KCS interface timed out\nGet Device ID command failed: 0xc3 Timeout', code: 1 } : timeout;
  }
  const d = ctx.api.dispatch;
  switch (a0) {
    case 'chassis':
      if (a1 === 'status') {
        const on = dev.power === 'on' || dev.power === 'posting';
        return {
          out: `System Power         : ${on ? 'on' : 'off'}\nPower Overload       : false\nPower Interlock      : inactive\nMain Power Fault     : false\nPower Control Fault  : false\nPower Restore Policy : always-on\nLast Power Event     : ${ctx.w.flags[`power_cycle:${dev.id}`] ? 'command' : ''}\nChassis Intrusion    : ${dev.layers.lid ? 'inactive' : 'active'}\nFront-Panel Lockout  : inactive\nDrive Fault          : ${Object.values(dev.slots).some((c) => (c?.kind === 'hdd' || c?.kind === 'nvme') && c.health !== 'ok') ? 'true' : 'false'}\nCooling/Fan Fault    : ${Object.values(dev.slots).some((c) => c?.kind === 'fan' && c.health !== 'ok') ? 'true' : 'false'}\nFront Panel Light    : ${healthLed(ctx.w, dev)}`,
        };
      }
      if (a1 === 'power') return powerCmd(ctx, dev, a2);
      if (a1 === 'identify') {
        const on = a2 !== '0';
        d({ type: 'locate', deviceId: dev.id, on });
        return { out: on ? `Chassis identify interval: ${a2 === 'force' ? 'indefinite' : `${a2 ?? 15} seconds`}` : 'Chassis identify interval: off' };
      }
      if (a1 === 'bootdev') {
        if (!a2) return { err: 'usage: chassis bootdev <pxe|disk|bios|safe|diag|cdrom|floppy>', code: 1 };
        if (a2 === 'disk') d({ type: 'setBootOrder', deviceId: dev.id, order: ['NVMe: M.2 Boot 0', 'NVMe: M.2 Boot 1', 'PXE: OCP0 Port 0', 'UEFI Shell'] });
        if (a2 === 'pxe') d({ type: 'setBootOrder', deviceId: dev.id, order: ['PXE: OCP0 Port 0', 'NVMe: M.2 Boot 0', 'NVMe: M.2 Boot 1', 'UEFI Shell'] });
        return { out: `Set Boot Device to ${a2}` };
      }
      return { err: 'Chassis Commands:  status, power, identify, policy, restart_cause, poh, bootdev, bootparam, selftest', code: 1 };
    case 'power':
      return powerCmd(ctx, dev, a1);
    case 'sel': {
      if (!a1 || a1 === 'list' || a1 === 'elist') {
        d({ type: 'setFlag', name: `sel_viewed:${dev.id}` });
        d({ type: 'setFlag', name: `viewed:${dev.id}:sel` });
        return { out: selLines(dev, a1 === 'elist') };
      }
      if (a1 === 'clear') {
        const r = d({ type: 'selClear', deviceId: dev.id });
        return r.ok ? { out: r.message } : { err: r.message, code: 1 };
      }
      if (a1 === 'info')
        return { out: `SEL Information\nVersion          : 1.5 (v1.5, v2 compliant)\nEntries          : ${dev.sel.length}\nFree Space       : ${65535 - dev.sel.length * 16} bytes\nPercent Used     : ${Math.round((dev.sel.length / 4096) * 100)}%\nOverflow         : false` };
      if (a1 === 'save' && a2) {
        d({ type: 'setFlag', name: `sel_viewed:${dev.id}` });
        return { out: `Saved ${dev.sel.length} SEL entries to ${a2}` };
      }
      return { err: 'SEL Commands:  info clear delete list elist get add time save readraw writeraw', code: 1 };
    }
    case 'sdr':
      if (a1 === 'type') return { out: sdr(ctx, dev, a2) };
      return { out: sdr(ctx, dev) };
    case 'sensor':
      return { out: sdr(ctx, dev, a1 === 'list' ? undefined : a2) };
    case 'fru':
      d({ type: 'setFlag', name: `viewed:${dev.id}:inventory` });
      return { out: fru(dev) };
    case 'mc':
      if (a1 === 'info')
        return { out: `Device ID                 : 32\nDevice Revision           : 1\nFirmware Revision         : ${dev.bmc.fw.replace('BMC ', '')}\nIPMI Version              : 2.0\nManufacturer ID           : 57005\nManufacturer Name         : Generic Hyperscale\nProduct ID                : 2208` };
      if (a1 === 'reset') {
        if (a2 !== 'cold' && a2 !== 'warm') return { err: 'usage: mc reset <warm|cold>', code: 1 };
        const r = d({ type: 'bmcReset', deviceId: dev.id, inband });
        return r.ok ? { out: `Sent ${a2} reset command to MC` } : { err: r.message, code: 1 };
      }
      return { err: 'MC Commands:\n  reset <warm|cold>\n  info\n  selftest', code: 1 };
    case 'lan':
      if (a1 === 'print')
        return { out: `Set in Progress         : Set Complete\nIP Address Source       : DHCP Address\nIP Address              : ${dev.bmc.ip}\nSubnet Mask             : 255.255.255.0\nMAC Address             : ${dev.bmc.mac.toLowerCase()}\nDefault Gateway IP      : ${dev.bmc.ip.replace(/\.\d+$/, '.1')}\n802.1q VLAN ID          : Disabled` };
      return { err: 'usage: lan print [channel]', code: 1 };
    case 'sol':
      if (inband) return { err: 'SOL from the host itself makes no sense — run it from the jump host.', code: 1 };
      if (a1 === 'activate') return { out: '__SOL__' };
      if (a1 === 'deactivate') return { out: '' };
      return { err: 'SOL Commands: info [<channel number>]\n              activate [<usesolkeepalive> | <usecolor>] [instance=<number>]\n              deactivate', code: 1 };
    case undefined:
      return { err: 'No command provided!\nCommands:\n\tchassis   power   sel   sdr   sensor   fru   mc   lan   sol', code: 1 };
    default:
      return { err: `Invalid command: ${a0}`, code: 1 };
  }
}

function powerCmd(ctx: CmdCtx, dev: Device, op?: string): CmdOut {
  if (!op || op === 'status') {
    ctx.api.dispatch({ type: 'setFlag', name: `viewed:${dev.id}:power` });
    return { out: `Chassis Power is ${dev.power === 'on' || dev.power === 'posting' ? 'on' : 'off'}` };
  }
  const map: Record<string, 'on' | 'off' | 'soft' | 'cycle' | 'reset'> = { on: 'on', off: 'off', soft: 'soft', cycle: 'cycle', reset: 'reset' };
  const o = map[op];
  if (!o) return { err: 'chassis power Commands: status, on, off, cycle, reset, diag, soft', code: 1 };
  const r = ctx.api.dispatch({ type: 'bmcPower', deviceId: dev.id, op: o });
  if (!r.ok) return { err: r.message, code: 1 };
  const label = o === 'soft' ? 'Soft' : o === 'cycle' ? 'Cycle' : o === 'reset' ? 'Reset' : o === 'on' ? 'Up/On' : 'Down/Off';
  return { out: `Chassis Power Control: ${label}` };
}
