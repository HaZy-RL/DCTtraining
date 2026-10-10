// Jump host, laptop, BMC CLI and switch command packs + session factory.
import { MODELS } from '../catalog';
import { goodPsuCount, hasAC, healthRollup, linkState, locationOf, rackLoadW, sensors } from '../projectors';
import type { Device } from '../types';
import { columns, ShellSession, type CmdCtx, type CmdOut, type CommandPack, type Frame, type SimApi } from './core';
import { ipmitoolCmd, selLines } from './ipmitool';
import { linuxPack } from './linux';
import { bmcReachable, hostIp, pingOut, prodReachable, resolve } from './net';
import { solHandler } from './sol';

const JUMP = 'dco-jump01';

function motd(d: Device, w: CmdCtx['w']): string {
  const h = healthRollup(w, d);
  return `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n  Host:      ${d.hostname}\n  Model:     ${MODELS[d.model].name}\n  Location:  ${locationOf(w, d)}\n  Asset:     ${d.assetTag}   S/N ${d.serial}\n  ${d.drained ? '\x1b[32mHost state: DRAINED (released to DCO)\x1b[0m' : '\x1b[33mHost state: IN PRODUCTION — do not reboot without a drain\x1b[0m'}\n  ${h.overall !== 'ok' ? `\x1b[31mHardware health: ${h.overall.toUpperCase()}\x1b[0m` : 'Hardware health: OK'}\n\n*** Authorized use only. All sessions are logged. ***`;
}

function enterSol(ctx: CmdCtx, d: Device): CmdOut {
  ctx.session.push({ kind: 'sol', deviceId: d.id, user: 'sol', hostLabel: d.hostname, cwd: '/', raw: true, state: { printed: 0, lineStart: true, esc: '' } });
  ctx.api.dispatch({ type: 'setFlag', name: `sol:${d.id}` });
  ctx.api.dispatch({ type: 'setFlag', name: `sel_viewed:${d.id}` });
  return { out: '[SOL Session operational.  Use ~? for help]' };
}

function oobIpmitool(ctx: CmdCtx): CmdOut {
  const a = ctx.args;
  const get = (f: string) => (a.indexOf(f) >= 0 ? a[a.indexOf(f) + 1] : undefined);
  const iface = get('-I');
  const host = get('-H');
  if (!host) return { err: 'Could not open device at /dev/ipmi0 or /dev/ipmi/0 or /dev/ipmidev/0: No such file or directory\n(The jump host has no local BMC. Use: ipmitool -I lanplus -H <host>-bmc -U admin -E <command>)', code: 1 };
  if (iface !== 'lanplus') return { err: 'Error: Unable to establish LAN session\nError: Unable to establish IPMI v1.5 / RMCP session\n(Hint: modern BMCs require IPMI 2.0 — add -I lanplus)', code: 1 };
  if (!get('-U')) return { err: 'Error: Unable to establish IPMI v2 / RMCP+ session (no username; use -U admin)', code: 1 };
  if (!get('-P') && !a.includes('-E')) return { err: 'Password: \nError: password required. Use -E to read $IPMI_PASSWORD (preferred) or -P <password>.', code: 1 };
  const r = resolve(ctx.w, host);
  if (!r) return { err: `Address lookup for ${host} failed`, code: 1 };
  if (r.plane !== 'bmc') return { err: `Error: Unable to establish IPMI v2 / RMCP+ session\n(${host} is the host's PRODUCTION address. The BMC is ${r.dev.hostname}-bmc / ${r.dev.bmc.ip})`, code: 1 };
  if (!bmcReachable(ctx.w, r.dev)) return { err: 'Error: Unable to establish IPMI v2 / RMCP+ session', code: 1 };
  const out = ipmitoolCmd(ctx, r.dev, false);
  if (out.out === '__SOL__') return enterSol(ctx, r.dev);
  return out;
}

function ssh(ctx: CmdCtx): CmdOut {
  const target = ctx.args.filter((x) => !x.startsWith('-'))[0];
  if (!target) return { err: 'usage: ssh [-l login_name] [user@]hostname', code: 255 };
  const user = target.includes('@') ? target.split('@')[0] : 'dcotech';
  const host = target.replace(/^.*@/, '');
  const r = resolve(ctx.w, host);
  if (!r) return { err: `ssh: Could not resolve hostname ${host}: Name or service not known`, code: 255 };
  const d = r.dev;
  if (r.plane === 'bmc') {
    if (!bmcReachable(ctx.w, d)) return { err: `ssh: connect to host ${host} port 22: Connection timed out`, code: 255 };
    ctx.session.push({ kind: 'bmc', deviceId: d.id, user: user === 'dcotech' ? 'admin' : user, hostLabel: `${d.hostname}-bmc`, cwd: '/admin1' });
    ctx.api.dispatch({ type: 'setFlag', name: `bmc_ssh:${d.id}` });
    return { out: `${d.hostname}-bmc  ${d.bmc.fw}\nType "help" for a list of commands.` };
  }
  if (d.role === 'switch' || d.role === 'mgmt_switch') {
    if (!hasAC(ctx.w, d)) return { err: `ssh: connect to host ${host} port 22: Connection timed out`, code: 255 };
    ctx.session.push({ kind: 'switch', deviceId: d.id, user: 'dco-ro', hostLabel: d.hostname, cwd: '/' });
    return { out: `${MODELS[d.model].name}\nUser dco-ro: read-only role. Configuration changes require NetEng.` };
  }
  if (!prodReachable(ctx.w, d)) {
    const why = d.power !== 'on' ? 'Connection timed out' : d.os !== 'up' && d.os !== 'readonly_fs' ? 'Connection refused' : 'No route to host';
    return { err: `ssh: connect to host ${host} port 22: ${why}`, code: 255 };
  }
  ctx.session.push({ kind: 'host', deviceId: d.id, user: 'dcotech', hostLabel: d.hostname, cwd: '/home/dcotech' });
  ctx.api.dispatch({ type: 'setFlag', name: `ssh:${d.id}` });
  return { out: motd(d, ctx.w) };
}

function cmdb(ctx: CmdCtx): CmdOut {
  const q = (ctx.args[ctx.args[0] === 'search' ? 1 : 0] ?? '').toLowerCase();
  if (!q) return { err: 'usage: cmdb [search] <hostname|serial|asset-tag|ip|location>', code: 1 };
  const hits = Object.values(ctx.w.devices).filter((d) =>
    [d.hostname, d.serial, d.assetTag, d.bmc.ip, hostIp(ctx.w, d), locationOf(ctx.w, d)].some((x) => x.toLowerCase().includes(q)),
  );
  if (!hits.length) return { out: 'No matching assets.' };
  ctx.api.dispatch({ type: 'setFlag', name: 'used_cmdb' });
  const rows = [['HOSTNAME', 'ASSET', 'SERIAL', 'MODEL', 'LOCATION', 'BMC IP', 'STATE']];
  const loc = (d: Device) => d.quirks.find((q) => q.startsWith('cmdb_stale:'))?.slice(11) ?? locationOf(ctx.w, d);
  for (const d of hits.slice(0, 20)) rows.push([d.hostname, d.assetTag, d.serial, MODELS[d.model].id.toUpperCase(), loc(d), d.role === 'server' ? d.bmc.ip : '-', d.drained ? 'maintenance' : 'production']);
  return { out: columns(rows) };
}

function curl(ctx: CmdCtx): CmdOut {
  const url = ctx.args.find((a) => a.startsWith('http'));
  if (!url) return { err: 'curl: no URL specified!', code: 2 };
  const m = /^https?:\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!m) return { err: 'curl: (3) URL using bad/illegal format', code: 3 };
  const r = resolve(ctx.w, m[1]);
  if (!r) return { err: `curl: (6) Could not resolve host: ${m[1]}`, code: 6 };
  if (r.plane !== 'bmc') return { err: `curl: (7) Failed to connect to ${m[1]} port 443 after 3002 ms: Couldn't connect to server`, code: 7 };
  if (!bmcReachable(ctx.w, r.dev)) return { err: `curl: (28) Failed to connect to ${m[1]} port 443 after 21004 ms: Timeout was reached`, code: 28 };
  if (!ctx.args.includes('-k') && !ctx.args.includes('--insecure')) return { err: 'curl: (60) SSL certificate problem: self-signed certificate\nMore details here: https://curl.se/docs/sslcerts.html\n(BMCs use self-signed certs — add -k)', code: 60 };
  if (!ctx.args.includes('-u')) return { out: '{"error":{"code":"Base.1.8.GeneralError","message":"401 Unauthorized — supply -u admin:<password>"}}' };
  const d = r.dev;
  const path = (m[2] ?? '/redfish/v1').replace(/\/$/, '');
  const h = healthRollup(ctx.w, d);
  const H = (s: string) => (s === 'ok' ? 'OK' : s === 'warning' ? 'Warning' : s === 'critical' ? 'Critical' : 'Unknown');
  const post = ctx.args.includes('-X') && ctx.args[ctx.args.indexOf('-X') + 1] === 'POST';
  if (post && path.endsWith('ComputerSystem.Reset')) {
    const body = ctx.args[ctx.args.indexOf('-d') + 1] ?? '';
    const rt = /"ResetType"\s*:\s*"(\w+)"/.exec(body)?.[1];
    const map: Record<string, 'on' | 'off' | 'soft' | 'cycle' | 'reset'> = { On: 'on', ForceOff: 'off', GracefulShutdown: 'soft', ForceRestart: 'reset', PowerCycle: 'cycle' };
    if (!rt || !map[rt]) return { out: '{"error":{"code":"Base.1.8.ActionParameterNotSupported","message":"ResetType must be one of On, ForceOff, GracefulShutdown, ForceRestart, PowerCycle"}}' };
    const res = ctx.api.dispatch({ type: 'bmcPower', deviceId: d.id, op: map[rt] });
    return { out: res.ok ? '' : `{"error":{"message":"${res.message}"}}` };
  }
  const j = (o: unknown) => ({ out: JSON.stringify(o, null, 2) });
  if (path === '/redfish/v1') return j({ '@odata.id': '/redfish/v1', RedfishVersion: '1.17.0', Systems: { '@odata.id': '/redfish/v1/Systems' }, Chassis: { '@odata.id': '/redfish/v1/Chassis' }, Managers: { '@odata.id': '/redfish/v1/Managers' } });
  if (path === '/redfish/v1/Systems/1' || path === '/redfish/v1/Systems/System.Embedded.1') {
    ctx.api.dispatch({ type: 'setFlag', name: `viewed:${d.id}:health` });
    ctx.api.dispatch({ type: 'setFlag', name: 'used_redfish' });
    return j({
      '@odata.id': '/redfish/v1/Systems/1',
      Id: '1',
      HostName: d.hostname,
      Model: MODELS[d.model].name.split(' ')[0],
      SerialNumber: d.serial,
      AssetTag: d.assetTag,
      PowerState: d.power === 'on' || d.power === 'posting' ? 'On' : 'Off',
      Boot: { BootOrder: d.bootOrder },
      Status: { State: 'Enabled', Health: H(h.overall), HealthRollup: H(h.overall) },
      MemorySummary: { Status: { Health: H(h.memory) } },
      ProcessorSummary: { Count: 2, Status: { Health: H(h.processors) } },
      Actions: { '#ComputerSystem.Reset': { target: '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset' } },
    });
  }
  if (path.endsWith('/Thermal')) {
    ctx.api.dispatch({ type: 'setFlag', name: `viewed:${d.id}:fans` });
    const s = sensors(ctx.w, d);
    return j({ Fans: s.filter((x) => x.name.startsWith('Fan')).map((x) => ({ Name: x.name, Reading: Number(x.value) || 0, Status: { Health: x.status === 'ok' ? 'OK' : 'Critical' } })), Temperatures: s.filter((x) => x.unit.includes('degrees')).map((x) => ({ Name: x.name, ReadingCelsius: Number(x.value) || null })) });
  }
  if (path.endsWith('/Power')) {
    ctx.api.dispatch({ type: 'setFlag', name: `viewed:${d.id}:power` });
    return j({ PowerSupplies: ['PSU1', 'PSU2'].map((p) => ({ Name: p, Status: { Health: d.slots[p]?.health === 'ok' ? 'OK' : 'Critical', State: d.slots[p] ? 'Enabled' : 'Absent' }, SerialNumber: d.slots[p]?.serial })), Redundancy: [{ Status: { Health: goodPsuCount(ctx.w, d) >= 2 ? 'OK' : 'Critical' } }] });
  }
  if (path.includes('LogServices/Sel/Entries')) {
    ctx.api.dispatch({ type: 'setFlag', name: `sel_viewed:${d.id}` });
    return j({ Members: d.sel.map((e) => ({ Id: String(e.id), Message: `${e.sensor}: ${e.event}`, Severity: e.severity === 'critical' ? 'Critical' : e.severity === 'warning' ? 'Warning' : 'OK' })) });
  }
  return { out: '{"error":{"code":"Base.1.8.ResourceMissingAtURI","message":"The resource at the URI was not found."}}' };
}

const JUMP_HELP = `\x1b[1mJump host (${JUMP}) — your gateway to the fleet\x1b[0m
  ssh <hostname>                 log into a server's OS (production network)
  ssh admin@<hostname>-bmc       log into a server's BMC CLI (OOB network)
  ssh <tor-switch-hostname>      read-only switch CLI
  ping <hostname | host-bmc>     reachability test
  cmdb <hostname|serial|asset>   look up an asset: location, BMC IP, state
  ipmitool -I lanplus -H <host>-bmc -U admin -E <cmd>
        cmds: chassis status | power status|on|off|soft|cycle | sel elist | sel clear
              sdr | sdr type Fan | fru | mc info | mc reset cold | sol activate
              chassis identify force|0 | chassis bootdev disk|pxe
  curl -k -u admin:$PW https://<host>-bmc/redfish/v1/Systems/1   (Redfish API)
  exit                           disconnect from the jump host
  \x1b[2mTip: $IPMI_PASSWORD is pre-loaded from the vault; -E uses it so the password never lands in shell history.\x1b[0m`;

const jumpPack: CommandPack = {
  help: JUMP_HELP,
  commands: {
    ssh,
    ping: (ctx) => {
      const target = ctx.args.filter((x) => !x.startsWith('-'))[0];
      if (!target) return { err: 'ping: usage error: Destination address required', code: 1 };
      const r = resolve(ctx.w, target);
      if (!r) return { err: `ping: ${target}: Name or service not known`, code: 2 };
      const okk = r.plane === 'bmc' ? bmcReachable(ctx.w, r.dev) : prodReachable(ctx.w, r.dev);
      ctx.api.dispatch({ type: 'setFlag', name: `pinged:${r.dev.id}:${r.plane}` });
      return { out: pingOut(target, r.ip, okk), code: okk ? 0 : 1 };
    },
    ipmitool: oobIpmitool,
    cmdb,
    curl,
    host: (ctx) => {
      const r = resolve(ctx.w, ctx.args[0] ?? '');
      return r ? `${ctx.args[0]} has address ${r.ip}` : { err: `Host ${ctx.args[0]} not found: 3(NXDOMAIN)`, code: 1 };
    },
    nslookup: (ctx) => {
      const r = resolve(ctx.w, ctx.args[0] ?? '');
      return r ? `Server:\t\t10.250.0.53\nAddress:\t10.250.0.53#53\n\nName:\t${ctx.args[0]}\nAddress: ${r.ip}` : { err: `** server can't find ${ctx.args[0]}: NXDOMAIN`, code: 1 };
    },
    echo: (ctx) => ctx.args.map((a) => (a === '$IPMI_PASSWORD' ? '********' : a)).join(' '),
    clear: () => '\x1b[2J\x1b[H',
    whoami: () => 'dcotech',
    hostname: () => JUMP,
    date: (ctx) => new Date(Date.UTC(2026, 9, 9, 14, 0, 0) + ctx.w.t * 1000).toUTCString().replace('GMT', 'UTC'),
    exit: (ctx) => {
      ctx.session.pop();
      return `logout\nConnection to ${JUMP} closed.`;
    },
    logout: (ctx) => {
      ctx.session.pop();
      return `logout\nConnection to ${JUMP} closed.`;
    },
  },
};

const laptopPack: CommandPack = {
  help: `You are on your DCO laptop. Connect to the jump host first:\n  ssh ${JUMP}`,
  commands: {
    ssh: (ctx) => {
      const t = (ctx.args[0] ?? '').replace(/^.*@/, '');
      if (t === JUMP || t === 'jump' || t === `${JUMP}.phx1.dc`) {
        ctx.session.push({ kind: 'jump', user: 'dcotech', hostLabel: JUMP, cwd: '/home/dcotech' });
        return `Last login: Fri Oct  9 13:58:12 2026 from 10.1.44.17\n\x1b[2mType "help" for the DCO command cheat-sheet.\x1b[0m`;
      }
      return { err: `ssh: connect to host ${t} port 22: Connection timed out\n(Servers are only reachable through the jump host: ssh ${JUMP})`, code: 255 };
    },
    clear: () => '\x1b[2J\x1b[H',
  },
};

// ---------- BMC CLI ----------

function bmcDev(ctx: CmdCtx): Device {
  return ctx.w.devices[ctx.frame.deviceId!];
}

const BMC_HELP = `\x1b[1mBMC CLI\x1b[0m
  show system | health | sensors | sel | fru | power | network | memory | storage
  power status | on | off | soft | cycle | reset
  sel list | sel clear
  locate on | off                   chassis identify LED
  drive locate <BAYn> on|off        blink a drive bay
  reset bmc                         cold-reset the BMC itself (host keeps running)
  console                           serial-over-LAN console (exit with ~~. via the jump host)
  exit`;

const bmcPack: CommandPack = {
  help: BMC_HELP,
  commands: {
    exit: (ctx) => {
      ctx.session.pop();
      return 'Connection closed.';
    },
    quit: (ctx) => {
      ctx.session.pop();
      return 'Connection closed.';
    },
    show: (ctx) => {
      const d = bmcDev(ctx);
      const what = ctx.args[0] ?? 'system';
      const flag = (n: string) => ctx.api.dispatch({ type: 'setFlag', name: n });
      if (!d.bmc.responsive) return { err: 'Error: BMC busy', code: 1 };
      switch (what) {
        case 'system':
          flag(`viewed:${d.id}:inventory`);
          return `Hostname      : ${d.hostname}\nModel         : ${MODELS[d.model].name}\nSerial        : ${d.serial}\nAsset Tag     : ${d.assetTag}\nPower         : ${d.power === 'on' || d.power === 'posting' ? 'On' : 'Off'}${d.power === 'posting' ? ' (POST in progress)' : ''}\nHealth        : ${healthRollup(ctx.w, d).overall.toUpperCase()}\nBMC Firmware  : ${d.bmc.fw}\nBIOS          : 2.4.7\nBoot Order    : ${d.bootOrder.join(' > ')}`;
        case 'health': {
          flag(`viewed:${d.id}:health`);
          const h = healthRollup(ctx.w, d);
          return columns(Object.entries(h).map(([k, v]) => [k.padEnd(12), v === 'ok' ? 'OK' : v.toUpperCase()]));
        }
        case 'sensors':
          for (const t of ['health', 'power', 'fans', 'bios', 'cpu']) flag(`viewed:${d.id}:${t}`);
          return columns([['SENSOR', 'READING', 'STATUS'], ...sensors(ctx.w, d).map((s) => [s.name, `${s.value} ${s.unit === 'discrete' ? '' : s.unit}`, s.status.toUpperCase()])]);
        case 'sel':
        case 'log':
          flag(`sel_viewed:${d.id}`);
          flag(`viewed:${d.id}:sel`);
          return selLines(d, true);
        case 'fru':
          flag(`viewed:${d.id}:inventory`);
          return columns([['SLOT', 'PART NUMBER', 'SERIAL', 'HEALTH'], ...Object.entries(d.slots).filter(([, c]) => c).map(([s, c]) => [s, c!.partNumber, c!.serial, c!.health.toUpperCase()])]);
        case 'memory':
          flag(`viewed:${d.id}:memory`);
          return columns([['DIMM', 'SIZE', 'PART NUMBER', 'SERIAL', 'STATUS'], ...MODELS[d.model].slots.filter((s) => s.kind === 'dimm').map((s) => { const c = d.slots[s.id]; return [s.id, c ? (c.partNumber.includes('32G') ? '32 GB' : '64 GB') : '-', c?.partNumber ?? 'Not installed', c?.serial ?? '-', !c ? 'ABSENT' : !c.seated ? 'NOT SEATED' : c.health === 'ok' ? 'OK' : c.health === 'degraded' ? 'WARNING' : 'CRITICAL']; })]);
        case 'storage':
          flag(`viewed:${d.id}:storage`);
          return columns([['BAY', 'PART NUMBER', 'SERIAL', 'STATUS'], ...MODELS[d.model].slots.filter((s) => s.kind === 'hdd' || s.kind === 'nvme' || s.kind === 'm2').map((s) => { const c = d.slots[s.id]; return [s.id, c?.partNumber ?? 'Empty', c?.serial ?? '-', !c ? 'ABSENT' : c.health === 'ok' ? 'OK' : c.health === 'degraded' ? 'PREDICTIVE FAILURE' : 'FAILED']; })]);
        case 'power':
          flag(`viewed:${d.id}:power`);
          return `Chassis power  : ${d.power}\nPSU redundancy : ${goodPsuCount(ctx.w, d) >= 2 ? 'Full' : 'LOST'}\nRack load      : ${(rackLoadW(ctx.w, d.rackId ?? '') / 1000).toFixed(2)} kW (rack ${d.rackId})`;
        case 'network':
          return `BMC IP   : ${d.bmc.ip}\nBMC MAC  : ${d.bmc.mac}\nNIC0 P0  : ${d.macs.nic0p0}  link ${linkState(ctx.w, d.id, 'nic0p0').up ? 'UP' : 'DOWN'}\nNIC0 P1  : ${d.macs.nic0p1}  link ${linkState(ctx.w, d.id, 'nic0p1').up ? 'UP' : 'DOWN'}`;
        default:
          return { err: `Unknown target "${what}". Try: show system|health|sensors|sel|fru|memory|storage|power|network`, code: 1 };
      }
    },
    power: (ctx) => {
      const d = bmcDev(ctx);
      const op = ctx.args[0] ?? 'status';
      if (op === 'status') return `Chassis power is ${d.power === 'on' || d.power === 'posting' ? 'on' : 'off'}`;
      if (!['on', 'off', 'soft', 'cycle', 'reset'].includes(op)) return { err: 'usage: power status|on|off|soft|cycle|reset', code: 1 };
      const r = ctx.api.dispatch({ type: 'bmcPower', deviceId: d.id, op: op as 'on' });
      return r.ok ? r.message : { err: r.message, code: 1 };
    },
    sel: (ctx) => {
      const d = bmcDev(ctx);
      if (ctx.args[0] === 'clear') {
        const r = ctx.api.dispatch({ type: 'selClear', deviceId: d.id });
        return r.ok ? 'SEL cleared.' : { err: r.message, code: 1 };
      }
      ctx.api.dispatch({ type: 'setFlag', name: `sel_viewed:${d.id}` });
      return selLines(d, true);
    },
    locate: (ctx) => {
      const r = ctx.api.dispatch({ type: 'locate', deviceId: bmcDev(ctx).id, on: ctx.args[0] !== 'off' });
      return r.message;
    },
    drive: (ctx) => {
      if (ctx.args[0] !== 'locate' || !ctx.args[1]) return { err: 'usage: drive locate <BAYn> on|off', code: 1 };
      const slot = ctx.args[1].toUpperCase();
      const d = bmcDev(ctx);
      if (!(slot in d.slots)) return { err: `No such bay ${slot}`, code: 1 };
      return ctx.api.dispatch({ type: 'driveLocate', deviceId: d.id, slot, on: ctx.args[2] !== 'off' }).message;
    },
    reset: (ctx) => {
      if (ctx.args[0] !== 'bmc') return { err: 'usage: reset bmc', code: 1 };
      const r = ctx.api.dispatch({ type: 'bmcReset', deviceId: bmcDev(ctx).id });
      ctx.session.pop();
      return `${r.message}\nConnection to BMC closed by remote host.`;
    },
    console: (ctx) => enterSol(ctx, bmcDev(ctx)),
  },
};

// ---------- switch CLI (read-only) ----------

function swDev(ctx: CmdCtx): Device {
  return ctx.w.devices[ctx.frame.deviceId!];
}

const switchPack: CommandPack = {
  help: `\x1b[1mSwitch CLI (read-only DCO role)\x1b[0m\n  show interface status\n  show interface <swpN>\n  show interface transceiver <swpN>\n  show lldp neighbors\n  show logging\n  exit`,
  commands: {
    exit: (ctx) => {
      ctx.session.pop();
      return 'Connection closed.';
    },
    configure: () => ({ err: '% Permission denied: the dco-ro role cannot change configuration. Escalate to NetEng with the port and evidence.', code: 1 }),
    nv: () => ({ err: '% Permission denied: the dco-ro role cannot change configuration.', code: 1 }),
    shutdown: () => ({ err: '% Permission denied.', code: 1 }),
    no: () => ({ err: '% Permission denied.', code: 1 }),
    show: (ctx) => {
      const sw = swDev(ctx);
      const [a, b, c] = ctx.args;
      const ports = MODELS[sw.model].ports;
      const portRow = (p: string) => {
        const ls = linkState(ctx.w, sw.id, p);
        const admin = sw.quirks.includes(`admin_down:${p}`) ? 'down' : 'up';
        const peer = ls.peer ? `${ls.peer.hostname}:${ls.peer.port}` : '';
        return [p, admin, ls.up ? 'up' : 'down', ls.up ? ls.speed.replace('000Mb/s', 'G').replace('100000Mb/s', '100G') : '-', peer || (Object.values(ctx.w.cables).some((k) => (k.a?.deviceId === sw.id && k.a.port === p) || (k.b?.deviceId === sw.id && k.b.port === p)) ? '(cabled)' : '')];
      };
      if (a === 'interface' && (b === 'status' || !b)) {
        ctx.api.dispatch({ type: 'setFlag', name: `viewed:${sw.id}:switchports` });
        return columns([['PORT', 'ADMIN', 'OPER', 'SPEED', 'LLDP NEIGHBOR'], ...ports.filter((p) => Object.values(ctx.w.cables).some((k) => (k.a?.deviceId === sw.id && k.a.port === p) || (k.b?.deviceId === sw.id && k.b.port === p)) || sw.quirks.includes(`admin_down:${p}`)).map(portRow)]);
      }
      if (a === 'interface' && b === 'transceiver' && c) {
        const cable = Object.values(ctx.w.cables).find((k) => (k.a?.deviceId === sw.id && k.a.port === c) || (k.b?.deviceId === sw.id && k.b.port === c));
        if (!cable) return `${c}: transceiver not present`;
        const isFiber = cable.type.startsWith('fiber') || cable.type === 'aoc';
        return `${c}\n  Type          : ${cable.type === 'dac' ? '25G DAC passive' : cable.type === 'aoc' ? '100G AOC' : '100G-SR4 QSFP28'}\n  Length        : ${cable.lengthM} m\n${isFiber ? `  Tx power      : -1.12 dBm\n  Rx power      : ${cable.condition === 'dirty' ? '-13.85 dBm  [LOW ALARM]' : '-2.47 dBm'}\n` : ''}  CRC errors    : ${linkState(ctx.w, sw.id, c).crcErrors}`;
      }
      if (a === 'interface' && b) {
        ctx.api.dispatch({ type: 'setFlag', name: `viewed:${sw.id}:switchports` });
        if (!ports.includes(b)) return { err: `% Invalid interface ${b}`, code: 1 };
        const [p, admin, oper, speed, peer] = portRow(b);
        const ls = linkState(ctx.w, sw.id, b);
        return `${p} is admin ${admin}, oper ${oper}${oper === 'down' && admin === 'up' ? ` (${ls.reason})` : ''}\n  Speed ${speed}, MTU 9216\n  LLDP neighbor: ${peer || 'none'}\n  Input errors: ${ls.crcErrors} CRC, 0 runts\n  Link flaps (24h): ${ls.crcErrors ? 41 : 0}`;
      }
      if (a === 'lldp') {
        ctx.api.dispatch({ type: 'setFlag', name: `viewed:${sw.id}:lldp` });
        return columns([['LOCAL PORT', 'NEIGHBOR', 'NEIGHBOR PORT'], ...ports.map((p) => linkState(ctx.w, sw.id, p)).map((ls, i) => [ports[i], ls.up && ls.peer ? ls.peer.hostname : '', ls.up && ls.peer ? (ls.peer.port === 'nic0p0' ? 'eth0' : ls.peer.port === 'nic0p1' ? 'eth1' : ls.peer.port) : '']).filter((r) => r[1])]);
      }
      if (a === 'logging') {
        ctx.api.dispatch({ type: 'setFlag', name: `viewed:${sw.id}:switchports` });
        const lines: string[] = [];
        for (const p of ports) {
          const cable = Object.values(ctx.w.cables).find((k) => (k.a?.deviceId === sw.id && k.a.port === p) || (k.b?.deviceId === sw.id && k.b.port === p));
          if (cable?.condition === 'dirty') for (let i = 0; i < 4; i++) lines.push(`2026-10-09T1${3 - i % 2}:${10 + i * 7}:02 ${sw.hostname} switchd: ${p}: link down (remote fault) → up`);
          if (cable && linkState(ctx.w, sw.id, p).reason === 'Bad termination') lines.push(`2026-10-09T13:22:40 ${sw.hostname} switchd: ${p}: link down (no signal)`);
          if (sw.quirks.includes(`admin_down:${p}`)) lines.push(`2026-10-08T22:01:13 ${sw.hostname} nvued: ${p}: admin state set DOWN by user neteng-auto (change CHG-88213)`);
        }
        return lines.join('\n') || 'No recent events.';
      }
      return { err: '% Incomplete command. Try: show interface status | show interface <swpN> | show lldp neighbors | show logging', code: 1 };
    },
  },
};

// ---------- factory ----------

export function resolverFor(frame: Frame): CommandPack {
  switch (frame.kind) {
    case 'laptop':
      return laptopPack;
    case 'jump':
      return jumpPack;
    case 'host':
      return linuxPack(frame.deviceId!);
    case 'bmc':
      return bmcPack;
    case 'switch':
      return switchPack;
    default:
      return { help: '', commands: {} };
  }
}

export function createSession(api: SimApi): ShellSession {
  const s = new ShellSession(api, resolverFor, [
    { kind: 'laptop', user: 'you', hostLabel: 'dco-laptop', cwd: '/home/you' },
    { kind: 'jump', user: 'dcotech', hostLabel: JUMP, cwd: '/home/dcotech' },
  ]);
  s.rawHandler = solHandler;
  return s;
}

export const JUMP_HOST = JUMP;
