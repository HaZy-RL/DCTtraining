// Vendor BMC command lines: Dell iDRAC racadm, HPE iLO SMASH CLP, Lenovo XCC CLI, Supermicro SMASH-CLP.
// Command names and output layouts follow the real CLIs closely; values come from the sim.
import { KIND_LABEL, MODELS, partSpec } from '../catalog';
import { goodPsuCount, healthRollup, linkState, sensors } from '../projectors';
import type { Device, SelEntry, World } from '../types';
import { vendorEvent } from '../vendorlog';
import { VENDORS, type VendorId } from '../vendors';
import { columns, type CmdCtx, type CmdOut, type CommandPack } from './core';

type Out = CmdOut | string;

export const VENDOR_PROMPT: Record<VendorId, string> = {
  dell: 'racadm>> ',
  hpe: '</>hpiLO-> ',
  lenovo: 'system> ',
  supermicro: '-> ',
};

const dev = (ctx: CmdCtx): Device => ctx.w.devices[ctx.frame.deviceId!];
const flag = (ctx: CmdCtx, n: string) => ctx.api.dispatch({ type: 'setFlag', name: n });
const isOn = (d: Device) => d.power === 'on' || d.power === 'posting';
const at = (t: number) => new Date(Date.UTC(2026, 9, 9, 14, 0, 0) + t * 1000);
const iso = (t: number) => at(t).toISOString().replace('T', ' ').slice(0, 19);
const sevWord = (e: SelEntry) => (e.severity === 'critical' ? 'Critical' : e.severity === 'warning' ? 'Warning' : 'Ok');

function viewedHw(ctx: CmdCtx, d: Device, topics: string[]) {
  for (const t of topics) flag(ctx, `viewed:${d.id}:${t}`);
}
function viewedLog(ctx: CmdCtx, d: Device) {
  flag(ctx, `sel_viewed:${d.id}`);
  flag(ctx, `viewed:${d.id}:sel`);
}

function power(ctx: CmdCtx, d: Device, op: 'on' | 'off' | 'soft' | 'cycle' | 'reset', ok: string): Out {
  const r = ctx.api.dispatch({ type: 'bmcPower', deviceId: d.id, op });
  return r.ok ? ok : { err: r.message, code: 1 };
}

function selClear(ctx: CmdCtx, d: Device, ok: string): Out {
  const r = ctx.api.dispatch({ type: 'selClear', deviceId: d.id });
  return r.ok ? ok : { err: r.message, code: 1 };
}

function sol(ctx: CmdCtx, d: Device, banner: string): Out {
  ctx.session.push({ kind: 'sol', deviceId: d.id, user: 'sol', hostLabel: d.hostname, cwd: '/', raw: true, state: { printed: 0, lineStart: true, esc: '' } });
  flag(ctx, `sol:${d.id}`);
  flag(ctx, `sel_viewed:${d.id}`);
  return { out: banner };
}

const sensorTable = (w: World, d: Device) => columns([['Sensor', 'Status', 'Reading'], ...sensors(w, d).map((s) => [s.name, { ok: 'Ok', nc: 'Warning', cr: 'Critical', ns: 'N/A' }[s.status], s.value === 'na' ? 'N/A' : `${s.value} ${s.unit === 'discrete' ? '' : s.unit.replace('degrees C', 'C')}`])]);

const exit = (ctx: CmdCtx): Out => {
  ctx.session.pop();
  return 'Connection closed.';
};

// ---------- Dell iDRAC9 racadm ----------

/** Dell FQDD for a slot, as racadm hwinventory names devices. */
function fqdd(slot: string, label: string): string {
  if (slot.startsWith('DIMM_')) return `DIMM.Socket.${label}`;
  if (slot.startsWith('PSU')) return `PSU.Slot.${slot.slice(3)}`;
  if (slot.startsWith('FAN')) return `Fan.Embedded.${slot.slice(3)}`;
  if (slot.startsWith('BAY')) return `Disk.Bay.${slot.slice(3)}:Enclosure.Internal.0-1`;
  if (slot.startsWith('CPU')) return `CPU.Socket.${Number(slot.slice(3)) + 1}`;
  if (slot.startsWith('M2_')) return `Disk.Direct.${slot.slice(3)}-${slot.slice(3)}:BOSS.SL.14-1`;
  return { OCP0: 'NIC.Integrated.1-1-1', PCIE1: 'Video.Slot.1-1', CMOS: 'System.Embedded.1' }[slot] ?? slot;
}

