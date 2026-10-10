// Linux host command pack. Every line of output is derived from World state.
import { MODELS, partSpec } from '../catalog';
import {
  cpuTemp,
  edacName,
  installedOfKind,
  linkState,
  memorySpeed,
  visibleMemoryGB,
} from '../projectors';
import type { Component, Device, World } from '../types';
import { columns, parseFlags, resolvePath, type CmdCtx, type CmdOut, type CommandPack } from './core';
import { ipmitoolCmd } from './ipmitool';
import { hostIp, pingOut, prodReachable, resolve } from './net';

const KERNEL = '6.8.0-45-generic';

function dev(ctx: CmdCtx): Device {
  return ctx.w.devices[ctx.frame.deviceId!];
}
function view(ctx: CmdCtx, topic: string) {
  ctx.api.dispatch({ type: 'setFlag', name: `viewed:${ctx.frame.deviceId}:${topic}` });
}
function needRoot(ctx: CmdCtx, name: string, msg?: string): CmdOut | null {
  if (ctx.sudo) return null;
  return { err: msg ?? `${name}: Permission denied. (Try: sudo ${name} ${ctx.args.join(' ')})`, code: 1 };
}

function uptimeSecs(w: World, d: Device): number {
  const up = w.flags[`os_up:${d.id}`];
  return up ? w.t - up.last : 41 * 86400 + 3 * 3600 + 1200 + w.t;
}

function fmtUptime(s: number): string {
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return days > 0 ? `${days} days, ${String(h).padStart(2)}:${String(m).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
}

function simDate(w: World, d?: Device, offsetSec = 0): Date {
  const base = Date.UTC(2026, 9, 9, 14, 0, 0) + (w.t + offsetSec) * 1000;
  if (d?.quirks.includes('clock_reset')) return new Date(Date.UTC(2017, 0, 1, 0, 0, 0) + (w.t + offsetSec) * 1000);
  return new Date(base);
}

// ---------- device enumeration ----------

interface Disk {
  slot: string;
  name: string;
  c: Component;
  sizeH: string;
  bytes: number;
  model: string;
  mount: string;
}

function disks(d: Device): Disk[] {
  const out: Disk[] = [];
  for (const s of MODELS[d.model].slots) {
    if (s.kind !== 'hdd' && s.kind !== 'nvme' && s.kind !== 'm2') continue;
    const c = d.slots[s.id];
    if (!c || !c.seated) continue;
    if (c.failure === 'nvme_missing' || c.failure === 'm2_failed') continue;
    if (c.partNumber.includes('SAS')) continue; // SAS on AHCI: never shows up
    const name = d.osNames[s.id];
    if (!name) continue;
    const spec = partSpec(c.partNumber);
    const tb = spec.pn.includes('20T') ? 20 : spec.pn.includes('18T') ? 18 : spec.pn.includes('7T68') ? 7.68 : 0.96;
    const bytes = tb * 1e12;
    const sizeH = tb >= 10 ? `${(bytes / 2 ** 40).toFixed(1)}T` : tb > 1 ? `${(bytes / 2 ** 40).toFixed(1)}T` : `${(bytes / 2 ** 30).toFixed(1)}G`;
    const model = s.kind === 'hdd' ? `HX${spec.pn.includes('18T') ? '18' : '20'}TSATA7K2` : s.kind === 'm2' ? 'HXM2-960G-BOOT' : 'HXU2-7T68-G4';
    out.push({ slot: s.id, name, c, sizeH, bytes, model, mount: '' });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  let i = 0;
  for (const x of out) if (!x.name.startsWith('nvme0') && !x.name.startsWith('nvme1n')) x.mount = `/data/d${String(i++).padStart(2, '0')}`;
  return out;
}

function findDisk(d: Device, path: string): Disk | undefined {
  const n = path.replace('/dev/', '').replace(/n1$/, 'n1');
  return disks(d).find((x) => x.name === n || x.name === `${n}n1` || `/dev/${x.name}` === path);
}

// ---------- kernel log ----------

interface KLine {
  t: number; // seconds since boot
  text: string;
  level: 'info' | 'warn' | 'err' | 'crit';
}

function kernelLog(w: World, d: Device): KLine[] {
  const L: KLine[] = [];
  const add = (t: number, text: string, level: KLine['level'] = 'info') => L.push({ t, text, level });
  const m = MODELS[d.model];
  add(0, `Linux version ${KERNEL} (buildd@lcy02-amd64-075) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC`);
  add(0, `Command line: BOOT_IMAGE=/vmlinuz-${KERNEL} root=/dev/md1 ro console=tty0 console=ttyS1,115200n8`);
  add(0, `DMI: Generic Hyperscale ${m.name.split(' ')[0]}/${m.name.split(' ')[0]}-MB, BIOS 2.4.7 06/14/2026`);
  add(0.01, `Memory: ${visibleMemoryGB(d) * 1024 * 1024 - 2_100_000}K/${visibleMemoryGB(d) * 1024 * 1024}K available`);
  const cpus = installedOfKind(d, 'cpu');
  add(0.21, `smpboot: Allowing ${cpus.length * 128} CPUs, 0 hotplug CPUs`);
  add(0.9, 'ACPI: PCI Root Bridge [PC00] (domain 0000 [bus 00-15])');
  for (const [slot] of installedOfKind(d, 'dimm')) {
    void slot;
  }
  add(1.02, 'EDAC MC0: Giving out device to module i10nm_edac controller Intel_10nm Socket#0 IMC#0: DEV 0000:7e:0c.0 (INTERRUPT)');
  if (cpus.length > 1) add(1.03, 'EDAC MC4: Giving out device to module i10nm_edac controller Intel_10nm Socket#1 IMC#0: DEV 0000:fe:0c.0 (INTERRUPT)');
  const dk = disks(d);
  let ata = 1;
  for (const x of dk) {
    if (x.name.startsWith('nvme')) {
      const n = x.name.replace('n1', '');
      add(2.3 + dk.indexOf(x) * 0.01, `nvme ${n}: pci function 0000:${(0x81 + dk.indexOf(x)).toString(16)}:00.0`);
      add(2.45 + dk.indexOf(x) * 0.01, `nvme ${n}: 64/0/0 default/read/poll queues`);
    } else {
      add(3.1 + ata * 0.05, `ata${ata}: SATA link up 6.0 Gbps (SStatus 133 SControl 300)`);
      add(3.4 + ata * 0.05, `sd ${ata - 1}:0:0:0: [${x.name}] ${Math.round(x.bytes / 512)} 512-byte logical blocks: (${(x.bytes / 1e12).toFixed(1)} TB/${(x.bytes / 2 ** 40).toFixed(1)} TiB)`);
      ata++;
    }
  }
  const m2ok = ['M2_0', 'M2_1'].filter((s) => d.slots[s] && d.slots[s]!.health !== 'failed' && d.slots[s]!.seated).length;
  add(4.01, `md/raid1:md0: active with ${m2ok} out of 2 mirrors`);
  add(4.02, `md/raid1:md1: active with ${m2ok} out of 2 mirrors`);
  add(4.5, 'EXT4-fs (md1): mounted filesystem with ordered data mode. Quota mode: none.');
  const nic = d.slots.OCP0;
  if (nic) {
    add(5.2, `mlx5_core 0000:31:00.0: firmware version: 26.41.1000`);
    if (nic.health === 'failed') {
      add(5.8, 'mlx5_core 0000:31:00.0: mlx5_health_check_fatal_sensors:1207:(pid 0): Fatal error 3 detected', 'crit');
      add(5.81, 'mlx5_core 0000:31:00.0: print_health_info:431:(pid 0): assert_var[0] 0x00000000', 'err');
      add(5.82, 'mlx5_core 0000:31:00.0: mlx5_handle_bad_state:  NIC IFC status 3, device in bad state; firmware is not responding', 'crit');
    }
    for (const [p, ifc, fn] of [
      ['nic0p0', 'eth0', '0'],
      ['nic0p1', 'eth1', '1'],
    ] as const) {
      const ls = linkState(w, d.id, p);
      add(6.1 + Number(fn) * 0.1, `mlx5_core 0000:31:00.${fn} ${ifc}: Link ${ls.up ? 'up' : 'down'}`, ls.up ? 'info' : 'warn');
    }
    add(6.4, 'bond0: (slave eth0): Enslaving as an active interface with an up link');
  }
  const gpu = d.slots.PCIE1;
  if (gpu) add(7.2, 'nvidia: loading out-of-tree module taints kernel.');

  // ---------- failures ----------
  const up = uptimeSecs(w, d);
  const late = (frac: number) => Math.max(10, Math.round(up * frac * 1000) / 1000);
  for (const [slot, c] of Object.entries(d.slots)) {
    if (!c?.failure) continue;
    const name = d.osNames[slot];
    switch (c.failure) {
      case 'dimm_ce_storm': {
        const e = edacName(slot);
        const [, cpu, mc, ch] = /(\d)_MC#(\d)_Chan#(\d)/.exec(e) ?? [];
        for (let i = 0; i < 6; i++)
          add(late(0.5 + i * 0.08), `EDAC MC${Number(cpu) * 4 + Number(mc)}: ${[12, 87, 203, 156, 341, 512][i]} CE memory read error on ${e} (channel:${ch} slot:0 page:0x${(0x5a3f1 + i * 77).toString(16)} offset:0x0 grain:32 syndrome:0x0)`, 'warn');
        add(late(0.92), 'mce: [Hardware Error]: Machine check events logged', 'warn');
        break;
      }
      case 'dimm_uce':
        add(0.002, `BIOS: DIMM ${slot} disabled by firmware (uncorrectable errors in previous boot)`, 'warn');
        add(1.05, `EDAC i10nm: ${edacName(slot)} not present (mapped out)`, 'warn');
        break;
      case 'hdd_failed':
        if (!name) break;
        for (let i = 0; i < 3; i++) {
          add(late(0.6 + i * 0.1), `ata${dk.findIndex((x) => x.name === name) + 1}.00: failed command: READ FPDMA QUEUED`, 'err');
          add(late(0.6 + i * 0.1) + 0.001, `ata${dk.findIndex((x) => x.name === name) + 1}.00: status: { DRDY ERR }  error: { UNC }`, 'err');
          add(late(0.6 + i * 0.1) + 0.002, `I/O error, dev ${name}, sector ${8812341 + i * 12008} op 0x0:(READ) flags 0x0 phys_seg 1 prio class 2`, 'err');
        }
        add(late(0.95), `sd ${dk.findIndex((x) => x.name === name)}:0:0:0: [${name}] tag#18 FAILED Result: hostbyte=DID_OK driverbyte=DRIVER_OK cmd_age=7s`, 'err');
        add(late(0.95) + 0.01, `XFS (${name}): metadata I/O error in "xfs_imap_to_bp+0x5e/0x70" at daddr 0x1d4c8a0 len 32 error 5`, 'crit');
        break;
      case 'hdd_predictive':
        if (!name) break;
        add(late(0.7), `ata${dk.findIndex((x) => x.name === name) + 1}.00: exception Emask 0x0 SAct 0x400000 SErr 0x0 action 0x0`, 'warn');
        add(late(0.7) + 0.001, `ata${dk.findIndex((x) => x.name === name) + 1}.00: irq_stat 0x40000008`, 'warn');
        break;
      case 'nvme_missing': {
        const n = (name ?? 'nvme5n1').replace('n1', '');
        add(late(0.4), `nvme ${n}: I/O 12 QID 0 timeout, disable controller`, 'err');
        add(late(0.4) + 0.1, `nvme ${n}: Device not ready; aborting reset, CSTS=0x1`, 'crit');
        add(late(0.4) + 0.2, `nvme ${n}: Removing after probe failure status: -19`, 'crit');
        break;
      }
      case 'nvme_media_errors':
        add(late(0.8), `critical medium error, dev ${name}, sector 9213440 op 0x0:(READ) flags 0x80700 phys_seg 4 prio class 2`, 'err');
        add(late(0.82), `${name}: I/O Cmd(0x2) @ LBA 9213440, 256 blocks, I/O Error (sct 0x2 / sc 0x81) DNR`, 'err');
        break;
      case 'm2_failed': {
        const n = d.osNames[slot] ?? 'nvme1n1';
        add(late(0.5), `nvme ${n.replace('n1', '')}: Device not ready; aborting reset, CSTS=0x1`, 'crit');
        add(late(0.5) + 0.1, `md/raid1:md1: Disk failure on ${n}p2, disabling device.`, 'crit');
        add(late(0.5) + 0.11, 'md/raid1:md1: Operation continuing on 1 devices.', 'crit');
        add(late(0.5) + 0.12, `md/raid1:md0: Disk failure on ${n}p1, disabling device.`, 'crit');
        break;
      }
      case 'gpu_fell_off_bus':
        add(late(0.7), 'NVRM: GPU at PCI:0000:ca:00: GPU-6f1b2c3a-41d2-9e1f-bb02-3c9a7e1d5f20', 'err');
        add(late(0.7) + 0.001, 'NVRM: Xid (PCI:0000:ca:00): 79, pid=21844, name=inference-svc, GPU has fallen off the bus.', 'crit');
        add(late(0.7) + 0.002, 'NVRM: GPU 0000:ca:00.0: GPU has fallen off the bus.', 'crit');
        add(late(0.7) + 0.003, 'pcieport 0000:c9:01.0: AER: Uncorrected (Fatal) error received: 0000:ca:00.0', 'crit');
        break;
      case 'gpu_thermal':
        add(late(0.8), 'NVRM: Xid (PCI:0000:ca:00): 62, pid=21844, name=inference-svc, Internal micro-controller halt (thermal)', 'err');
        break;
      case 'cpu_ierr':
        add(late(0.3), `mce: [Hardware Error]: CPU ${slot === 'CPU1' ? 160 : 12}: Machine Check: 0 Bank 4: fe20000000000e0b`, 'crit');
        add(late(0.3) + 0.001, `mce: [Hardware Error]: TSC 0 ADDR 7f3a2c MISC 0 SYND 0 IPID 0 PROCESSOR 0:a06d1 TIME 1791569000 SOCKET ${slot === 'CPU1' ? 1 : 0} APIC 140 microcode 10002f0`, 'crit');
        add(late(0.3) + 0.002, 'mce: [Hardware Error]: Machine check events logged', 'warn');
        break;
    }
  }
  const t = Math.max(cpuTemp(d, 0), cpuTemp(d, 1));
  if (t >= 95) {
    add(late(0.97), `CPU12: Core temperature above threshold, cpu clock throttled (total events = ${t * 41})`, 'warn');
    add(late(0.971), 'CPU12: Package temperature above threshold, cpu clock throttled (total events = 2211)', 'warn');
  }
  if (d.os === 'readonly_fs' || d.quirks.includes('readonly_fs')) {
    add(late(0.9), 'EXT4-fs error (device md1): ext4_journal_check_start:83: comm systemd-journal: Detected aborted journal', 'crit');
    add(late(0.9) + 0.01, 'EXT4-fs (md1): Remounting filesystem read-only', 'crit');
  }
  return L.sort((a, b) => a.t - b.t);
}

