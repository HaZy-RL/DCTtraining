// Serial-over-LAN console + BIOS setup (raw-mode frames).
import { installedOfKind, memorySpeed, visibleMemoryGB } from '../projectors';
import { postTimeFor } from '../sim';
import type { Device, World } from '../types';
import type { Frame, ShellSession } from './core';

const ESC = '\x1b';

interface SolLine {
  at: number; // seconds since bootAt
  text: string;
}

function postLines(dev: Device): SolLine[] {
  const P = postTimeFor(dev);
  const L: SolLine[] = [];
  const cpus = installedOfKind(dev, 'cpu');
  L.push({ at: 0, text: `${ESC}[2J${ESC}[H${ESC}[1;37mGeneric Hyperscale BIOS 2.4.7   (C) 2026${ESC}[0m` });
  L.push({ at: 1, text: `System: ${dev.model.toUpperCase()}   S/N ${dev.serial}   BMC ${dev.bmc.ip}` });
  L.push({ at: 3, text: `CPU: ${cpus.length} socket(s) detected` });
  const halt = dev.quirks.find((q) => q.startsWith('post_halt:'));
  if (halt) {
    L.push({ at: 5, text: `${ESC}[1;31mPOST ERROR: ${halt.split(':')[1]}${ESC}[0m` });
    L.push({ at: 6, text: `${ESC}[1;31mSystem halted.${ESC}[0m` });
    return L;
  }
  if (dev.quirks.includes('mem_retrain') || P > 150)
    L.push({ at: 6, text: `${ESC}[33mMemory configuration changed — performing full memory training. This can take several minutes. Do not power off.${ESC}[0m` });
  else L.push({ at: 6, text: 'Memory training (fast boot)...' });
  for (let i = 1; i <= 4; i++) L.push({ at: 6 + (P * 0.35 * i) / 4, text: `  Training channel group ${i}/4 ... done` });
  for (const [slot, c] of installedOfKind(dev, 'dimm')) {
    if (!c.seated) L.push({ at: P * 0.42, text: `${ESC}[1;31m  ${slot}: Memory training failure — DIMM disabled${ESC}[0m` });
    else if (c.health === 'failed') L.push({ at: P * 0.42, text: `${ESC}[1;31m  ${slot}: Uncorrectable errors recorded — DIMM mapped out${ESC}[0m` });
  }
  L.push({ at: P * 0.45, text: `Memory: ${visibleMemoryGB(dev)} GB DDR5 @ ${memorySpeed(dev)} MT/s` });
  if (dev.quirks.includes('bios_defaults')) L.push({ at: P * 0.5, text: `${ESC}[33mCMOS checksum error — default settings loaded. System date/time reset.${ESC}[0m` });
  L.push({ at: P * 0.6, text: `${ESC}[1;36mPress <F2> Setup   <F11> Boot Menu   <F12> Network Boot${ESC}[0m` });
  L.push({ at: P * 0.75, text: `PCIe enumeration complete: ${installedOfKind(dev, 'nvme').length + installedOfKind(dev, 'm2').length} NVMe, ${installedOfKind(dev, 'hdd').length} SATA, OCP0 ${dev.slots.OCP0 ? '2x25G' : 'absent'}${dev.slots.PCIE1 ? ', GPU x16' : ''}` });
  L.push({ at: P * 0.95, text: 'POST complete.' });
  return L;
}

function bootLines(dev: Device, w: World): SolLine[] {
  const L: SolLine[] = [];
  const P = postTimeFor(dev);
  const first = dev.bootOrder[0] ?? '';
  if (dev.os === 'pxe_loop') {
    const start = P;
    const elapsed = w.t - (dev.bootAt ?? 0) - start;
    const loops = Math.min(20, Math.max(1, Math.floor(elapsed / 12) + 1));
    for (let i = 0; i < loops; i++) {
      const at = start + i * 12;
      L.push({ at, text: `${ESC}[0m>>Start PXE over IPv4 on ${first.startsWith('PXE') ? 'OCP0 Port 0' : 'OCP0 Port 0 (no bootable disk found)'}.` });
      L.push({ at: at + 4, text: '  PXE-E18: Server response timeout.' });
      L.push({ at: at + 6, text: '>>Start PXE over IPv6.' });
      L.push({ at: at + 10, text: '  PXE-E16: No valid offer received.' });
    }
    return L;
  }
  L.push({ at: P + 1, text: `Booting from ${first} ...` });
  L.push({ at: P + 3, text: `Loading Linux 6.8.0-45-generic ...` });
  L.push({ at: P + 5, text: 'Loading initial ramdisk ...' });
  L.push({ at: P + 8, text: '[    0.000000] Linux version 6.8.0-45-generic (buildd@lcy02-amd64-075)' });
  L.push({ at: P + 14, text: '[    4.012000] md/raid1:md1: active with 2 out of 2 mirrors' });
  L.push({ at: P + 22, text: '[  OK  ] Reached target multi-user.target - Multi-User System.' });
  return L;
}