/** Dell Express Service Code: the Service Tag read as base 36, printed in decimal. */
export function expressServiceCode(tag: string): string {
  let n = 0n;
  for (const ch of tag.toUpperCase()) n = n * 36n + BigInt(parseInt(ch, 36));
  return n.toString();
}

function racadm(ctx: CmdCtx, d: Device, args: string[]): Out {
  const [sub, ...rest] = args;
  const w = ctx.w;
  const m = MODELS[d.model];
  if (!d.bmc.responsive) return { err: 'ERROR: Unable to perform the requested operation. The iDRAC is busy; retry after a few minutes.', code: 1 };
  switch ((sub ?? '').toLowerCase()) {
    case 'getsysinfo':
      viewedHw(ctx, d, ['inventory', 'health']);
      return `RAC Information:\nRAC Date/Time           = ${at(w.t).toUTCString()}\nFirmware Version        = ${d.bmc.fw.replace('iDRAC9 ', '')}\nFirmware Build          = 23\nLast Firmware Update    = 08/14/2026 10:12:41\nHardware Version        = 0.01\nMAC Address             = ${d.bmc.mac}\n\nCommon settings:\nRegister DNS RAC Name   = 0\nDNS RAC Name            = ${d.hostname}-bmc\n\nIPv4 settings:\nEnabled                 = 1\nCurrent IP Address      = ${d.bmc.ip}\nDHCP Enabled            = 0\n\nSystem Information:\nSystem Model            = ${m.name.replace(/ \(.*/, '')}\nSystem Revision         = I\nSystem BIOS Version     = 2.3.5\nService Tag             = ${d.serial}\nExpress Svc Code        = ${expressServiceCode(d.serial)}\nHost Name               = ${d.hostname}\nOS Name                 = Ubuntu 24.04.1 LTS\nPower Status            = ${isOn(d) ? 'ON' : 'OFF'}\nSystem Health           = ${healthRollup(w, d).overall === 'ok' ? 'Ok' : healthRollup(w, d).overall === 'warning' ? 'Non-Critical' : 'Critical'}\n\nWatchdog Information:\nRecovery Action         = None\nPresent countdown value = 479 seconds\nInitial countdown value = 480 seconds`;
    case 'getsvctag':
      return d.serial;
    case 'getsel':
      viewedLog(ctx, d);
      if (!d.sel.length) return 'No SEL records found.';
      return d.sel
        .map((e) => {
          const ev = vendorEvent(d, e);
          return `Record:      ${e.id}\nDate/Time:   ${at(e.t).toLocaleDateString('en-US', { timeZone: 'UTC' })} ${at(e.t).toISOString().slice(11, 19)}\nSource:      system\nSeverity:    ${sevWord(e)}\nDescription: ${ev.text}`;
        })
        .join('\n-------------------------------------------------------------------------------\n');
    case 'clrsel':
      return selClear(ctx, d, 'The SEL was cleared successfully.');
    case 'lclog': {
      if (rest[0] !== 'view') return { err: 'ERROR: Invalid subcommand. Usage: racadm lclog view [-n <count>] [-s <severity>]', code: 1 };
      viewedLog(ctx, d);
      const n = rest.includes('-n') ? Number(rest[rest.indexOf('-n') + 1]) : 100;
      const sv = rest.includes('-s') ? rest[rest.indexOf('-s') + 1]?.toLowerCase() : undefined;
      const rows = [...d.sel]
        .reverse()
        .filter((e) => !sv || sevWord(e).toLowerCase() === sv || (sv === 'warning' && e.severity === 'warning'))
        .slice(0, n);
      if (!rows.length) return 'No Lifecycle Log records found.';
      return rows
        .map((e) => {
          const ev = vendorEvent(d, e);
          return `SeqNumber       = ${4000 + e.id}\nMessage ID      = ${ev.code}\nCategory        = System Health\nAgentID         = iDRAC\nSeverity        = ${sevWord(e)}\nTimestamp       = ${iso(e.t)}\nMessage         = ${ev.text}\nFQDD            = ${ev.category}`;
        })
        .join('\n-------------------------------------------------------------------------------\n');
    }
    case 'getsensorinfo':
      viewedHw(ctx, d, ['health', 'power', 'fans', 'bios', 'cpu']);
      return `Sensor Type : TEMPERATURE / FAN / POWER\n${sensorTable(w, d)}\n\nRedundancy Status: PS Redundancy ${goodPsuCount(w, d) >= 2 ? 'Full Redundant' : 'Lost'}`;
    case 'hwinventory':
      viewedHw(ctx, d, ['inventory', 'memory', 'cpu', 'gpu', 'network', 'storage']);
      return m.slots
        .filter((s) => d.slots[s.id])
        .map((s) => {
          const c = d.slots[s.id]!;
          return `-------------------------------------------------------------------\n[InstanceID: ${fqdd(s.id, s.label)}]\nDevice Type = ${KIND_LABEL[s.kind]}\nDeviceDescription = ${s.label}\nPartNumber = ${c.partNumber}\nModel = ${partSpec(c.partNumber).desc}\nSerialNumber = ${c.serial}\nPrimaryStatus = ${c.health === 'ok' ? 'OK' : c.health === 'degraded' ? 'Degraded' : 'Error'}`;
        })
        .join('\n');
    case 'storage':
      viewedHw(ctx, d, ['storage', 'raid']);
      if (rest[0] !== 'get' || rest[1] !== 'pdisks') return { err: 'ERROR: Usage: racadm storage get pdisks [-o]', code: 1 };
      return m.slots
        .filter((s) => s.kind === 'hdd' || s.kind === 'nvme' || s.kind === 'm2')
        .map((s) => {
          const c = d.slots[s.id];
          return `${fqdd(s.id, s.label)}\n   Status          = ${!c ? 'Unknown' : c.health === 'ok' ? 'Ok' : c.health === 'degraded' ? 'Non-Critical' : 'Critical'}\n   State           = ${!c ? 'Not Present' : c.health === 'failed' ? 'Failed' : 'Online'}\n   PredictiveFailureState = ${c?.health === 'degraded' ? 'Smart Alert Present' : 'Smart Alert Absent'}${c ? `\n   SerialNumber    = ${c.serial}\n   PartNumber      = ${c.partNumber}` : ''}`;
        })
        .join('\n');
    case 'serveraction': {
      const op = (rest[0] ?? '').toLowerCase();
      if (op === 'powerstatus') return `Server power status: ${isOn(d) ? 'ON' : 'OFF'}`;
      const map: Record<string, 'on' | 'off' | 'soft' | 'cycle' | 'reset'> = { powerup: 'on', powerdown: 'off', graceshutdown: 'soft', powercycle: 'cycle', hardreset: 'reset' };
      if (!map[op]) return { err: 'ERROR: Invalid action. Use: powerstatus | powerup | powerdown | graceshutdown | powercycle | hardreset', code: 1 };
      return power(ctx, d, map[op], 'Server power operation successful');
    }
    case 'setled': {
      const v = rest[rest.indexOf('-l') + 1];
      if (!rest.includes('-l') || !['0', '1'].includes(v)) return { err: 'ERROR: Usage: racadm setled -l <0|1>   (1 = blink the system ID LED, 0 = stop)', code: 1 };
      ctx.api.dispatch({ type: 'locate', deviceId: d.id, on: v === '1' });
      return v === '1' ? 'LED blink on.' : 'LED blink off.';
    }
    case 'getled':
      return `LED State : ${d.locateLed ? 'Blinking' : 'Not-Blinking'}`;
    case 'racreset': {
      const r = ctx.api.dispatch({ type: 'bmcReset', deviceId: d.id });
      return r.ok ? 'RAC reset operation initiated successfully. It may take a few minutes for the RAC to come online again.' : { err: r.message, code: 1 };
    }
    case 'get':
      if (/^idrac\.nic/i.test(rest[0] ?? '')) return `[Key=iDRAC.Embedded.1#NIC.1]\nMACAddress=${d.bmc.mac}\nSelection=Dedicated\nSpeed=1000\nDuplex=Full\n[Key=iDRAC.Embedded.1#IPv4.1]\nAddress=${d.bmc.ip}`;
      return { err: `ERROR: ${rest[0] ?? '<group>'} is not supported in this training build. Try: get iDRAC.NIC`, code: 1 };
    case 'help':
    case '':
      return `\x1b[1mracadm (iDRAC9)\x1b[0m
  getsysinfo                     system + iDRAC summary (Service Tag, Express Service Code, power, health)
  getsvctag                      print the Service Tag
  lclog view [-n N] [-s critical] Lifecycle Log with message IDs (MEM0001, PSU0001, ...)
  getsel / clrsel                System Event Log / clear it
  getsensorinfo                  temperatures, fans, PSU redundancy
  hwinventory                    every component by FQDD with part and serial numbers
  storage get pdisks             physical disks and their state
  serveraction powerstatus|powerup|powerdown|graceshutdown|powercycle|hardreset
  setled -l 1|0 / getled         blink the system ID LED
  racreset                       reboot the iDRAC (host keeps running)
  get iDRAC.NIC                  iDRAC network settings
  console com2                   serial console (SOL); leave with ^\\ or ~~.
  exit`;
    default:
      return { err: `ERROR: Invalid subcommand specified. ("${sub}")\nUse "racadm help" for a list of subcommands.`, code: 1 };
  }
}