function prevBootPanic(d: Device): string[] {
  const out: string[] = [];
  for (const [slot, c] of Object.entries(d.slots)) {
    if (c?.failure === 'dimm_uce') {
      out.push(
        `kernel: mce: [Hardware Error]: CPU 37: Machine Check Exception: 5 Bank 13: be00000000800400`,
        `kernel: EDAC MC${slot.includes('_B') ? 4 : 0}: 1 UE memory read error on ${edacName(slot)} (channel:${edacName(slot).split('Chan#')[1][0]} slot:0 page:0x7c1f2 offset:0x0 grain:32)`,
        `kernel: mce: [Hardware Error]: Run the above through 'mcelog --ascii'`,
        `kernel: Kernel panic - not syncing: Fatal machine check`,
      );
    }
    if (c?.failure === 'cpu_ierr') {
      out.push(`kernel: mce: [Hardware Error]: CPU 160: Machine Check Exception: 4 Bank 0: b200000000070005`, `kernel: Kernel panic - not syncing: Timeout: Not all CPUs entered broadcast exception handler`);
    }
  }
  return out;
}

function fmtK(l: KLine, human: boolean, w: World, d: Device): string {
  if (human) {
    const boot = simDate(w, d, -uptimeSecs(w, d));
    const dt = new Date(boot.getTime() + l.t * 1000);
    return `[${dt.toUTCString().replace(' GMT', '')}] ${l.text}`;
  }
  return `[${l.t.toFixed(6).padStart(12)}] ${l.text}`;
}

// ---------- commands ----------