function loginBanner(dev: Device): string {
  return `\r\nUbuntu 24.04.1 LTS ${dev.hostname} ttyS1\r\n\r\n${dev.hostname} login: `;
}

/** Text the console should show up to "now", in order. */
function solTimeline(w: World, dev: Device): { sig: string; lines: string[] } {
  if (dev.power === 'off' || dev.power === 'standby') return { sig: `off`, lines: [] };
  if (dev.os === 'panic' && (dev.bootAt === undefined || dev.quirks.includes('panicked'))) {
    return {
      sig: 'panic',
      lines: [
        '[3542871.220184] mce: [Hardware Error]: CPU 37: Machine Check Exception: 5 Bank 13: be00000000800400',
        '[3542871.220190] Kernel panic - not syncing: Fatal machine check',
        '[3542871.221004] CPU: 37 PID: 0 Comm: swapper/37 Tainted: G   M       OE      6.8.0-45-generic #45-Ubuntu',
        '[3542871.221010] Call Trace:',
        '[3542871.221011]  <#MC>',
        '[3542871.221013]  dump_stack_lvl+0x48/0x70',
        '[3542871.221020]  panic+0x34c/0x380',
        '[3542871.221028]  mce_panic+0x1b6/0x200',
        '[3542871.221110] Kernel Offset: 0x2a000000 from 0xffffffff81000000',
        '[3542871.221200] ---[ end Kernel panic - not syncing: Fatal machine check ]---',
      ],
    };
  }
  if (dev.bootAt === undefined) {
    if (dev.os === 'pxe_loop') return { sig: 'pxe', lines: ['>>Start PXE over IPv4 on OCP0 Port 0.', '  PXE-E18: Server response timeout.', '>>Start PXE over IPv6.', '  PXE-E16: No valid offer received.', '>>Start PXE over IPv4 on OCP0 Port 0.'] };
    if (dev.os === 'up' || dev.os === 'readonly_fs') return { sig: 'up', lines: [loginBanner(dev).trim()] };
    return { sig: 'idle', lines: [] };
  }
  const e = w.t - dev.bootAt;
  const all = [...postLines(dev), ...(dev.os !== 'down' || dev.power === 'on' ? bootLines(dev, w) : [])];
  const lines = all.filter((l) => l.at <= e).map((l) => l.text);
  if (dev.os === 'up' || dev.os === 'readonly_fs') lines.push(loginBanner(dev).trim());
  return { sig: `boot@${dev.bootAt}`, lines };
}

// ---------- BIOS setup ----------

const TABS = ['Main', 'Advanced', 'Boot', 'Save & Exit'];