const dellPack: CommandPack = {
  help: '',
  commands: {
    exit,
    quit: exit,
    console: (ctx) => (ctx.args[0] === 'com2' ? sol(ctx, dev(ctx), 'Connected to Serial Device 2. To end type: ^\\  (or ~~. from the jump host)') : { err: 'Usage: console com2', code: 1 }),
    help: (ctx) => racadm(ctx, dev(ctx), ['help']),
    racadm: (ctx) => (ctx.args[0] === 'console' ? sol(ctx, dev(ctx), 'Connected to Serial Device 2.') : racadm(ctx, dev(ctx), ctx.args)),
  },
};
// Inside the iDRAC shell you may drop the "racadm" prefix.
for (const sub of ['getsysinfo', 'getsvctag', 'getsel', 'clrsel', 'lclog', 'getsensorinfo', 'hwinventory', 'storage', 'serveraction', 'setled', 'getled', 'racreset', 'get'])
  dellPack.commands[sub] = (ctx) => racadm(ctx, dev(ctx), [sub, ...ctx.args]);

/** `racadm -r <host>-bmc -u root -p <pw> <sub>` from the jump host. */
export function remoteRacadm(ctx: CmdCtx, resolveBmc: (host: string) => Device | null | 'prod' | 'down'): Out {
  const a = ctx.args;
  const get = (f: string) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
  const host = get('-r');
  if (!host) return { err: 'ERROR: Unable to connect to RAC. Use: racadm -r <host>-bmc -u root -p <password> <subcommand>', code: 1 };
  const pw = get('-p');
  const sub = a.filter((x, i) => !x.startsWith('-') && !['-r', '-u', '-p'].includes(a[i - 1]) && x !== 'racadm');
  const r = resolveBmc(host);
  if (r === null || r === 'down') return { err: `ERROR: Unable to connect to RAC at specified IP address.`, code: 1 };
  if (r === 'prod') return { err: `ERROR: Unable to connect to RAC at specified IP address.\n(${host} is the host's production address; iDRAC answers on <host>-bmc)`, code: 1 };
  if (MODELS[r.model].vendor !== 'dell') return { err: 'ERROR: Unable to connect to RAC at specified IP address. (that BMC is not an iDRAC)', code: 1 };
  if (!get('-u') || !pw) return { err: 'ERROR: Login failed - invalid username or password (use -u root -p $IDRAC_PASSWORD)', code: 1 };
  if (pw === 'calvin') return { err: "ERROR: Login failed - invalid username or password\n(16G iDRACs ship with a unique password printed on the pull-out information tag; 'calvin' is not the default anymore. Use the vaulted $IDRAC_PASSWORD.)", code: 1 };
  const out = racadm({ ...ctx, frame: { ...ctx.frame, deviceId: r.id } }, r, sub);
  return typeof out === 'string' ? `Security Alert: Certificate is invalid - self-signed certificate\nContinuing execution. Use -S option for racadm to stop execution on certificate-related errors.\n${out}` : out;
}