const lsblk = (ctx: CmdCtx): CmdOut => {
  const d = dev(ctx);
  view(ctx, 'storage');
  const { opts, flags } = parseFlags(ctx.args);
  const dk = disks(d);
  let cols = (opts.output ?? '').split(',').filter(Boolean);
  const oi = ctx.args.indexOf('-o');
  if (oi >= 0) cols = (ctx.args[oi + 1] ?? '').split(',');
  if (cols.length) {
    const rows = [cols.map((c) => c.toUpperCase())];
    for (const x of dk) {
      rows.push(
        cols.map((c) => {
          switch (c.toUpperCase()) {
            case 'NAME':
              return x.name;
            case 'SIZE':
              return x.sizeH;
            case 'SERIAL':
              return x.c.serial;
            case 'MODEL':
              return x.model;
            case 'TYPE':
              return 'disk';
            case 'MOUNTPOINT':
            case 'MOUNTPOINTS':
              return x.mount;
            case 'TRAN':
              return x.name.startsWith('nvme') ? 'nvme' : 'sata';
            case 'ROTA':
              return x.name.startsWith('sd') ? '1' : '0';
            case 'WWN':
              return `0x5000c500${x.c.serial.slice(-8).toLowerCase()}`;
            default:
              return '';
          }
        }),
      );
    }
    return { out: columns(rows, 1) };
  }
  const rows: string[] = ['NAME          MAJ:MIN RM   SIZE RO TYPE  MOUNTPOINTS'];
  dk.forEach((x, i) => {
    const major = x.name.startsWith('nvme') ? '259' : '  8';
    rows.push(`${x.name.padEnd(14)}${major}:${String(i * 16).padEnd(4)}0 ${x.sizeH.padStart(6)}  0 disk  ${x.mount}`);
    if (x.name === 'nvme0n1' || x.name === 'nvme1n1') {
      rows.push(`├─${x.name}p1     259:${i * 16 + 1}   0     1G  0 part`);
      rows.push(`│ └─md0         9:0    0  1022M  0 raid1 /boot`);
      rows.push(`└─${x.name}p2     259:${i * 16 + 2}   0 893.2G  0 part`);
      rows.push(`  └─md1         9:1    0 893.1G  0 raid1 /`);
    }
  });
  if (flags.has('d')) return { out: rows.filter((r) => !r.includes('─')).join('\n') };
  return { out: rows.join('\n') };
};

function smartctl(ctx: CmdCtx): CmdOut {
  const nr = needRoot(ctx, 'smartctl', 'smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.8.0-45-generic] (local build)\nSmartctl open device: /dev/sda failed: Permission denied');
  if (nr) return nr;
  const d = dev(ctx);
  const { flags, opts, pos } = parseFlags(ctx.args);
  const banner = 'smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.8.0-45-generic] (local build)\nCopyright (C) 2002-23, Bruce Allen, Christian Franke, www.smartmontools.org\n';
  if (flags.has('scan') || opts.scan !== undefined) {
    return { out: disks(d).map((x) => `/dev/${x.name.startsWith('nvme') ? x.name.replace('n1', '') : x.name} -d ${x.name.startsWith('nvme') ? 'nvme' : 'sat'} # /dev/${x.name}, ${x.name.startsWith('nvme') ? 'NVMe' : 'ATA'} device`).join('\n') };
  }
  const path = pos[pos.length - 1];
  if (!path) return { err: banner + '\nERROR: smartctl requires a device name as the final command-line argument.', code: 1 };
  const x = findDisk(d, path);
  if (!x) return { err: `${banner}\nSmartctl open device: ${path} failed: No such device`, code: 2 };
  view(ctx, 'storage');
  const sm = x.c.smart!;
  const failed = x.c.health === 'failed';
  const health = failed ? 'FAILED!\nDrive failure expected in less than 24 hours. SAVE ALL DATA.\nSee vendor-specific Attribute list for failed Attributes.' : 'PASSED';
  const info = `=== START OF INFORMATION SECTION ===\nDevice Model:     ${x.model}\nSerial Number:    ${x.c.serial}\nFirmware Version: ${x.c.firmware}\nUser Capacity:    ${x.bytes.toLocaleString('en-US')} bytes [${(x.bytes / 1e12).toFixed(1)} TB]\n${x.name.startsWith('sd') ? 'Rotation Rate:    7200 rpm\nForm Factor:      3.5 inches\nSATA Version is:  SATA 3.3, 6.0 Gb/s (current: 6.0 Gb/s)\n' : 'Form Factor:      2.5 inches (U.2)\n'}SMART support is: Available - device has SMART capability.\nSMART support is: Enabled\n`;
  const healthSec = `=== START OF READ SMART DATA SECTION ===\nSMART overall-health self-assessment test result: ${health}\n`;
  if (flags.has('i')) return { out: banner + '\n' + info };
  if (flags.has('H')) return { out: banner + '\n' + healthSec, code: failed ? 8 : 0 };
  let attrs = '';
  if (x.name.startsWith('sd')) {
    attrs = `\nSMART Attributes Data Structure revision number: 10\nVendor Specific SMART Attributes with Thresholds:\nID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE\n  1 Raw_Read_Error_Rate     0x000b   ${failed ? '062' : '100'}   ${failed ? '062' : '100'}   016    Pre-fail  Always       -       ${failed ? 288412 : 0}\n  5 Reallocated_Sector_Ct   0x0033   ${sm.reallocated > 1000 ? (failed ? '001' : '058') : '100'}   ${sm.reallocated > 1000 ? (failed ? '001' : '058') : '100'}   005    Pre-fail  Always   ${failed ? 'FAILING_NOW' : '      -    '} ${sm.reallocated}\n  9 Power_On_Hours          0x0012   096   096   000    Old_age   Always       -       ${sm.powerOnHours}\n 10 Spin_Retry_Count        0x0013   100   100   060    Pre-fail  Always       -       0\n194 Temperature_Celsius     0x0002   ${55 - sm.tempC}   ${48}   000    Old_age   Always       -       ${sm.tempC} (Min/Max 22/49)\n196 Reallocated_Event_Count 0x0032   100   100   000    Old_age   Always       -       ${Math.round(sm.reallocated / 8)}\n197 Current_Pending_Sector  0x0022   100   100   000    Old_age   Always       -       ${sm.pending}\n198 Offline_Uncorrectable   0x0008   100   100   000    Old_age   Offline      -       ${sm.uncorrectable}\n199 UDMA_CRC_Error_Count    0x000a   200   200   000    Old_age   Always       -       0\n`;
  } else {
    attrs = `\nSMART/Health Information (NVMe Log 0x02)\nCritical Warning:                   ${x.c.health === 'ok' ? '0x00' : '0x04'}\nTemperature:                        ${sm.tempC} Celsius\nAvailable Spare:                    ${x.c.health === 'ok' ? 100 : 3}%\nAvailable Spare Threshold:          10%\nPercentage Used:                    ${sm.wearPct}%\nData Units Read:                    ${(sm.powerOnHours * 91234).toLocaleString('en-US')}\nData Units Written:                 ${(sm.powerOnHours * 70221).toLocaleString('en-US')}\nPower On Hours:                     ${sm.powerOnHours}\nUnsafe Shutdowns:                   ${7 + (sm.powerOnHours % 5)}\nMedia and Data Integrity Errors:    ${sm.uncorrectable}\nError Information Log Entries:      ${sm.uncorrectable * 3}\n`;
  }
  return { out: banner + '\n' + info + '\n' + healthSec + attrs, code: failed ? 8 : 0 };
}

function nvme(ctx: CmdCtx): CmdOut {
  const nr = needRoot(ctx, 'nvme');
  if (nr) return nr;
  const d = dev(ctx);
  const [sub, path] = ctx.args;
  view(ctx, 'storage');
  const dk = disks(d).filter((x) => x.name.startsWith('nvme'));
  if (sub === 'list' || !sub) {
    const rows = [
      ['Node', 'Generic', 'SN', 'Model', 'Namespace', 'Usage', 'Format', 'FW Rev'],
      ['---------------', '----------', '--------------------', '------------------', '---------', '--------------------------', '----------------', '--------'],
    ];
    dk.forEach((x, i) =>
      rows.push([`/dev/${x.name}`, `/dev/ng${i}n1`, x.c.serial, x.model, '0x1', `${x.sizeH.replace('T', ' TB')} / ${x.sizeH.replace('T', ' TB')}`, '512   B +  0 B', x.c.firmware ?? '']),
    );
    return { out: columns(rows, 1) };
  }
  if (sub === 'smart-log') {
    const x = path && findDisk(d, path);
    if (!x) return { err: `${path ?? ''}: No such file or directory`, code: 1 };
    const sm = x.c.smart!;
    return {
      out: `Smart Log for NVME device:${x.name} namespace-id:ffffffff\ncritical_warning                        : ${x.c.health === 'ok' ? 0 : 4}\ntemperature                             : ${sm.tempC}°C (${sm.tempC + 273} Kelvin)\navailable_spare                         : ${x.c.health === 'ok' ? 100 : 3}%\navailable_spare_threshold               : 10%\npercentage_used                         : ${sm.wearPct}%\nmedia_errors                            : ${sm.uncorrectable}\nnum_err_log_entries                     : ${sm.uncorrectable * 3}\npower_on_hours                          : ${sm.powerOnHours}\nunsafe_shutdowns                        : 9`,
    };
  }
  return { err: `nvme: unknown subcommand '${sub}'. Try: nvme list | nvme smart-log /dev/nvmeXn1`, code: 1 };
}