function biosScreen(w: World, dev: Device, st: Record<string, unknown>): string {
  const tab = (st.tab as number) ?? 0;
  const sel = (st.sel as number) ?? 0;
  const order = (st.order as string[]) ?? dev.bootOrder;
  const clockOk = (st.clockFixed as boolean) || !dev.quirks.includes('clock_reset');
  const W = 78;
  const line = (s = '') => `${ESC}[44;37m│ ${s.padEnd(W - 2).slice(0, W - 2)}│${ESC}[0m`;
  const out: string[] = [`${ESC}[2J${ESC}[H`];
  out.push(`${ESC}[44;1;37m┌${'─'.repeat(W - 1)}┐${ESC}[0m`);
  out.push(line('                    Generic Hyperscale BIOS Setup Utility 2.4.7'));
  out.push(line(TABS.map((t, i) => (i === tab ? `[${t}]` : ` ${t} `)).join('   ')));
  out.push(line('─'.repeat(W - 3)));
  const dt = clockOk ? new Date(Date.UTC(2026, 9, 9, 14, 0, 0) + w.t * 1000) : new Date(Date.UTC(2017, 0, 1, 0, 0, 0) + w.t * 1000);
  const items: string[] = [];
  if (tab === 0) {
    items.push(`System Date/Time     ${dt.toISOString().replace('T', ' ').slice(0, 19)} UTC ${clockOk ? '' : `${ESC}[1;33m<-- WRONG (CMOS reset)${ESC}[44;37m`}`);
    items.push(`BIOS Version         2.4.7 (06/14/2026)`);
    items.push(`System Serial        ${dev.serial}`);
    items.push(`Total Memory         ${visibleMemoryGB(dev)} GB @ ${memorySpeed(dev)} MT/s`);
    items.push(`Processors           ${installedOfKind(dev, 'cpu').length} x Generic X5`);
    out.push(...items.map((s, i) => line(`${i === sel ? '>' : ' '} ${s}`)));
    out.push(line());
    out.push(line(`${ESC}[1;33m  [Enter] on Date/Time: sync clock from BMC (NTP)${ESC}[44;37m`));
  } else if (tab === 1) {
    out.push(line('  Console Redirection       [Enabled]  COM2 115200 8N1'));
    out.push(line('  SR-IOV                    [Enabled]'));
    out.push(line('  Power Restore Policy      [Always On]'));
    out.push(line('  Memory Patrol Scrub       [Enabled]'));
    out.push(line('  (read-only in this simulator)'));
  } else if (tab === 2) {
    out.push(line('  Boot Option Priorities   (↑/↓ select, +/- move)'));
    order.forEach((o, i) => out.push(line(`${i === sel ? '>' : ' '}   Boot Option #${i + 1}    [${o}]`)));
  } else {
    ['Save Changes and Exit  (F10)', 'Discard Changes and Exit (Esc)'].forEach((o, i) => out.push(line(`${i === sel ? '>' : ' '} ${o}`)));
  }
  while (out.length < 20) out.push(line());
  out.push(line('─'.repeat(W - 3)));
  out.push(line('←/→ Tab   ↑/↓ Select   +/- Change order   Enter Select   F10 Save & Exit   Esc Discard'));
  out.push(`${ESC}[44;1;37m└${'─'.repeat(W - 1)}┘${ESC}[0m`);
  return out.join('\r\n');
}

function biosKey(s: ShellSession, f: Frame, data: string): string {
  const w = s.api.getWorld();
  const dev = w.devices[f.deviceId!];
  const st = f.state!;
  st.order = (st.order as string[]) ?? [...dev.bootOrder];
  const order = st.order as string[];
  let tab = (st.tab as number) ?? 0;
  let sel = (st.sel as number) ?? 0;
  const exit = (save: boolean) => {
    s.api.dispatch({ type: 'biosExit', deviceId: dev.id, save, bootOrder: save ? order : undefined, fixClock: save ? !!st.clockFixed : false });
    s.pop(); // back to SOL
    const sol = s.frame;
    if (sol.state) sol.state.printed = 0;
    if (sol.state) sol.state.sig = '';
    return `${ESC}[0m${ESC}[2J${ESC}[H${save ? 'Saving changes... Resetting system.' : 'Exiting setup without saving.'}\r\n`;
  };
  switch (data) {
    case `${ESC}[C`:
      tab = (tab + 1) % TABS.length;
      sel = 0;
      break;
    case `${ESC}[D`:
      tab = (tab + TABS.length - 1) % TABS.length;
      sel = 0;
      break;
    case `${ESC}[A`:
      sel = Math.max(0, sel - 1);
      break;
    case `${ESC}[B`:
      sel = sel + 1;
      break;
    case '+':
    case '=':
      if (tab === 2 && sel > 0) {
        [order[sel - 1], order[sel]] = [order[sel], order[sel - 1]];
        sel--;
        st.dirty = true;
      }
      break;
    case '-':
      if (tab === 2 && sel < order.length - 1) {
        [order[sel + 1], order[sel]] = [order[sel], order[sel + 1]];
        sel++;
        st.dirty = true;
      }
      break;
    case '\r':
      if (tab === 0 && sel === 0) {
        st.clockFixed = true;
        st.dirty = true;
      }
      if (tab === 3) return exit(sel === 0);
      break;
    case `${ESC}[21~`: // F10
      return exit(true);
    case ESC:
      return exit(false);
  }
  const max = tab === 0 ? 4 : tab === 2 ? order.length - 1 : tab === 3 ? 1 : 0;
  st.tab = tab;
  st.sel = Math.min(sel, max);
  return biosScreen(w, dev, st);
}

// ---------- SOL ----------

export const solHandler = {
  render(s: ShellSession, f: Frame): string {
    const w = s.api.getWorld();
    const dev = w.devices[f.deviceId!];
    if (f.kind === 'bios') return '';
    if (!dev) return '';
    if (dev.quirks.includes('in_bios')) {
      s.push({ kind: 'bios', deviceId: dev.id, user: 'bios', hostLabel: dev.hostname, cwd: '/', raw: true, state: { tab: 0, sel: 0 } });
      s.api.dispatch({ type: 'setFlag', name: `viewed:${dev.id}:bios` });
      return biosScreen(w, dev, s.frame.state!);
    }
    const st = f.state!;
    const tl = solTimeline(w, dev);
    if (st.sig !== tl.sig) {
      st.sig = tl.sig;
      st.printed = 0;
    }
    const printed = (st.printed as number) ?? 0;
    const fresh = tl.lines.slice(printed);
    st.printed = tl.lines.length;
    if (!fresh.length) return '';
    return fresh.map((l) => l.replace(/\n/g, '\r\n')).join('\r\n') + '\r\n';
  },
  key(s: ShellSession, f: Frame, data: string): string | void {
    if (f.kind === 'bios') return biosKey(s, f, data);
    const w = s.api.getWorld();
    const dev = w.devices[f.deviceId!];
    const st = f.state!;
    let esc = (st.esc as string) ?? '';
    // ssh/ipmitool escape sequences only count at the start of a line
    if (st.lineStart && (data === '~' || esc)) {
      esc += data;
      st.esc = esc;
      if (esc === '~') return '';
      if (esc === '~?') {
        st.esc = '';
        return '\r\nSupported escape sequences:\r\n  ~.  - terminate connection (and any multiplexed sessions)\r\n  ~~  - send the escape character by typing it twice\r\n(Note that escapes are only recognized immediately after newline.)\r\n';
      }
      if (esc === '~.') {
        // The OUTER ssh (to the jump host) catches this — classic mistake.
        st.esc = '';
        while (s.stack.length > 1) s.stack.pop();
        s.api.dispatch({ type: 'setFlag', name: 'killed_jump_ssh' });
        return `\r\n${ESC}[33mConnection to dco-jump01 closed.${ESC}[0m\r\n(Oops — "~." was caught by your ssh session to the jump host, not by ipmitool. Use "~~." to exit SOL through ssh.)\r\n`;
      }
      if (esc === '~~') return '';
      if (esc === '~~.') {
        st.esc = '';
        s.pop();
        s.api.dispatch({ type: 'setFlag', name: `sol_exit_ok:${dev?.id}` });
        return '\r\n[terminated ipmitool]\r\n';
      }
      st.esc = '';
    }
    st.lineStart = data === '\r';
    if (!dev) return '';
    // F2 / Del during POST enters setup
    if ((data === `${ESC}OQ` || data === `${ESC}[12~` || data === `${ESC}[3~`) && dev.power === 'posting') {
      const r = s.api.dispatch({ type: 'biosKey', deviceId: dev.id });
      return r.ok ? `\r\n${ESC}[1;36mEntering Setup...${ESC}[0m\r\n` : '';
    }
    if (data === '\r') {
      if (dev.os === 'up' || dev.os === 'readonly_fs') {
        const buf = (st.buf as string) ?? '';
        st.buf = '';
        if (buf) return `\r\nPassword: \r\nLogin incorrect (console login is disabled for DCO — use ssh)\r\n${loginBanner(dev).trim()}`;
        return `\r\n${loginBanner(dev).trim()}`;
      }
      return '\r\n';
    }
    if (data === '\x7f') {
      st.buf = ((st.buf as string) ?? '').slice(0, -1);
      return '\b \b';
    }
    if (data >= ' ' && data.length === 1 && (dev.os === 'up' || dev.os === 'readonly_fs')) {
      st.buf = ((st.buf as string) ?? '') + data;
      return data;
    }
    return '';
  },
};