// ---------- HPE iLO 6 (SMASH CLP) ----------

function clp(target: string, props: Array<[string, string]>, targets: string[] = []): string {
  return `status=0\nstatus_tag=COMMAND COMPLETED\n${at(0).toUTCString()}\n\n${target}\n  Targets\n${targets.map((t) => `    ${t}`).join('\n') || '    (none)'}\n  Properties\n${props.map(([k, v]) => `    ${k}=${v}`).join('\n')}\n  Verbs\n    cd version exit show set start stop reset delete`;
}

const hpePack: CommandPack = {
  help: '',
  commands: {
    exit,
    help: () => `\x1b[1miLO 6 CLI (DMTF SMASH CLP)\x1b[0m
  show /system1                  server summary (model, serial, power, health)
  show /system1/log1             Integrated Management Log (IML)
  delete /system1/log1           clear the IML
  show /map1/log1                iLO event log
  show /system1/sensors          temperatures, fans, power supplies
  show /system1/inventory        FRUs with HPE spare part and serial numbers
  power | power on | power off | power off hard | power reset
  uid | uid on | uid off         Unit ID (blue) LED
  vsp                            Virtual Serial Port (serial console); leave with ESC (
  reset /map1                    reset iLO (host keeps running)
  exit`,
    show: (ctx) => {
      const d = dev(ctx);
      const m = MODELS[d.model];
      const t = (ctx.args[0] ?? '/').toLowerCase();
      if (!d.bmc.responsive) return { err: 'status=2\nstatus_tag=COMMAND PROCESSING FAILED\nerror_tag=COMMAND ERROR-UNSPECIFIED\niLO is busy.', code: 1 };
      if (t === '/' || t === '/system1') {
        viewedHw(ctx, d, ['inventory', 'health']);
        const h = healthRollup(ctx.w, d).overall;
        return clp('/system1', [
          ['name', `HPE ${m.name.replace(/ \(.*/, '')}`],
          ['number', d.serial],
          ['oemHPE_server_name', d.hostname],
          ['enabledstate', isOn(d) ? 'enabled' : 'disabled'],
          ['processor_number', '2'],
          ['oemHPE_powerreg', 'dynamic'],
          ['oemHPE_health', h === 'ok' ? 'OK' : h === 'warning' ? 'Degraded' : 'Critical'],
        ], ['firmware1', 'bootconfig1', 'log1', 'led1', 'network1', 'oemHPE_power1', 'sensors', 'inventory']);
      }
      if (t === '/system1/log1' || t === '/map1/log1') {
        viewedLog(ctx, d);
        if (!d.sel.length) return clp(t, [['number', '0']]);
        return `status=0\nstatus_tag=COMMAND COMPLETED\n\n${t}\n  Targets\n${d.sel.map((e) => `    record${e.id}`).join('\n')}\n\n${d.sel
          .map((e) => {
            const ev = vendorEvent(d, e);
            return `${t}/record${e.id}\n  Properties\n    number=${e.id}\n    severity=${e.severity === 'critical' ? 'Critical' : e.severity === 'warning' ? 'Caution' : 'Informational'}\n    date=${at(e.t).toLocaleDateString('en-US', { timeZone: 'UTC' })}\n    time=${at(e.t).toISOString().slice(11, 16)}\n    class=${ev.category}\n    description=${ev.text}`;
          })
          .join('\n\n')}`;
      }
      if (t === '/system1/sensors') {
        viewedHw(ctx, d, ['health', 'power', 'fans', 'bios', 'cpu']);
        return `status=0\nstatus_tag=COMMAND COMPLETED\n\n${sensorTable(ctx.w, d)}\n\nPower Supply Redundancy: ${goodPsuCount(ctx.w, d) >= 2 ? 'Redundant' : 'Not Redundant'}`;
      }
      if (t === '/system1/inventory') {
        viewedHw(ctx, d, ['inventory', 'memory', 'cpu', 'gpu', 'network', 'storage']);
        return columns([['LOCATION', 'SPARE PART', 'SERIAL', 'STATUS'], ...m.slots.filter((s) => d.slots[s.id]).map((s) => { const c = d.slots[s.id]!; return [s.label, c.partNumber, c.serial, c.health === 'ok' ? 'OK' : c.health === 'degraded' ? 'Degraded' : 'Failed']; })]);
      }
      return { err: `status=2\nstatus_tag=COMMAND PROCESSING FAILED\nerror_tag=COMMAND ERROR-UNSPECIFIED\nInvalid target "${ctx.args[0]}". Try: show /system1, show /system1/log1`, code: 1 };
    },
    delete: (ctx) => (/^\/system1\/log1$/i.test(ctx.args[0] ?? '') ? selClear(ctx, dev(ctx), 'status=0\nstatus_tag=COMMAND COMPLETED\nIML cleared.') : { err: 'status=2\nstatus_tag=COMMAND PROCESSING FAILED\nUsage: delete /system1/log1', code: 1 }),
    power: (ctx) => {
      const d = dev(ctx);
      const [a, b] = ctx.args.map((x) => x.toLowerCase());
      if (!a) return `power: server power is currently: ${isOn(d) ? 'On' : 'Off'}`;
      if (a === 'on') return power(ctx, d, 'on', 'Server powering on .......');
      if (a === 'off' && b === 'hard') return power(ctx, d, 'off', 'Forcing server power off .......');
      if (a === 'off') return power(ctx, d, 'soft', 'Server powering off (momentary press) .......');
      if (a === 'reset') return power(ctx, d, 'reset', 'Server resetting .......');
      return { err: 'Usage: power [on | off [hard] | reset]', code: 1 };
    },
    uid: (ctx) => {
      const d = dev(ctx);
      const a = ctx.args[0]?.toLowerCase();
      if (!a) return `Current UID Status: ${d.locateLed ? 'On' : 'Off'}`;
      if (a !== 'on' && a !== 'off') return { err: 'Usage: uid [on|off]', code: 1 };
      ctx.api.dispatch({ type: 'locate', deviceId: d.id, on: a === 'on' });
      return `status=0\nstatus_tag=COMMAND COMPLETED\nUID is now ${a === 'on' ? 'On' : 'Off'}.`;
    },
    vsp: (ctx) => sol(ctx, dev(ctx), 'Virtual Serial Port Active: COM2\n Starting virtual serial port.\n Press \'ESC (\' to return to the CLI Session.  (~~. from the jump host)'),
    reset: (ctx) => {
      if (!/^\/map1$/i.test(ctx.args[0] ?? '')) return { err: 'Usage: reset /map1   (resets iLO; use "power reset" for the server)', code: 1 };
      const r = ctx.api.dispatch({ type: 'bmcReset', deviceId: dev(ctx).id });
      return r.ok ? 'status=0\nstatus_tag=COMMAND COMPLETED\nResetting iLO.\nCLI session stopped' : { err: r.message, code: 1 };
    },
  },
};