function mdstat(d: Device): string {
  const m2 = ['M2_0', 'M2_1'].map((s) => (d.slots[s] && d.slots[s]!.health !== 'failed' && d.slots[s]!.seated ? d.osNames[s] : null));
  const okCount = m2.filter(Boolean).length;
  const map = m2.map((n) => (n ? 'U' : '_')).join('');
  const members = (p: number) =>
    m2
      .map((n, i) => (n ? `${n}p${p}[${i}]` : ''))
      .filter(Boolean)
      .join(' ');
  return `Personalities : [raid1] [linear] [multipath] [raid0] [raid6] [raid5] [raid4] [raid10]\nmd1 : active raid1 ${members(2)}\n      936513536 blocks super 1.2 [2/${okCount}] [${map}]\n      bitmap: 3/7 pages [12KB], 65536KB chunk\n\nmd0 : active raid1 ${members(1)}\n      1046528 blocks super 1.2 [2/${okCount}] [${map}]\n\nunused devices: <none>`;
}

function dmidecode(ctx: CmdCtx): CmdOut {
  const nr = needRoot(ctx, 'dmidecode', '/sys/firmware/dmi/tables/smbios_entry_point: Permission denied\nScanning /dev/mem for entry point.\n/dev/mem: Permission denied');
  if (nr) return nr;
  const d = dev(ctx);
  const { opts, pos } = parseFlags(ctx.args);
  const ti = ctx.args.indexOf('-t');
  const si = ctx.args.indexOf('-s');
  const type = ti >= 0 ? ctx.args[ti + 1] : opts.type;
  const str = si >= 0 ? ctx.args[si + 1] : opts.string;
  void pos;
  const m = MODELS[d.model];
  const head = '# dmidecode 3.5\nGetting SMBIOS data from sysfs.\nSMBIOS 3.6.0 present.\n';
  if (str === 'system-serial-number') return { out: d.serial };
  if (str === 'system-product-name') return { out: m.name.split(' ')[0] };
  if (str === 'baseboard-serial-number') return { out: `MB${d.serial.slice(2)}` };
  if (str === 'bios-version') return { out: '2.4.7' };
  if (type === 'system' || type === '1') {
    view(ctx, 'inventory');
    return { out: `${head}\nHandle 0x0001, DMI type 1, 27 bytes\nSystem Information\n\tManufacturer: Generic Hyperscale\n\tProduct Name: ${m.name.split(' ')[0]}\n\tVersion: A02\n\tSerial Number: ${d.serial}\n\tUUID: 4c4c4544-00${d.serial.slice(2, 4).toLowerCase()}-1010-8051-${d.assetTag.slice(2).toLowerCase()}000\n\tWake-up Type: Power Switch\n\tSKU Number: ${m.id.toUpperCase()}\n\tFamily: Hyperscale Compute` };
  }
  if (type === 'bios' || type === '0') {
    view(ctx, 'bios');
    return { out: `${head}\nHandle 0x0000, DMI type 0, 26 bytes\nBIOS Information\n\tVendor: Generic Hyperscale\n\tVersion: 2.4.7\n\tRelease Date: 06/14/2026\n\tROM Size: 64 MB` };
  }
  if (type === 'processor' || type === '4') {
    view(ctx, 'cpu');
    return {
      out:
        head +
        ['CPU0', 'CPU1']
          .map((s, i) => {
            const c = d.slots[s];
            return `\nHandle 0x00${40 + i}, DMI type 4, 48 bytes\nProcessor Information\n\tSocket Designation: ${s}\n\tType: Central Processor\n\tStatus: ${c ? (c.health === 'failed' ? 'Populated, Disabled by BIOS' : 'Populated, Enabled') : 'Unpopulated'}\n${c ? `\tVersion: Generic X5 ${partSpec(c.partNumber).desc.split(' ')[1]} Processor\n\tSerial Number: ${c.serial}\n\tCore Count: ${c.partNumber.includes('64C') ? 64 : 48}\n\tThread Count: ${c.partNumber.includes('64C') ? 128 : 96}\n\tCurrent Speed: ${c.partNumber.includes('2.4') ? 2400 : 2600} MHz` : ''}`;
          })
          .join('\n'),
    };
  }
  if (type === 'memory' || type === '17') {
    view(ctx, 'memory');
    const blocks = m.slots
      .filter((s) => s.kind === 'dimm')
      .map((s, i) => {
        const c = d.slots[s.id];
        const usable = c && c.seated && c.health !== 'failed';
        if (!usable)
          return `Handle 0x${(0x1100 + i).toString(16)}, DMI type 17, 92 bytes\nMemory Device\n\tTotal Width: Unknown\n\tData Width: Unknown\n\tSize: No Module Installed\n\tForm Factor: DIMM\n\tLocator: ${s.id}\n\tBank Locator: P${s.cpu}_Node0_Channel${s.channel}_Dimm0\n\tType: Unknown`;
        const spec = partSpec(c.partNumber);
        const gb = c.partNumber.includes('32G') ? 32 : 64;
        const speed = c.partNumber.includes('4800') ? 4800 : 5600;
        return `Handle 0x${(0x1100 + i).toString(16)}, DMI type 17, 92 bytes\nMemory Device\n\tTotal Width: 80 bits\n\tData Width: 64 bits\n\tSize: ${gb} GB\n\tForm Factor: DIMM\n\tLocator: ${s.id}\n\tBank Locator: P${s.cpu}_Node0_Channel${s.channel}_Dimm0\n\tType: DDR5\n\tType Detail: Synchronous Registered (Buffered)\n\tSpeed: ${speed} MT/s\n\tManufacturer: Vendor-M\n\tSerial Number: ${c.serial}\n\tPart Number: ${spec.pn}\n\tRank: ${gb === 32 ? 1 : 2}\n\tConfigured Memory Speed: ${memorySpeed(d)} MT/s`;
      });
    return { out: head + '\n' + blocks.join('\n\n') };
  }
  return { out: `${head}\nUsage: dmidecode -t {system|bios|processor|memory} | -s system-serial-number` };
}

function ipCmd(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  view(ctx, 'network');
  const sub = ctx.args.filter((a) => !a.startsWith('-'))[0] ?? 'a';
  const brief = ctx.args.includes('-br') || ctx.args.includes('-brief');
  const st = (p: 'nic0p0' | 'nic0p1') => linkState(ctx.w, d.id, p);
  const ifs = [
    { n: 'eth0', p: 'nic0p0' as const, mac: d.macs.nic0p0.toLowerCase() },
    { n: 'eth1', p: 'nic0p1' as const, mac: d.macs.nic0p1.toLowerCase() },
  ];
  const nic = d.slots.OCP0;
  const bondUp = ifs.some((i) => st(i.p).up);
  if (brief) {
    const rows = [['lo', 'UNKNOWN', '127.0.0.1/8 ::1/128']];
    if (nic) for (const i of ifs) rows.push([i.n, st(i.p).up ? 'UP' : 'DOWN', '']);
    rows.push(['bond0', bondUp ? 'UP' : 'DOWN', sub === 'link' ? '' : `${hostIp(ctx.w, d)}/26`]);
    return { out: columns(rows, 3) };
  }
  const lines = ['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000', '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00'];
  if (sub.startsWith('a')) lines.push('    inet 127.0.0.1/8 scope host lo');
  if (nic)
    ifs.forEach((i, idx) => {
      const up = st(i.p).up;
      lines.push(`${idx + 2}: ${i.n}: <BROADCAST,MULTICAST,SLAVE${up ? ',UP,LOWER_UP' : ',UP'}> mtu 9000 qdisc mq master bond0 state ${up ? 'UP' : 'DOWN'} group default qlen 1000`);
      lines.push(`    link/ether ${ifs[0].mac} brd ff:ff:ff:ff:ff:ff permaddr ${i.mac}`);
    });
  lines.push(`4: bond0: <BROADCAST,MULTICAST,MASTER${bondUp ? ',UP,LOWER_UP' : ',UP'}> mtu 9000 qdisc noqueue state ${bondUp ? 'UP' : 'DOWN'} group default qlen 1000`);
  lines.push(`    link/ether ${ifs[0].mac} brd ff:ff:ff:ff:ff:ff`);
  if (sub.startsWith('a')) lines.push(`    inet ${hostIp(ctx.w, d)}/26 brd ${hostIp(ctx.w, d).replace(/\.\d+$/, '.63')} scope global bond0`);
  return { out: lines.join('\n') };
}

