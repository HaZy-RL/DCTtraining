import { useEffect, useMemo, useState } from 'react';
import { KIND_LABEL, MODELS, partSpec } from '../../engine/catalog';
import { goodPsuCount, hasAC, healthRollup, linkState, sensors, slotLed } from '../../engine/projectors';
import { bmcReachable } from '../../engine/shells/net';
import type { Device } from '../../engine/types';
import { vendorEvent } from '../../engine/vendorlog';
import { VENDORS, type VendorId } from '../../engine/vendors';
import { expressServiceCode } from '../../engine/shells/vendorcli';
import { VendorLogo } from '../brand';
import { fmtSimClock } from '../format';
import { useStore } from '../store';

type Tab = 'dash' | 'sel' | 'sensors' | 'inv' | 'storage' | 'power' | 'console';

const SEV_ICON = { ok: '●', warning: '▲', critical: '✖', unknown: '?' };

const TAB_LABELS: Record<'generic' | VendorId, Record<Tab, string>> = {
  generic: { dash: 'Dashboard', sel: 'Event Log', sensors: 'Sensors', inv: 'Inventory', storage: 'Storage', power: 'Power & Control', console: 'Console' },
  dell: { dash: 'Dashboard', sel: 'Lifecycle Log', sensors: 'System', inv: 'Hardware Inventory', storage: 'Storage', power: 'Power Control', console: 'Virtual Console' },
  hpe: { dash: 'Overview', sel: 'Integrated Management Log', sensors: 'System Information', inv: 'Device Inventory', storage: 'Storage', power: 'Power & Thermal', console: 'Remote Console' },
  lenovo: { dash: 'Home', sel: 'Events', sensors: 'Utilization', inv: 'Inventory', storage: 'Storage', power: 'Power Actions', console: 'Remote Console' },
  supermicro: { dash: 'Dashboard', sel: 'Health Event Log', sensors: 'Sensor Readings', inv: 'Component Info', storage: 'Storage Monitoring', power: 'Power Control', console: 'Remote Control' },
};

/** How each vendor's web UI reaches the serial console from the jump host. */
const SOL_HOWTO: Record<VendorId, (h: string) => string[]> = {
  dell: (h) => [`ssh root@${h}-bmc`, 'console com2'],
  hpe: (h) => [`ssh Administrator@${h}-bmc`, 'vsp'],
  lenovo: (h) => [`ssh USERID@${h}-bmc`, 'console 1'],
  supermicro: (h) => [`ipmitool -I lanplus -H ${h}-bmc -U ADMIN -E sol activate`],
};

const selTime = (t: number) => (t < 0 ? `-${Math.round(-t / 3600)}h` : fmtSimClock(t));