// ---------- Lenovo XCC2 ----------

const lenovoPack: CommandPack = {
  help: '',
  commands: {
    exit,
    help: () => `\x1b[1mXClarity Controller CLI\x1b[0m
  syshealth summary | activeevents   overall health and the active FQXSP events
  readlog [-a] / clearlog            event log
  vpd sys | vpd bmc                  machine type, serial number, firmware
  fans | temps                       cooling and temperature readings
  power state | on | off [-s] | cycle    (-s = soft/OS shutdown)
  identify [-s on|off|blink]         identify (blue) LED
  led                                front panel / light path LEDs
  resetsp                            reboot the XClarity Controller
  console 1                          serial console (SOL); leave with ESC (
  exit`,
    syshealth: (ctx) => {
      const d = dev(ctx);
      const h = healthRollup(ctx.w, d);
      viewedHw(ctx, d, ['health']);
      if ((ctx.args[0] ?? 'summary') === 'activeevents') {
        viewedLog(ctx, d);
        const act = d.sel.filter((e) => e.severity !== 'info');
        return act.length ? act.map((e) => { const ev = vendorEvent(d, e); return `${e.severity === 'critical' ? 'Critical' : 'Warning'}  ${ev.code}  ${ev.text}`; }).join('\n') : 'No active events.';
      }
      return `Power     ${isOn(d) ? 'On' : 'Off'}\nState     ${isOn(d) ? (d.os === 'up' ? 'OS booted' : 'Booting OS or in unsupported OS') : 'System power off/State unknown'}\nRestarts  ${d.sel.filter((e) => e.sensor === 'System Event').length}\nHealth    ${h.overall === 'ok' ? 'Normal' : h.overall === 'warning' ? 'Warning' : 'Critical'}`;
    },
    readlog: (ctx) => {
      const d = dev(ctx);
      viewedLog(ctx, d);
      if (!d.sel.length) return 'No events.';
      return columns([['No.', 'Type', 'Date/Time', 'Event ID', 'Message'], ...[...d.sel].reverse().map((e, i) => { const ev = vendorEvent(d, e); return [String(i + 1), e.severity === 'critical' ? 'E' : e.severity === 'warning' ? 'W' : 'I', iso(e.t), ev.code!, ev.text]; })]);
    },
    clearlog: (ctx) => selClear(ctx, dev(ctx), 'All event log entries have been cleared.'),
    vpd: (ctx) => {
      const d = dev(ctx);
      viewedHw(ctx, d, ['inventory']);
      if ((ctx.args[0] ?? 'sys') === 'bmc') return `Type      Status    Version         Build     ReleaseDate\nBMC       Active    ${d.bmc.fw.replace('XCC2 ', '')}\nUEFI      Active    3.10 (ESE128F)`;
      return `Machine Type-Model   Serial Number   UUID\n7D76CTO1WW           ${d.serial}        ${d.id.toUpperCase().padEnd(32, '0').slice(0, 32)}`;
    },
    fans: (ctx) => {
      const d = dev(ctx);
      viewedHw(ctx, d, ['fans']);
      return sensors(ctx.w, d).filter((s) => s.name.startsWith('Fan')).map((s) => `${s.name.replace(' RPM', '').padEnd(8)} ${s.value === 'na' ? 'N/A' : `${Math.round(Number(s.value) / 200)}%`}  ${s.status === 'cr' ? 'Critical' : 'Normal'}`).join('\n');
    },
    temps: (ctx) => {
      const d = dev(ctx);
      viewedHw(ctx, d, ['health', 'cpu']);
      return sensors(ctx.w, d).filter((s) => s.unit.includes('degrees')).map((s) => `${s.name.padEnd(14)} ${s.value === 'na' ? 'N/A' : `${s.value} C`}`).join('\n');
    },
    power: (ctx) => {
      const d = dev(ctx);
      const a = ctx.args[0] ?? 'state';
      if (a === 'state') return `Power ${isOn(d) ? 'On' : 'Off'}`;
      if (a === 'on') return power(ctx, d, 'on', 'ok');
      if (a === 'off') return power(ctx, d, ctx.args.includes('-s') ? 'soft' : 'off', 'ok');
      if (a === 'cycle') return power(ctx, d, 'cycle', 'ok');
      return { err: 'Usage: power [state | on | off [-s] | cycle]', code: 1 };
    },
    identify: (ctx) => {
      const d = dev(ctx);
      const v = ctx.args.includes('-s') ? ctx.args[ctx.args.indexOf('-s') + 1] : undefined;
      if (!v) return `-s ${d.locateLed ? 'blink' : 'off'}`;
      ctx.api.dispatch({ type: 'locate', deviceId: d.id, on: v !== 'off' });
      return 'ok';
    },
    led: (ctx) => {
      const d = dev(ctx);
      const h = healthRollup(ctx.w, d);
      const fault = (['memory', 'processors', 'storage', 'power', 'fans', 'network'] as const).filter((k) => h[k] !== 'ok');
      return `Label          State   Color\nFault          ${fault.length ? 'On ' : 'Off'}     Yellow\nIdentify       ${d.locateLed ? 'Blink' : 'Off  '}   Blue\nPower          ${isOn(d) ? 'On ' : 'Blink'}     Green\n${fault.map((k) => `${k[0].toUpperCase() + k.slice(1)} (light path)`.padEnd(15) + 'On      Yellow').join('\n')}`;
    },
    resetsp: (ctx) => {
      const r = ctx.api.dispatch({ type: 'bmcReset', deviceId: dev(ctx).id });
      return r.ok ? 'ok\nThe XClarity Controller is restarting. This session will be closed.' : { err: r.message, code: 1 };
    },
    console: (ctx) => (ctx.args[0] === '1' ? sol(ctx, dev(ctx), "[Serial over LAN] Press 'ESC (' to exit.  (~~. from the jump host)") : { err: 'Usage: console 1', code: 1 }),
  },
};