function ethtool(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  view(ctx, 'network');
  const { flags, pos } = parseFlags(ctx.args);
  const ifc = pos[0];
  const port = ifc === 'eth0' ? 'nic0p0' : ifc === 'eth1' ? 'nic0p1' : null;
  if (!port || !d.slots.OCP0) return { err: `netlink error: no device matches name (offset 24)\nnetlink error: No such device`, code: 1 };
  const ls = linkState(ctx.w, d.id, port);
  const cable = Object.values(ctx.w.cables).find((c) => (c.a?.deviceId === d.id && c.a.port === port) || (c.b?.deviceId === d.id && c.b.port === port));
  if (flags.has('i')) return { out: `driver: mlx5_core\nversion: ${KERNEL}\nfirmware-version: 26.41.1000 (HXO0000000031)\nexpansion-rom-version:\nbus-info: 0000:31:00.${port === 'nic0p0' ? 0 : 1}\nsupports-statistics: yes\nsupports-test: yes\nsupports-eeprom-access: no` };
  if (flags.has('m')) {
    if (!cable) return { err: 'netlink error: Input/output error\n(no module plugged in)', code: 1 };
    const isDac = cable.type === 'dac';
    return {
      out: `\tIdentifier                                : 0x03 (SFP)\n\tConnector                                 : ${isDac ? '0x21 (Copper pigtail)' : '0x07 (LC)'}\n\tTransceiver type                          : ${isDac ? 'Passive Copper Cable' : cable.type === 'aoc' ? 'Active Optical Cable' : 'Ethernet: 25GBASE-SR'}\n\tLength (Copper)                           : ${isDac ? cable.lengthM : 0}m\n\tVendor name                               : Generic-Cable\n\tVendor PN                                 : ${isDac ? `DAC-SFP28-${cable.lengthM}M` : 'SFP28-SR'}\n\tVendor SN                                 : CB${cable.id.slice(-8).toUpperCase()}${isDac ? '' : `\n\tLaser output power                        : 0.6123 mW / -2.13 dBm\n\tReceiver signal average optical power     : ${cable.condition === 'dirty' ? '0.0412 mW / -13.85 dBm' : '0.5521 mW / -2.58 dBm'}`}`,
    };
  }
  if (flags.has('S')) {
    return { out: `NIC statistics:\n     rx_packets: ${ls.up ? 88123441021 : 0}\n     tx_packets: ${ls.up ? 79512330112 : 0}\n     rx_crc_errors_phy: ${ls.crcErrors}\n     rx_symbol_err_phy: ${Math.round(ls.crcErrors / 3)}\n     link_down_events_phy: ${ls.up ? 1 : 7}` };
  }
  return {
    out: `Settings for ${ifc}:\n\tSupported ports: [ FIBRE ]\n\tSupported link modes:   1000baseKX/Full\n\t                        10000baseKR/Full\n\t                        25000baseCR/Full\n\t                        25000baseSR/Full\n\tAdvertised auto-negotiation: Yes\n\tSpeed: ${ls.up ? ls.speed : 'Unknown!'}\n\tDuplex: ${ls.up ? 'Full' : 'Unknown! (255)'}\n\tAuto-negotiation: on\n\tPort: ${cable?.type === 'dac' ? 'Direct Attach Copper' : cable ? 'FIBRE' : 'Other'}\n\tLink detected: ${ls.up ? 'yes' : 'no'}`,
  };
}

function lldpctl(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  view(ctx, 'network');
  const out = ['-------------------------------------------------------------------------------', 'LLDP neighbors:', '-------------------------------------------------------------------------------'];
  for (const [ifc, p] of [
    ['eth0', 'nic0p0'],
    ['eth1', 'nic0p1'],
  ] as const) {
    const ls = linkState(ctx.w, d.id, p);
    if (!ls.up || !ls.peer) continue;
    const pd = ctx.w.devices[ls.peer.deviceId];
    out.push(
      `Interface:    ${ifc}, via: LLDP, RID: 1, Time: 41 days, 03:20:11`,
      '  Chassis:',
      `    ChassisID:    mac ${pd.bmc.mac.toLowerCase()}`,
      `    SysName:      ${pd.hostname}`,
      `    SysDescr:     ${MODELS[pd.model].name}`,
      `    MgmtIP:       ${pd.bmc.ip}`,
      '  Port:',
      `    PortID:       ifname ${ls.peer.port}`,
      `    PortDescr:    ${d.hostname}:${ifc}`,
      '-------------------------------------------------------------------------------',
    );
  }
  return { out: out.join('\n') };
}

function nvidiaSmi(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  view(ctx, 'gpu');
  const g = d.slots.PCIE1;
  if (!g || !d.layers.riser1) return { err: 'No devices were found', code: 6 };
  if (g.health === 'failed') return { err: 'Unable to determine the device handle for GPU0000:CA:00.0: Unknown Error\nNo devices were found', code: 15 };
  const temp = g.health === 'degraded' ? 95 : 54;
  const q = ctx.args.includes('-q');
  if (q)
    return {
      out: `==============NVSMI LOG==============\n\nDriver Version                            : 560.35.03\nAttached GPUs                             : 1\nGPU 00000000:CA:00.0\n    Product Name                          : Inference GPU 24GB LP\n    Serial Number                         : ${g.serial}\n    GPU UUID                              : GPU-6f1b2c3a-41d2-9e1f-bb02-3c9a7e1d5f20\n    Temperature\n        GPU Current Temp                  : ${temp} C\n        GPU Slowdown Temp                 : 92 C\n    Clocks Event Reasons\n        HW Slowdown                       : ${temp >= 92 ? 'Active' : 'Not Active'}\n        HW Thermal Slowdown               : ${temp >= 92 ? 'Active' : 'Not Active'}`,
    };
  return {
    out: `+-----------------------------------------------------------------------------------------+\n| NVIDIA-SMI 560.35.03              Driver Version: 560.35.03      CUDA Version: 12.6     |\n|-----------------------------------------+------------------------+----------------------+\n| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |\n| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |\n|=========================================+========================+======================|\n|   0  Inference GPU 24GB LP          On  |   00000000:CA:00.0 Off |                    0 |\n| N/A   ${temp}C    P0             ${temp > 90 ? 71 : 38}W /   72W |   15210MiB /  23034MiB |     ${temp > 90 ? 99 : 62}%      Default |\n+-----------------------------------------+------------------------+----------------------+`,
  };
}

function lspci(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  const lines = [
    '00:00.0 Host bridge: Generic Hyperscale X5 Root Complex',
    '00:17.0 SATA controller: Generic AHCI Controller [12 port]',
  ];
  disks(d)
    .filter((x) => x.name.startsWith('nvme'))
    .forEach((x, i) => lines.push(`${(0x81 + i).toString(16)}:00.0 Non-Volatile memory controller: Generic NVMe SSD Controller (${x.slot.startsWith('M2') ? 'M.2 boot' : 'U.2'})`));
  if (d.slots.OCP0) {
    const bad = d.slots.OCP0.health === 'failed';
    lines.push(`31:00.0 Ethernet controller: Mellanox Technologies MT2894 Family [ConnectX-6 Lx]${bad ? ' (rev ff)' : ''}`);
    lines.push(`31:00.1 Ethernet controller: Mellanox Technologies MT2894 Family [ConnectX-6 Lx]${bad ? ' (rev ff)' : ''}`);
  }
  if (d.slots.PCIE1 && d.layers.riser1) lines.push(`ca:00.0 3D controller: NVIDIA Corporation AD104GL [L4] (rev ${d.slots.PCIE1.health === 'failed' ? 'ff' : 'a1'})`);
  if (d.slots.PCIE1) view(ctx, 'gpu');
  return { out: lines.sort().join('\n') };
}