export function BmcTool() {
  const devices = useStore((s) => s.world!.devices);
  const focus = useStore((s) => s.inst!.focusDeviceId);
  const servers = useMemo(() => Object.values(devices).filter((d) => d.role === 'server').sort((a, b) => a.hostname.localeCompare(b.hostname)), [devices]);
  const [target, setTarget] = useState<string>(focus && devices[focus]?.role === 'server' ? focus : servers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('dash');
  const dev = devices[target];
  const matches = query ? servers.filter((d) => d.hostname.includes(query.toLowerCase()) || d.bmc.ip.includes(query)) : [];
  const vend = dev ? MODELS[dev.model].vendor : undefined;
  return (
    <div className={`bmc ${vend ? `vendor vendor-${vend}` : ''}`} style={vend ? ({ ['--vbg' as string]: VENDORS[vend].bmcBg, ['--vac' as string]: VENDORS[vend].bmcAccent } as React.CSSProperties) : undefined}>
      <div className="row" style={{ marginBottom: 10, position: 'relative' }}>
        <span className="muted">https://</span>
        <input className="grow mono" placeholder="Type a hostname or BMC IP…" value={query || (dev ? `${dev.hostname}-bmc` : '')} onFocus={() => setQuery('')} onChange={(e) => setQuery(e.target.value)} />
        {query && matches.length > 0 && (
          <div className="card" style={{ position: 'absolute', top: 36, left: 50, right: 0, zIndex: 4, maxHeight: 240, overflow: 'auto', padding: 4 }}>
            {matches.slice(0, 30).map((d) => (
              <div
                key={d.id}
                className="tk"
                style={{ padding: '4px 8px', marginBottom: 2 }}
                onClick={() => {
                  setTarget(d.id);
                  setQuery('');
                }}
              >
                <span className="mono">{d.hostname}-bmc</span> <span className="dim">{d.bmc.ip}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {dev ? <BmcConsole dev={dev} tab={tab} setTab={setTab} /> : <p className="muted">No servers.</p>}
    </div>
  );
}

function BmcConsole({ dev, tab, setTab }: { dev: Device; tab: Tab; setTab: (t: Tab) => void }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const reachable = bmcReachable(w, dev);
  useEffect(() => {
    if (!reachable) return;
    const f = (n: string) => dispatch({ type: 'setFlag', name: n });
    const topics: Record<Tab, string[]> = {
      dash: ['health'],
      sel: ['sel'],
      sensors: ['health', 'power', 'fans', 'bios', 'cpu'],
      inv: ['inventory', 'memory', 'cpu', 'gpu', 'network'],
      storage: ['storage', 'raid'],
      power: ['power'],
      console: [],
    };
    for (const t of topics[tab]) f(`viewed:${dev.id}:${t}`);
    if (tab === 'sel') f(`sel_viewed:${dev.id}`);
  }, [tab, dev.id, reachable, dispatch]);

  if (!reachable)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 40 }}>🚫</div>
        <h3>This site can't be reached</h3>
        <p className="muted">
          {dev.hostname}-bmc ({dev.bmc.ip}) took too long to respond.
          <br />
          ERR_CONNECTION_TIMED_OUT
        </p>
        <p className="dim" style={{ fontSize: 12 }}>
          {!hasAC(w, dev) ? 'Hint: does the server have AC power at all?' : 'Hint: is the BMC itself hung, or is its network link down?'}
        </p>
      </div>
    );
  const h = healthRollup(w, dev);
  const m = MODELS[dev.model];
  const v = m.vendor;
  const labels = TAB_LABELS[v ?? 'generic'];
  return (
    <>
      {v && (
        <div className="vbar">
          <VendorLogo vendor={v} width={86} height={26} mono={v === 'hpe' ? undefined : '#ffffff'} />
          <div className="vbar-title">
            <b>{VENDORS[v].bmc.short}</b>
            <span>{VENDORS[v].bmc.product}</span>
          </div>
          <div className="spacer" />
          <span className={`vbar-health sev-${h.overall}`}>
            {SEV_ICON[h.overall]} {h.overall === 'ok' ? 'Healthy' : h.overall === 'warning' ? 'Warning' : 'Critical'}
          </span>
        </div>
      )}
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <b style={{ fontSize: 15 }}>{dev.hostname}</b>
        <span className="tag">{m.name}</span>
        <span className="tag mono">
          {v ? VENDORS[v].serialLabel : 'S/N'} {dev.serial}
        </span>
        <span className={`sev-${h.overall}`}>
          {SEV_ICON[h.overall]} {h.overall.toUpperCase()}
        </span>
        <div className="spacer" />
        <span className="dim">{dev.bmc.fw}</span>
      </div>
      <div className="bmc-tabs">
        {(
          [
            ['dash', labels.dash],
            ['sel', labels.sel],
            ['sensors', labels.sensors],
            ['inv', labels.inv],
            ['storage', labels.storage],
            ['power', labels.power],
            ['console', labels.console],
          ] as Array<[Tab, string]>
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'dash' && (
        <>
          <div className="health-grid">
            {(['processors', 'memory', 'storage', 'power', 'fans', 'temperature', 'network', 'gpu', 'battery'] as const).map((k) => (
              <div key={k} className="htile">
                <b>{k}</b>
                <span className={`sev-${h[k]}`} style={{ fontWeight: 700 }}>
                  {SEV_ICON[h[k]]} {h[k].toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          <div className="kv" style={{ marginTop: 12 }}>
            <span>Power</span>
            <span>{dev.power === 'on' || dev.power === 'posting' ? `On${dev.power === 'posting' ? ' (POST)' : ''}` : 'Off (standby)'}</span>
            <span>OS</span>
            <span>{dev.power === 'on' ? (dev.os === 'up' ? 'Running' : dev.os) : '—'}</span>
            <span>Asset tag</span>
            <span className="mono">{dev.assetTag}</span>
            {v && (
              <>
                <span>{VENDORS[v].serialLabel}</span>
                <span className="mono">{dev.serial}</span>
                {v === 'dell' && (
                  <>
                    <span>Express Service Code</span>
                    <span className="mono">{expressServiceCode(dev.serial)}</span>
                  </>
                )}
                <span>{VENDORS[v].bmc.short} firmware</span>
                <span className="mono">{dev.bmc.fw}</span>
                <span>{VENDORS[v].bmc.short} MAC / IP</span>
                <span className="mono">
                  {dev.bmc.mac} / {dev.bmc.ip}
                </span>
              </>
            )}
            <span>PSU redundancy</span>
            <span className={goodPsuCount(w, dev) >= 2 ? 'sev-ok' : 'sev-critical'}>{goodPsuCount(w, dev) >= 2 ? 'Fully redundant' : 'LOST'}</span>
            <span>Boot order</span>
            <span>{dev.bootOrder.join(' › ')}</span>
            <span>Locate LED</span>
            <span>{dev.locateLed ? '🔵 Blinking' : 'Off'}</span>
          </div>
          <p className="dim" style={{ fontSize: 12 }}>
            The front-panel health LED stays amber until critical SEL events are cleared, even after the part is replaced.
          </p>
        </>
      )}
      {tab === 'sel' && v && <VendorLog dev={dev} v={v} />}
      {tab === 'sel' && !v && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="muted">{dev.sel.length} entries</span>
            <div className="spacer" />
            <button className="btn sm" onClick={() => dispatch({ type: 'setFlag', name: `sel_viewed:${dev.id}` })}>
              💾 Save log
            </button>
            <button className="btn sm danger" onClick={() => dispatch({ type: 'selClear', deviceId: dev.id })}>
              Clear log
            </button>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Sev</th>
                <th>Sensor</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {[...dev.sel].reverse().map((e) => (
                <tr key={e.id}>
                  <td className="dim">{e.id}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {e.t < 0 ? `-${Math.round(-e.t / 3600)}h` : fmtSimClock(e.t)}
                  </td>
                  <td className={e.severity === 'critical' ? 'sev-critical' : e.severity === 'warning' ? 'sev-warning' : 'dim'}>{e.severity}</td>
                  <td>{e.sensor}</td>
                  <td>
                    {e.event} <span className="dim">({e.dir})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {tab === 'sensors' && (
        <table className="t">
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Reading</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sensors(w, dev).map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td className="mono">
                  {s.value} {s.unit === 'discrete' ? '' : s.unit.replace('degrees C', '°C')}
                </td>
                <td className={s.status === 'cr' ? 'sev-critical' : s.status === 'nc' ? 'sev-warning' : s.status === 'ns' ? 'dim' : 'sev-ok'}>{{ ok: 'OK', nc: 'Warning', cr: 'Critical', ns: 'N/A' }[s.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'inv' && <Inventory dev={dev} />}
      {tab === 'storage' && (
        <table className="t">
          <thead>
            <tr>
              <th>Bay</th>
              <th>Part</th>
              <th>Serial</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {m.slots
              .filter((s) => s.kind === 'hdd' || s.kind === 'nvme' || s.kind === 'm2')
              .map((s) => {
                const c = dev.slots[s.id];
                const loc = dev.quirks.includes(`locate:${s.id}`);
                return (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td className="mono">{c?.partNumber ?? 'Empty'}</td>
                    <td className="mono">{c?.serial ?? '—'}</td>
                    <td className={!c ? 'dim' : c.health === 'ok' ? 'sev-ok' : c.health === 'degraded' ? 'sev-warning' : 'sev-critical'}>{!c ? 'Absent' : c.health === 'ok' ? (c.seated ? 'Online' : 'Not seated') : c.health === 'degraded' ? 'Predictive failure' : 'Failed'}</td>
                    <td>
                      {s.kind !== 'm2' && c && (
                        <button className={`btn sm ${loc ? 'on' : ''}`} onClick={() => dispatch({ type: 'driveLocate', deviceId: dev.id, slot: s.id, on: !loc })}>
                          {loc ? 'Stop blink' : 'Blink'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
      {tab === 'power' && (
        <div className="col">
          <div className="kv">
            <span>Chassis power</span>
            <b>{dev.power === 'on' || dev.power === 'posting' ? 'ON' : 'OFF'}</b>
            <span>Host drained</span>
            <span className={dev.drained ? 'pill-ok' : 'pill-warn'}>{dev.drained ? 'Yes, released to DCO' : 'NO, in production'}</span>
            <span>PSU1 / PSU2</span>
            <span>
              {['PSU1', 'PSU2'].map((p) => (
                <span key={p} style={{ marginRight: 10 }}>
                  <span className={`led ${slotLed(w, dev, p).startsWith('green') ? 'green' : slotLed(w, dev, p).startsWith('amber') ? 'amber' : ''} ${slotLed(w, dev, p).endsWith('blink') ? 'blink' : ''}`} />
                  {p}
                </span>
              ))}
            </span>
          </div>
          <div className="row wrap">
            <button className="btn" onClick={() => dispatch({ type: 'bmcPower', deviceId: dev.id, op: 'on' })}>
              Power on
            </button>
            <button className="btn" onClick={() => dispatch({ type: 'bmcPower', deviceId: dev.id, op: 'soft' })}>
              Graceful shutdown
            </button>
            <button className="btn danger" onClick={() => dispatch({ type: 'bmcPower', deviceId: dev.id, op: 'off' })}>
              Force off
            </button>
            <button className="btn warn" onClick={() => dispatch({ type: 'bmcPower', deviceId: dev.id, op: 'cycle' })}>
              Power cycle
            </button>
          </div>
          <div className="row wrap">
            <button className={`btn ${dev.locateLed ? 'on' : ''}`} onClick={() => dispatch({ type: 'locate', deviceId: dev.id, on: !dev.locateLed })}>
              🔵 Locate LED {dev.locateLed ? 'off' : 'on'}
            </button>
            <button className="btn" onClick={() => dispatch({ type: 'bmcReset', deviceId: dev.id })}>
              Reset BMC (cold)
            </button>
          </div>
          <p className="dim" style={{ fontSize: 12 }}>
            Power actions affect the HOST. Check the ticket's host state (drained?) before you click.
          </p>
        </div>
      )}
      {tab === 'console' && (
        <div className="col">
          <p>The HTML5 virtual console is disabled on this fleet. Use Serial-over-LAN from the jump host:</p>
          <code className="card mono" style={{ display: 'block', background: '#05080c', whiteSpace: 'pre' }}>
            {v ? SOL_HOWTO[v](dev.hostname).join('\n') : `ipmitool -I lanplus -H ${dev.hostname}-bmc -U admin -E sol activate`}
          </code>
          <p className="muted" style={{ fontSize: 12 }}>
            Exit SOL with <b>~~.</b> (two tildes). A single "~." is caught by your ssh session to the jump host and disconnects you.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            NIC links: eth0 {linkState(w, dev.id, 'nic0p0').up ? 'UP' : 'DOWN'} · eth1 {linkState(w, dev.id, 'nic0p1').up ? 'UP' : 'DOWN'}
          </p>
        </div>
      )}
    </>
  );
}

function Inventory({ dev }: { dev: Device }) {
  const dispatch = useStore((s) => s.dispatch);
  const flagged = useStore((s) => s.world!.trainee.flagged);
  const m = MODELS[dev.model];
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Slot</th>
          <th>Type</th>
          <th>Part number</th>
          <th>Serial</th>
          <th>Health</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {m.slots.map((s) => {
          const c = dev.slots[s.id];
          const fk = `${dev.id}:${s.id}`;
          const isF = flagged.includes(fk);
          return (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>{KIND_LABEL[s.kind]}</td>
              <td className="mono" title={c ? partSpec(c.partNumber).desc : ''}>
                {c?.partNumber ?? '—'}
              </td>
              <td className="mono">{c?.serial ?? '—'}</td>
              <td className={!c ? 'dim' : c.health === 'ok' ? 'sev-ok' : c.health === 'degraded' ? 'sev-warning' : 'sev-critical'}>{!c ? 'Absent' : c.health === 'ok' ? 'OK' : c.health === 'degraded' ? 'Warning' : 'Critical'}</td>
              <td>
                {c && (
                  <button className={`btn sm ${isF ? 'on' : ''}`} onClick={() => dispatch(isF ? { type: 'unflag', deviceId: dev.id, slot: s.id } : { type: 'flagFaulty', deviceId: dev.id, slot: s.id })}>
                    {isF ? '🚩 Flagged' : 'Flag faulty'}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The management log in the vendor's own layout: Dell Lifecycle Log, HPE IML, Lenovo events, Supermicro health log. */
function VendorLog({ dev, v }: { dev: Device; v: VendorId }) {
  const dispatch = useStore((s) => s.dispatch);
  const rows = [...dev.sel].reverse().map((e) => ({ e, ev: vendorEvent(dev, e) }));
  const sev = (s: string) => (s === 'critical' ? 'sev-critical' : s === 'warning' ? 'sev-warning' : 'sev-ok');
  const word: Record<VendorId, Record<string, string>> = {
    dell: { critical: 'Critical', warning: 'Warning', info: 'Ok' },
    hpe: { critical: 'Critical', warning: 'Caution', info: 'Informational' },
    lenovo: { critical: 'Error', warning: 'Warning', info: 'Informational' },
    supermicro: { critical: 'Critical', warning: 'Warning', info: 'Info' },
  };
  const head: Record<VendorId, string[]> = {
    dell: ['Severity', 'Date and Time', 'Message ID', 'Description'],
    hpe: ['Severity', 'Class', 'Last Update', 'Count', 'Description'],
    lenovo: ['Type', 'Source', 'Event ID', 'Message', 'Date'],
    supermicro: ['ID', 'Time', 'Sensor', 'Description'],
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted">
          {VENDORS[v].bmc.logName}: {dev.sel.length} entries
        </span>
        <div className="spacer" />
        <button className="btn sm" onClick={() => dispatch({ type: 'setFlag', name: `sel_viewed:${dev.id}` })}>
          💾 Export
        </button>
        <button className="btn sm danger" onClick={() => dispatch({ type: 'selClear', deviceId: dev.id })}>
          {v === 'hpe' ? 'Clear IML' : 'Clear Log'}
        </button>
      </div>
      <table className="t vlog">
        <thead>
          <tr>
            {head[v].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, ev }) => (
            <tr key={e.id}>
              {v === 'dell' && (
                <>
                  <td className={sev(e.severity)}>{word.dell[e.severity]}</td>
                  <td className="mono nowrap">{selTime(e.t)}</td>
                  <td className="mono">{ev.code}</td>
                  <td>{ev.text}</td>
                </>
              )}
              {v === 'hpe' && (
                <>
                  <td className={sev(e.severity)}>{word.hpe[e.severity]}</td>
                  <td>{ev.category}</td>
                  <td className="mono nowrap">{selTime(e.t)}</td>
                  <td className="mono">1</td>
                  <td>{ev.text}</td>
                </>
              )}
              {v === 'lenovo' && (
                <>
                  <td className={sev(e.severity)}>{word.lenovo[e.severity]}</td>
                  <td>{ev.category}</td>
                  <td className="mono">{ev.code}</td>
                  <td>{ev.text}</td>
                  <td className="mono nowrap">{selTime(e.t)}</td>
                </>
              )}
              {v === 'supermicro' && (
                <>
                  <td className="dim">{e.id}</td>
                  <td className="mono nowrap">{selTime(e.t)}</td>
                  <td>{ev.category}</td>
                  <td className={sev(e.severity)}>{ev.text}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