// ---------- Supermicro SMASH-CLP ----------

const smcPack: CommandPack = {
  help: '',
  commands: {
    exit,
    help: () => `\x1b[1mSupermicro BMC SMASH-CLP\x1b[0m
  show /system1                  system summary
  show /system1/sensors1         sensor readings
  show /system1/log1             Health Event Log
  delete /system1/log1           clear the Health Event Log
  start /system1 | stop /system1 | stop -f /system1 | reset /system1
  set /system1/led1 enabledstate=enabled|disabled    UID LED
  start /system1/sol1            serial-over-LAN console (~~. from the jump host)
  reset /map1                    reset the BMC
  exit
  (Most Supermicro work is done with ipmitool from the jump host, and SUM/SMCIPMITool for firmware.)`,
    show: (ctx) => {
      const d = dev(ctx);
      const m = MODELS[d.model];
      const t = (ctx.args[0] ?? '/system1').toLowerCase();
      if (t === '/system1') {
        viewedHw(ctx, d, ['inventory', 'health']);
        return `/system1\n  Properties:\n    Name=${m.name.replace(/ \(.*/, '')}\n    SerialNumber=${d.serial}\n    EnabledState=${isOn(d) ? 'Enabled' : 'Disabled'}\n    HealthState=${healthRollup(ctx.w, d).overall === 'ok' ? 'OK' : 'Major Failure'}\n  Targets:\n    sensors1 log1 led1 sol1`;
      }
      if (t === '/system1/sensors1') {
        viewedHw(ctx, d, ['health', 'power', 'fans', 'bios', 'cpu']);
        return sensorTable(ctx.w, d);
      }
      if (t === '/system1/log1') {
        viewedLog(ctx, d);
        return d.sel.length ? columns([['ID', 'Time', 'Sensor', 'Description'], ...d.sel.map((e) => { const ev = vendorEvent(d, e); return [String(e.id), iso(e.t), ev.category, ev.text]; })]) : 'No events.';
      }
      return { err: `Invalid target ${ctx.args[0]}`, code: 1 };
    },
    delete: (ctx) => (/^\/system1\/log1$/i.test(ctx.args[0] ?? '') ? selClear(ctx, dev(ctx), 'Health Event Log cleared.') : { err: 'Usage: delete /system1/log1', code: 1 }),
    start: (ctx) => {
      if (/^\/system1\/sol1$/i.test(ctx.args[0] ?? '')) return sol(ctx, dev(ctx), '[SOL Session operational.  Use ~? for help]');
      if (!/^\/system1$/i.test(ctx.args[0] ?? '')) return { err: 'Usage: start /system1 | start /system1/sol1', code: 1 };
      return power(ctx, dev(ctx), 'on', '/system1 started.');
    },
    stop: (ctx) => {
      const force = ctx.args.includes('-f') || ctx.args.includes('-force');
      if (!ctx.args.some((a) => /^\/system1$/i.test(a))) return { err: 'Usage: stop [-f] /system1', code: 1 };
      return power(ctx, dev(ctx), force ? 'off' : 'soft', force ? '/system1 stopped (forced).' : '/system1 stopping (ACPI shutdown).');
    },
    reset: (ctx) => {
      if (/^\/map1$/i.test(ctx.args[0] ?? '')) {
        const r = ctx.api.dispatch({ type: 'bmcReset', deviceId: dev(ctx).id });
        return r.ok ? 'BMC reset in progress.' : { err: r.message, code: 1 };
      }
      return power(ctx, dev(ctx), 'reset', '/system1 reset.');
    },
    set: (ctx) => {
      const d = dev(ctx);
      const kv = ctx.args.find((a) => a.toLowerCase().startsWith('enabledstate='));
      if (!/^\/system1\/led1$/i.test(ctx.args[0] ?? '') || !kv) return { err: 'Usage: set /system1/led1 enabledstate=enabled|disabled', code: 1 };
      ctx.api.dispatch({ type: 'locate', deviceId: d.id, on: kv.toLowerCase().endsWith('=enabled') });
      return 'UID LED updated.';
    },
  },
};