function journalctl(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  const a = ctx.args;
  const prev = a.includes('-b') && (a[a.indexOf('-b') + 1] === '-1' || a.includes('--boot=-1'));
  const pIdx = a.indexOf('-p');
  const prio = pIdx >= 0 ? a[pIdx + 1] : undefined;
  const host = d.hostname;
  const boot = simDate(ctx.w, d, -uptimeSecs(ctx.w, d));
  const stamp = (secs: number) => {
    const dt = new Date(boot.getTime() + secs * 1000);
    return dt.toUTCString().slice(8, 25).replace(/^(\w+) (\d+)/, '$1 $2');
  };
  if (prev) {
    const lines = prevBootPanic(d);
    if (!lines.length) return { out: `-- No entries --` };
    view(ctx, 'logs');
    return { out: lines.map((l) => `Oct 08 23:41:0${lines.indexOf(l)} ${host} ${l}`).join('\n') };
  }
  let lines = kernelLog(ctx.w, d);
  if (prio && ['err', '3', 'crit', '2', 'warning', '4'].includes(prio)) {
    const rank = { info: 6, warn: 4, err: 3, crit: 2 };
    const max = { err: 3, '3': 3, crit: 2, '2': 2, warning: 4, '4': 4 }[prio as 'err']!;
    lines = lines.filter((l) => rank[l.level] <= max);
  }
  view(ctx, 'logs');
  const svc =
    a.includes('-k') || prio
      ? []
      : [
          { t: 8, text: 'systemd[1]: Started node-agent.service - Fleet node agent.' },
          { t: 8.2, text: 'systemd[1]: Started lldpd.service - LLDP daemon.' },
          { t: 9, text: 'node-agent[1422]: registered with fleet controller' },
        ];
  const all = [...lines.map((l) => ({ t: l.t, text: `kernel: ${l.text}` })), ...svc].sort((x, y) => x.t - y.t);
  return { out: all.map((l) => `${stamp(l.t)} ${host} ${l.text}`).join('\n') || '-- No entries --' };
}

function rasmc(ctx: CmdCtx): CmdOut {
  const d = dev(ctx);
  view(ctx, 'memory');
  const rows: string[] = [];
  if (ctx.args.includes('--error-count')) {
    rows.push('Label               \tCE\tUE');
    for (const s of MODELS[d.model].slots.filter((x) => x.kind === 'dimm')) {
      const c = d.slots[s.id];
      const ce = c?.failure === 'dimm_ce_storm' ? 1311 : c?.failure === 'dimm_uce' ? 22 : 0;
      const ue = c?.failure === 'dimm_uce' ? 2 : 0;
      rows.push(`${s.id.padEnd(20)}\t${ce}\t${ue}`);
    }
    return { out: rows.join('\n') };
  }
  if (ctx.args.includes('--errors')) {
    let n = 1;
    for (const [slot, c] of Object.entries(d.slots)) {
      if (c?.failure === 'dimm_ce_storm' || c?.failure === 'dimm_uce') {
        rows.push(`${n++} 2026-10-09 0${n}:12:44 +0000 error: ${c.failure === 'dimm_uce' ? 'Uncorrected' : 'Corrected'} error, no action required.: ${c.failure === 'dimm_uce' ? 1 : 1311} errors at ${slot} location: ${edacName(slot)}, addr 0x5a3f1000, grain 32, syndrome 0`);
      }
    }
    return { out: rows.length ? `Memory controller events:\n${rows.join('\n')}` : 'No Memory errors.' };
  }
  return { out: 'Usage: ras-mc-ctl --error-count | --errors' };
}

function destructive(ctx: CmdCtx, name: string): CmdOut {
  const target = ctx.args.find((a) => a.startsWith('of=/dev/') || a.startsWith('/dev/'))?.replace('of=', '');
  const d = dev(ctx);
  const x = target ? findDisk(d, target) : undefined;
  if (x && (x.c.health === 'ok' || x.name.startsWith('nvme0') || x.name.startsWith('nvme1n'))) {
    ctx.api.dispatch({ type: 'penalty', rule: 'destructive_cmd', points: 15, reason: `Ran ${name} against ${target}, a healthy disk holding data`, safety: true, key: target });
  }
  return { err: `\x1b[31m⚠ Blocked by simulator: \`${name} ${ctx.args.join(' ')}\` would irreversibly destroy data${target ? ` on ${target}` : ''}.\nDCO techs never run destructive disk commands. Data-bearing drives are wiped/destroyed by the secure destruction process.\x1b[0m`, code: 1 };
}

// ---------- VFS ----------

function files(ctx: Omit<CmdCtx, 'args'>): Record<string, () => string> {
  const d = ctx.w.devices[ctx.frame.deviceId!];
  const c = ctx as CmdCtx;
  return {
    '/proc/mdstat': () => {
      c.api.dispatch({ type: 'setFlag', name: `viewed:${d.id}:raid` });
      return mdstat(d);
    },
    '/proc/meminfo': () => {
      c.api.dispatch({ type: 'setFlag', name: `viewed:${d.id}:memory` });
      return `MemTotal:       ${visibleMemoryGB(d) * 1024 * 1024 - 2_100_000} kB\nMemFree:        ${Math.round(visibleMemoryGB(d) * 1024 * 1024 * 0.31)} kB\nMemAvailable:   ${Math.round(visibleMemoryGB(d) * 1024 * 1024 * 0.55)} kB\nHugePages_Total:       0`;
    },
    '/proc/cpuinfo': () => `processor\t: 0\nvendor_id\t: GenuineX5\nmodel name\t: Generic X5 64-Core Processor @ 2.40GHz\ncpu MHz\t\t: ${Math.max(cpuTemp(d, 0), cpuTemp(d, 1)) >= 95 ? '800.000' : '2400.000'}\ncache size\t: 327680 KB\nphysical id\t: 0\ncpu cores\t: 64\n...`,
    '/etc/hostname': () => d.hostname,
    '/etc/os-release': () => 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu',
    '/var/log/kern.log': () => kernelLog(c.w, d).map((l) => `${d.hostname} kernel: ${fmtK(l, false, c.w, d)}`).join('\n'),
    '/var/log/syslog': () => kernelLog(c.w, d).map((l) => `${d.hostname} kernel: ${fmtK(l, false, c.w, d)}`).join('\n'),
    '/sys/class/net/eth0/operstate': () => (linkState(c.w, d.id, 'nic0p0').up ? 'up' : 'down'),
    '/sys/class/net/eth1/operstate': () => (linkState(c.w, d.id, 'nic0p1').up ? 'up' : 'down'),
    '/sys/class/net/eth0/address': () => d.macs.nic0p0.toLowerCase(),
    '/sys/class/net/eth1/address': () => d.macs.nic0p1.toLowerCase(),
    '/home/dcotech/README.txt': () => 'DCO quick reference\n- Always: sudo <cmd> for hardware tools\n- Map disks by SERIAL, never by sdX:  lsblk -o NAME,SERIAL,SIZE,MODEL\n- Blink a drive:  sudo ledctl locate=/dev/sdX   (locate_off= to stop)\n- Memory errors:  sudo ras-mc-ctl --error-count\n- Boot mirror:    cat /proc/mdstat\n- Links:          ip -br link ; sudo lldpctl',
  };
}

const DIRS: Record<string, (d: Device) => string[]> = {
  '/': () => ['bin', 'boot', 'data', 'dev', 'etc', 'home', 'proc', 'sys', 'usr', 'var'],
  '/home': () => ['dcotech'],
  '/home/dcotech': () => ['README.txt'],
  '/etc': () => ['hostname', 'os-release', 'fstab', 'mdadm'],
  '/proc': () => ['cpuinfo', 'meminfo', 'mdstat'],
  '/var': () => ['log'],
  '/var/log': () => ['kern.log', 'syslog', 'journal'],
  '/sys/class/net': () => ['bond0', 'eth0', 'eth1', 'lo'],
  '/dev': (d) => [...disks(d).map((x) => x.name), 'ipmi0', 'md0', 'md1', 'null', 'ttyS1'],
  '/data': (d) => disks(d).filter((x) => x.mount).map((x) => x.mount.split('/').pop()!),
};

// ---------- pack ----------

const HELP = `\x1b[1mLinux host — common DCO commands\x1b[0m  (prefix hardware tools with sudo)
  System:   hostname  uptime  uname -a  date  lscpu  free -g  sudo dmidecode -t memory|system|processor
  Logs:     sudo dmesg -T | tail   journalctl -p err   journalctl -b -1 (previous boot)
  Memory:   sudo ras-mc-ctl --error-count   sudo dmidecode -t memory
  Storage:  lsblk -o NAME,SERIAL,SIZE,MODEL   sudo smartctl -a /dev/sdX   sudo nvme list   cat /proc/mdstat
            sudo ledctl locate=/dev/sdX  (blink the bay)   sudo mdadm --detail /dev/md1
  Network:  ip -br link   ip a   ethtool eth0   ethtool -m eth0   ethtool -S eth0   sudo lldpctl
  GPU:      nvidia-smi   nvidia-smi -q   lspci | grep -i nvidia
  BMC:      sudo ipmitool sel elist   sudo ipmitool sdr   sudo ipmitool mc reset cold   (in-band, via /dev/ipmi0)
  Power:    sudo shutdown -h now   sudo reboot
  Pipes:    | grep [-i] PATTERN   | head -n N   | tail -n N   | wc -l   | sort   | uniq -c   | awk '{print $1}'
  exit      return to the jump host`;