export function vendorBmcPack(v: VendorId): CommandPack {
  return { dell: dellPack, hpe: hpePack, lenovo: lenovoPack, supermicro: smcPack }[v];
}

/** What you see right after `ssh <user>@<host>-bmc` on each vendor's BMC. */
export function vendorBanner(v: VendorId, d: Device, w: World): string {
  const m = MODELS[d.model];
  if (v === 'dell') return `${d.hostname}-bmc  ${d.bmc.fw}\nService Tag ${d.serial}   ${m.name.replace(/ \(.*/, '')}\n\nType "help" for racadm subcommands. You can omit the "racadm" prefix in this shell.`;
  if (v === 'hpe') return `User:Administrator logged-in to ${d.hostname}-bmc(${d.bmc.ip} / FE80::${d.bmc.mac.slice(-5).replace(':', '')})\n${d.bmc.fw.replace('iLO 6', 'iLO 6 Advanced')} at Aug 14 2026\nServer Name: ${d.hostname}\nServer Power: ${isOn(d) ? 'On' : 'Off'}\n`;
  if (v === 'lenovo') return `${VENDORS.lenovo.bmc.product}  ${d.bmc.fw}\nMachine Type/Model 7D76CTO1WW   S/N ${d.serial}\nType "help" for a list of commands.`;
  void w;
  return `Insyde SMASH-CLP System Management Shell, versions\nCopyright (c) 2015-2025 by Insyde International CO., Ltd.\nAll Rights Reserved\n\n${m.name.replace(/ \(.*/, '')}  S/N ${d.serial}  ${d.bmc.fw}`;
}

/** NIC link state, used by vendor console/help text. */
export const linkSummary = (w: World, d: Device) => `eth0 ${linkState(w, d.id, 'nic0p0').up ? 'UP' : 'DOWN'} / eth1 ${linkState(w, d.id, 'nic0p1').up ? 'UP' : 'DOWN'}`;