export const linuxPack = (frameDeviceId: string): CommandPack => ({
  help: HELP,
  files,
  commands: {
    exit: (ctx) => {
      ctx.session.pop();
      return `logout\nConnection to ${ctx.w.devices[frameDeviceId]?.hostname} closed.`;
    },
    logout: (ctx) => {
      ctx.session.pop();
      return `logout\nConnection to ${ctx.w.devices[frameDeviceId]?.hostname} closed.`;
    },
    clear: () => '\x1b[2J\x1b[H',
    whoami: (ctx) => (ctx.sudo ? 'root' : 'dcotech'),
    id: (ctx) => (ctx.sudo ? 'uid=0(root) gid=0(root) groups=0(root)' : 'uid=1042(dcotech) gid=1042(dcotech) groups=1042(dcotech),27(sudo),4(adm)'),
    hostname: (ctx) => dev(ctx).hostname,
    uname: (ctx) => (ctx.args.includes('-a') ? `Linux ${dev(ctx).hostname} ${KERNEL} #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux` : 'Linux'),
    date: (ctx) => simDate(ctx.w, dev(ctx)).toUTCString().replace('GMT', 'UTC'),
    uptime: (ctx) => {
      const d = dev(ctx);
      return ` ${simDate(ctx.w, d).toISOString().slice(11, 19)} up ${fmtUptime(uptimeSecs(ctx.w, d))},  1 user,  load average: 41.12, 39.80, 38.95`;
    },
    pwd: (ctx) => ctx.frame.cwd,
    cd: (ctx) => {
      const p = resolvePath(ctx.frame.cwd, ctx.args[0] ?? '~');
      if (!DIRS[p] && !['/bin', '/boot', '/usr', '/sys', '/sys/class'].includes(p)) return { err: `-bash: cd: ${ctx.args[0]}: No such file or directory`, code: 1 };
      ctx.frame.cwd = p;
    },
    ls: (ctx) => {
      const target = resolvePath(ctx.frame.cwd, ctx.args.filter((a) => !a.startsWith('-'))[0] ?? '.');
      const d = dev(ctx);
      const ents = DIRS[target]?.(d);
      if (!ents) {
        const fl = files(ctx);
        if (fl[target]) return target.split('/').pop();
        return { err: `ls: cannot access '${target}': No such file or directory`, code: 2 };
      }
      return ents.join('  ');
    },
    cat: (ctx) => {
      const fl = files(ctx);
      const out: string[] = [];
      for (const a of ctx.args) {
        const p = resolvePath(ctx.frame.cwd, a);
        if (fl[p]) out.push(fl[p]());
        else return { err: `cat: ${a}: No such file or directory`, code: 1 };
      }
      return out.join('\n');
    },
    echo: (ctx) => ctx.args.join(' '),
    touch: (ctx) => (dev(ctx).os === 'readonly_fs' ? { err: `touch: cannot touch '${ctx.args[0]}': Read-only file system`, code: 1 } : ''),
    mkdir: (ctx) => (dev(ctx).os === 'readonly_fs' ? { err: `mkdir: cannot create directory '${ctx.args[0]}': Read-only file system`, code: 1 } : ''),
    man: (ctx) => {
      const m: Record<string, string> = {
        lsblk: 'lsblk - list block devices. Tip: -o NAME,SERIAL,SIZE,MODEL maps kernel names to physical serials.',
        smartctl: 'smartctl - control and monitor SMART disks. -H health, -a all info, -i identity.',
        ledctl: 'ledctl - Intel(R) LED control. ledctl locate=/dev/sdX blinks the bay; locate_off= stops it.',
        dmesg: 'dmesg - print the kernel ring buffer. -T human timestamps. Requires root on hardened hosts.',
        ipmitool: 'ipmitool - utility for controlling IPMI-enabled devices. In-band: sudo ipmitool <cmd>. Out-of-band: ipmitool -I lanplus -H <bmc> -U <user> -P <pw> <cmd>.',
        ethtool: 'ethtool - query network driver and hardware settings. -m module EEPROM (optic DOM), -S statistics, -i driver.',
        'ras-mc-ctl': 'ras-mc-ctl - RAS memory controller admin tool. --error-count shows CE/UE per DIMM label.',
      };
      return m[ctx.args[0]] ?? `No manual entry for ${ctx.args[0] ?? ''}`;
    },
    which: (ctx) => `/usr/bin/${ctx.args[0]}`,
    dmesg: (ctx) => {
      const d = dev(ctx);
      if (!ctx.sudo) return { err: 'dmesg: read kernel buffer failed: Operation not permitted', code: 1 };
      view(ctx, 'logs');
      const human = ctx.args.includes('-T');
      let lines = kernelLog(ctx.w, d);
      const lvl = ctx.args.indexOf('-l') >= 0 ? ctx.args[ctx.args.indexOf('-l') + 1] : ctx.args.find((x) => x.startsWith('--level='))?.split('=')[1];
      if (lvl) lines = lines.filter((l) => lvl.split(',').some((v) => (v === 'err' ? l.level === 'err' || l.level === 'crit' : v === 'warn' ? l.level === 'warn' : v === 'crit' ? l.level === 'crit' : true)));
      for (const l of lines) {
        if (l.text.includes('EDAC') || l.text.includes('mce')) view(ctx, 'memory');
      }
      return lines.map((l) => fmtK(l, human, ctx.w, d)).join('\n');
    },
    journalctl,
    lsblk,
    smartctl,
    nvme,
    mdadm: (ctx) => {
      const nr = needRoot(ctx, 'mdadm', 'mdadm: must be super-user to perform this action');
      if (nr) return nr;
      const d = dev(ctx);
      view(ctx, 'raid');
      const md = ctx.args.find((a) => a.startsWith('/dev/md')) ?? '/dev/md1';
      const m2 = ['M2_0', 'M2_1'].map((s) => (d.slots[s] && d.slots[s]!.health !== 'failed' && d.slots[s]!.seated ? d.osNames[s] : null));
      const ok = m2.filter(Boolean).length;
      return {
        out: `${md}:\n           Version : 1.2\n     Creation Time : Tue Mar  4 09:12:41 2025\n        Raid Level : raid1\n        Array Size : 936513536 (893.13 GiB 958.99 GB)\n      Raid Devices : 2\n     Total Devices : ${ok}\n             State : ${ok === 2 ? 'clean' : 'clean, degraded'}\n    Active Devices : ${ok}\n   Working Devices : ${ok}\n    Failed Devices : 0\n\n    Number   Major   Minor   RaidDevice State\n${m2.map((n, i) => (n ? `       ${i}     259        ${i * 16 + 2}        ${i}      active sync   /dev/${n}p${md.endsWith('0') ? 1 : 2}` : `       -       0        0        ${i}      removed`)).join('\n')}`,
      };
    },
    lscpu: (ctx) => {
      const d = dev(ctx);
      view(ctx, 'cpu');
      const cpus = installedOfKind(d, 'cpu').filter(([, c]) => c.health !== 'failed');
      return `Architecture:             x86_64\n  CPU op-mode(s):         32-bit, 64-bit\n  Address sizes:          52 bits physical, 57 bits virtual\nCPU(s):                   ${cpus.length * 128}\n  On-line CPU(s) list:    0-${cpus.length * 128 - 1}\nVendor ID:                GenuineX5\n  Model name:             Generic X5 64-Core Processor\n    Thread(s) per core:   2\n    Core(s) per socket:   64\n    Socket(s):            ${cpus.length}\n    CPU max MHz:          3800.0000\nNUMA:\n  NUMA node(s):           ${cpus.length}`;
    },
    free: (ctx) => {
      const d = dev(ctx);
      view(ctx, 'memory');
      const gb = visibleMemoryGB(d);
      const g = ctx.args.some((a) => a.includes('g') || a.includes('h'));
      const v = (x: number) => (g ? `${Math.round(x)}${ctx.args.includes('-h') ? 'Gi' : ''}` : String(Math.round(x * 1048576)));
      return `               total        used        free      shared  buff/cache   available\nMem:     ${v(gb * 0.981).padStart(11)} ${v(gb * 0.42).padStart(11)} ${v(gb * 0.31).padStart(11)} ${v(0.2).padStart(11)} ${v(gb * 0.25).padStart(11)} ${v(gb * 0.55).padStart(11)}\nSwap:              0           0           0`;
    },
    dmidecode,
    lshw: (ctx) => {
      const d = dev(ctx);
      if (!ctx.sudo) return { err: 'WARNING: you should run this program as super-user.', code: 1 };
      view(ctx, 'inventory');
      view(ctx, 'memory');
      const rows = [['H/W path', 'Device', 'Class', 'Description'], ['====================================================', '', '', '']];
      rows.push(['', '', 'system', MODELS[d.model].name]);
      for (const [s, c] of installedOfKind(d, 'cpu')) rows.push([`/0/${s.toLowerCase()}`, '', 'processor', `${partSpec(c.partNumber).desc}${c.health === 'failed' ? ' [DISABLED]' : ''}`]);
      rows.push(['/0/1000', '', 'memory', `${visibleMemoryGB(d)}GiB System Memory`]);
      for (const x of disks(d)) rows.push([`/0/100/${x.name}`, `/dev/${x.name}`, 'disk', `${x.sizeH} ${x.model}`]);
      if (d.slots.OCP0) rows.push(['/0/100/31', 'eth0', 'network', 'MT2894 Family [ConnectX-6 Lx]'], ['/0/100/31.1', 'eth1', 'network', 'MT2894 Family [ConnectX-6 Lx]']);
      return columns(rows);
    },
    lspci,
    ip: ipCmd,
    ethtool,
    lldpctl: (ctx) => (ctx.sudo ? lldpctl(ctx) : { err: 'lldpctl: unable to connect to socket /run/lldpd.socket: Permission denied', code: 1 }),
    'nvidia-smi': nvidiaSmi,
    'ras-mc-ctl': (ctx) => (ctx.sudo ? rasmc(ctx) : { err: 'ras-mc-ctl: Error: must be run as root', code: 1 }),
    'edac-util': (ctx) => {
      const d = dev(ctx);
      view(ctx, 'memory');
      const lines: string[] = [];
      for (const [slot, c] of Object.entries(d.slots)) if (c?.failure === 'dimm_ce_storm' || c?.failure === 'dimm_uce') lines.push(`mc${slot.includes('_B') ? 4 : 0}: csrow0: ${edacName(slot)}: ${c.failure === 'dimm_uce' ? 22 : 1311} Corrected Errors`);
      return lines.length ? lines.join('\n') : 'edac-util: No errors to report.';
    },
    df: (ctx) => {
      const d = dev(ctx);
      const rows = [['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on'], ['/dev/md1', '879G', '212G', '622G', '26%', '/'], ['/dev/md0', '989M', '201M', '721M', '22%', '/boot']];
      for (const x of disks(d)) if (x.mount) rows.push([`/dev/${x.name}`, x.sizeH, '11T', '6.4T', '63%', x.mount]);
      return columns(rows, 1);
    },
    mount: (ctx) => {
      const d = dev(ctx);
      return `/dev/md1 on / type ext4 (${d.os === 'readonly_fs' ? 'ro' : 'rw'},relatime)\n/dev/md0 on /boot type ext4 (rw,relatime)\n${disks(d)
        .filter((x) => x.mount)
        .map((x) => `/dev/${x.name} on ${x.mount} type xfs (rw,noatime,inode64)`)
        .join('\n')}`;
    },
    systemctl: (ctx) => {
      if (ctx.args.includes('--failed')) return dev(ctx).os === 'readonly_fs' ? '  UNIT                    LOAD   ACTIVE SUB    DESCRIPTION\n● systemd-journald.service loaded failed failed Journal Service\n● node-agent.service       loaded failed failed Fleet node agent' : '  UNIT LOAD ACTIVE SUB DESCRIPTION\n0 loaded units listed.';
      const unit = ctx.args[1] ?? 'node-agent';
      return `● ${unit}.service\n     Loaded: loaded (/lib/systemd/system/${unit}.service; enabled; preset: enabled)\n     Active: active (running) since ${simDate(ctx.w, dev(ctx), -uptimeSecs(ctx.w, dev(ctx))).toUTCString()}`;
    },
    ledctl: (ctx) => {
      const nr = needRoot(ctx, 'ledctl', 'ledctl: This utility must be run as root.');
      if (nr) return nr;
      const d = dev(ctx);
      const a = ctx.args.join(' ');
      const m = /(locate|locate_off|normal)=([^\s]+)/.exec(a);
      if (!m) return { err: 'Usage: ledctl locate=/dev/sdX | locate_off=/dev/sdX', code: 1 };
      const path = m[2];
      const x = findDisk(d, path);
      if (!x) {
        return { err: `ledctl: ${path}: device not found or not attached to an enclosure with LED support`, code: 1 };
      }
      ctx.api.dispatch({ type: 'driveLocate', deviceId: d.id, slot: x.slot, on: m[1] === 'locate' });
      return '';
    },
    ipmitool: (ctx) => {
      if (!ctx.sudo) return { err: 'Could not open device at /dev/ipmi0 or /dev/ipmi/0 or /dev/ipmidev/0: Permission denied', code: 1 };
      return ipmitoolCmd(ctx, dev(ctx), true);
    },
    ping: (ctx) => {
      const target = ctx.args.filter((x) => !x.startsWith('-'))[0];
      if (!target) return { err: 'ping: usage error: Destination address required', code: 1 };
      const r = resolve(ctx.w, target);
      if (!r) return { err: `ping: ${target}: Name or service not known`, code: 2 };
      // From prod network you can't reach the OOB network — a common confusion.
      if (r.plane === 'bmc') return { out: pingOut(target, r.ip, false), code: 1 };
      return { out: pingOut(target, r.ip, prodReachable(ctx.w, r.dev)) };
    },
    reboot: (ctx) => {
      const nr = needRoot(ctx, 'reboot', 'Call to Reboot failed: Interactive authentication required.');
      if (nr) return nr;
      const d = dev(ctx);
      ctx.api.dispatch({ type: 'osReboot', deviceId: d.id });
      ctx.session.pop();
      return `Broadcast message from root@${d.hostname}: The system will reboot now!\nConnection to ${d.hostname} closed by remote host.`;
    },
    shutdown: (ctx) => {
      const nr = needRoot(ctx, 'shutdown', 'Call to PowerOff failed: Interactive authentication required.');
      if (nr) return nr;
      const d = dev(ctx);
      if (ctx.args.includes('-r')) {
        ctx.api.dispatch({ type: 'osReboot', deviceId: d.id });
      } else ctx.api.dispatch({ type: 'osShutdown', deviceId: d.id });
      ctx.session.pop();
      return `Broadcast message from root@${d.hostname}: The system will power off now!\nConnection to ${d.hostname} closed by remote host.`;
    },
    poweroff: (ctx) => {
      const nr = needRoot(ctx, 'poweroff', 'Call to PowerOff failed: Interactive authentication required.');
      if (nr) return nr;
      const d = dev(ctx);
      ctx.api.dispatch({ type: 'osShutdown', deviceId: d.id });
      ctx.session.pop();
      return `Connection to ${d.hostname} closed by remote host.`;
    },
    dd: (ctx) => destructive(ctx, 'dd'),
    wipefs: (ctx) => destructive(ctx, 'wipefs'),
    'mkfs.xfs': (ctx) => destructive(ctx, 'mkfs.xfs'),
    'mkfs.ext4': (ctx) => destructive(ctx, 'mkfs.ext4'),
    mkfs: (ctx) => destructive(ctx, 'mkfs'),
    fdisk: (ctx) => destructive(ctx, 'fdisk'),
    parted: (ctx) => destructive(ctx, 'parted'),
    rm: (ctx) => (ctx.args.join(' ').includes('-rf /') ? destructive(ctx, 'rm') : { err: `rm: cannot remove '${ctx.args[ctx.args.length - 1]}': Permission denied`, code: 1 }),
    w: (ctx) => ` ${simDate(ctx.w).toISOString().slice(11, 19)} up ${fmtUptime(uptimeSecs(ctx.w, dev(ctx)))},  1 user\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\ndcotech  pts/0    10.250.0.5       14:00    0.00s  0.02s  0.00s w`,
    top: () => 'top - simulated: use `uptime` / `free -g` / `nvidia-smi` instead (interactive tools are disabled in this simulator).',
  },
});
