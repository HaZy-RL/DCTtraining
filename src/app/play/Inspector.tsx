// Contextual action card for whatever is selected in the 3D rack scene.
import { useState } from 'react';
import { KIND_LABEL, MODELS, partSpec } from '../../engine/catalog';
import { cableAt, hasAC, healthLed, linkState, locationOf, parseOutlet, pduLoadW, psuInput, slotLed } from '../../engine/projectors';
import type { Cable, CableType, Component, Device, PortRef, World } from '../../engine/types';
import { useStore } from '../store';

function portName(p: string) {
  return p === 'nic0p0' ? 'P0' : p === 'nic0p1' ? 'P1' : p.toUpperCase();
}
function endLabel(w: World, p: PortRef) {
  const d = w.devices[p.deviceId];
  return `${d.rackId}-U${String(d.u).padStart(2, '0')}-${portName(p.port)}`;
}
function hostPort(w: World, p: PortRef | null) {
  if (!p) return '(unplugged)';
  return `${w.devices[p.deviceId]?.hostname ?? '?'} : ${p.port}`;
}

function LocationBar() {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const loc = w.trainee.location;
  return (
    <div className="row wrap" style={{ fontSize: 12, marginBottom: 6 }}>
      <span className="muted">📍 {loc === 'noc' ? 'DCO desk' : loc === 'cage' ? 'Parts cage' : loc ? w.racks[loc]?.location ?? loc : '—'}</span>
      <span className={w.trainee.esdStrap ? 'pill-ok' : 'dim'}>{w.trainee.esdStrap ? '⚡ ESD on' : '⚡ no ESD'}</span>
      <div className="spacer" />
      <button className={`btn sm ${w.trainee.esdStrap ? 'on' : ''}`} onClick={() => dispatch({ type: 'esd', on: !w.trainee.esdStrap })}>
        {w.trainee.esdStrap ? 'Remove strap' : 'ESD strap on'}
      </button>
    </div>
  );
}

function WalkButton({ rackId }: { rackId: string }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  if (w.trainee.location === rackId) return null;
  return (
    <button className="btn primary sm" onClick={() => dispatch({ type: 'walk', to: rackId })}>
      🚶 Walk to {w.racks[rackId]?.location ?? rackId}
    </button>
  );
}

export function Inspector({ buildMode }: { buildMode?: boolean }) {
  const w = useStore((s) => s.world);
  const sel = useStore((s) => s.sel);
  const pendingPort = useStore((s) => s.pendingPort);
  const cableDraft = useStore((s) => s.cableDraft);
  if (!w) return null;
  let body: React.ReactNode = null;
  if (cableDraft) body = <CableDraftCard />;
  else if (pendingPort)
    body = (
      <div>
        <h4>🔌 Cabling</h4>
        <p style={{ fontSize: 13 }}>
          Selected <b className="mono">{hostPort(w, pendingPort)}</b>. Now click the far-end port (switch ports are on the ToR/OOB switch at the top rear of the rack).
        </p>
        <button className="btn sm" onClick={() => useStore.getState().setPendingPort(null)}>
          Cancel
        </button>
      </div>
    );
  else if (sel.cableId && w.cables[sel.cableId]) body = <CableCard cable={w.cables[sel.cableId]} />;
  else if (buildMode && sel.u && sel.rackId) body = <UCard rackId={sel.rackId} u={sel.u} />;
  else if (sel.deviceId && w.devices[sel.deviceId]) {
    const dev = w.devices[sel.deviceId];
    body = sel.slot ? <SlotCard dev={dev} slot={sel.slot} /> : <DeviceCard dev={dev} buildMode={buildMode} />;
  } else if (sel.rackId && w.racks[sel.rackId]) body = <RackCard rackId={sel.rackId} buildMode={buildMode} />;
  if (!body) return null;
  return (
    <div className="overlay inspector" onPointerDown={(e) => e.stopPropagation()}>
      <LocationBar />
      {body}
    </div>
  );
}

// ---------- rack ----------

function RackCard({ rackId, buildMode }: { rackId: string; buildMode?: boolean }) {
  const w = useStore((s) => s.world!);
  const rack = w.racks[rackId];
  const devs = Object.values(w.devices).filter((d) => d.rackId === rackId);
  return (
    <div>
      <h4>🗄️ Rack {rack.location}</h4>
      <div className="kv">
        <span>Devices</span>
        <span>{devs.length}</span>
        {rack.pdus.map((p) => (
          <span key={p.id} style={{ display: 'contents' }}>
            <span>PDU-{p.side}</span>
            <span className={p.breakerTripped ? 'pill-bad' : ''}>
              {p.breakerTripped ? 'BREAKER TRIPPED' : `${(pduLoadW(w, p.id) / 1000).toFixed(2)} kW`}
            </span>
          </span>
        ))}
      </div>
      <div className="actions">
        <WalkButton rackId={rackId} />
      </div>
      <p className="dim" style={{ fontSize: 12, margin: '6px 0 0' }}>
        {buildMode ? 'Click a U position on the front of the rack to install rails or mount a device.' : 'Click a server to inspect it. Use Front/Rear (top right) to switch aisles.'}
      </p>
      {buildMode && <StagedList />}
    </div>
  );
}

function StagedList() {
  const w = useStore((s) => s.world!);
  const staged = Object.values(w.devices).filter((d) => !d.rackId && d.role === 'server');
  if (!staged.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <b style={{ fontSize: 12 }}>Staged on the lift cart</b>
      {staged.map((d) => (
        <div key={d.id} className="mono" style={{ fontSize: 12 }}>
          {d.hostname} · {MODELS[d.model].heightU}U · {d.weightKg} kg
        </div>
      ))}
    </div>
  );
}

// ---------- U slot (build mode) ----------

function UCard({ rackId, u }: { rackId: string; u: number }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const rack = w.racks[rackId];
  const rails = rack.rails[u];
  const [height, setHeight] = useState(2);
  const [hole, setHole] = useState<number | null>(null);
  const staged = Object.values(w.devices).filter((d) => !d.rackId && d.role === 'server');
  const occupied = Object.values(w.devices).find((d) => d.rackId === rackId && d.u !== null && u >= d.u && u < d.u + d.heightU);
  return (
    <div>
      <h4>
        U{String(u).padStart(2, '0')} in {rack.location}
      </h4>
      <WalkButton rackId={rackId} />
      {occupied && <p className="muted">Occupied by {occupied.hostname}.</p>}
      {!occupied && !rails && (
        <div className="col" style={{ marginTop: 6 }}>
          <div className="row">
            Rail kit for
            <select value={height} onChange={(e) => setHeight(Number(e.target.value))}>
              <option value={1}>1U device</option>
              <option value={2}>2U device</option>
            </select>
          </div>
          <div style={{ fontSize: 12.5 }}>
            Which hole does the rail's <b>bottom</b> hook go into? (Rack posts have 3 holes per U. The U boundary is the line printed on the post.)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 2, width: 220, background: '#1b2028', padding: 6, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
            {[
              { off: -1, label: `U${u - 1} top hole` },
              { off: 0, label: `U${u} bottom hole`, boundary: true },
              { off: 1, label: `U${u} middle hole` },
              { off: 2, label: `U${u} top hole` },
            ].map((h) => (
              <div key={h.off}>
                {h.boundary && <div style={{ borderTop: '2px solid #cbd5e0', margin: '2px 0', fontSize: 9, color: '#cbd5e0' }}>── U{u - 1} / U{u} boundary ──</div>}
                <button className={`btn sm ${hole === h.off ? 'on primary' : ''}`} style={{ width: '100%', textAlign: 'left' }} onClick={() => setHole(h.off)}>
                  ◻ {h.label}
                </button>
              </div>
            ))}
          </div>
          <button className="btn primary" disabled={hole === null} onClick={() => dispatch({ type: 'installRails', rackId, u, heightU: height, holeOffset: hole ?? 0 })}>
            Install rails at U{u}
          </button>
        </div>
      )}
      {!occupied && rails && (
        <div className="col" style={{ marginTop: 6 }}>
          <div className={rails.holeOffset ? 'pill-warn' : 'pill-ok'} style={{ fontSize: 13 }}>
            Rails: {rails.heightU}U {rails.holeOffset ? `⚠ off by ${rails.holeOffset} hole(s)` : '✓ aligned on the U boundary'}
          </div>
          <div className="row wrap">
            <button className={`btn sm ${w.trainee.liftAssist ? 'on primary' : ''}`} onClick={() => dispatch({ type: 'liftAssist', on: !w.trainee.liftAssist })}>
              {w.trainee.liftAssist ? '✓ Lift assist ready' : 'Get lift assist / 2nd person'}
            </button>
            <button className="btn sm danger" onClick={() => dispatch({ type: 'removeRails', rackId, u })}>
              Remove rails
            </button>
          </div>
          {staged.filter((d) => d.heightU === rails.heightU).map((d) => (
            <button key={d.id} className="btn" onClick={() => dispatch({ type: 'mountDevice', deviceId: d.id, rackId, u })}>
              Lift & mount {d.hostname} ({d.weightKg} kg)
            </button>
          ))}
          {!staged.length && <span className="dim">No staged devices left.</span>}
        </div>
      )}
    </div>
  );
}

// ---------- device ----------

function freeOutlets(w: World, rackId: string, side: 'A' | 'B'): string[] {
  const used = new Set(Object.values(w.devices).flatMap((d) => Object.values(d.powerCords).filter(Boolean) as string[]));
  return Array.from({ length: 24 }, (_, i) => `${rackId}-PDU-${side}:${i + 1}`).filter((o) => !used.has(o));
}

function CordRow({ dev, psu }: { dev: Device; psu: string }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const cord = dev.powerCords[psu];
  const [choice, setChoice] = useState('');
  if (!dev.rackId) return null;
  const inp = dev.slots[psu] ? psuInput(w, dev, psu) : null;
  const outlets = [...freeOutlets(w, dev.rackId, 'A').slice(0, 6), ...freeOutlets(w, dev.rackId, 'B').slice(0, 6)];
  return (
    <div className="row wrap" style={{ fontSize: 12.5, margin: '3px 0' }}>
      <b style={{ width: 40 }}>{psu}</b>
      {cord ? (
        <>
          <span className="mono">
            → PDU-{parseOutlet(cord)?.side}:{parseOutlet(cord)?.n}
          </span>
          {inp && !inp.ok && <span className="pill-warn">({inp.reason})</span>}
          <button className="btn sm" onClick={() => dispatch({ type: 'reseatCord', deviceId: dev.id, psu })}>
            Reseat
          </button>
          <button className="btn sm" onClick={() => dispatch({ type: 'cord', deviceId: dev.id, psu, outlet: null })}>
            Unplug
          </button>
        </>
      ) : (
        <>
          <span className="dim">no cord</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">choose outlet…</option>
            {outlets.map((o) => (
              <option key={o} value={o}>
                PDU-{parseOutlet(o)?.side} outlet {parseOutlet(o)?.n}
              </option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!choice} onClick={() => dispatch({ type: 'cord', deviceId: dev.id, psu, outlet: choice })}>
            Plug in
          </button>
        </>
      )}
    </div>
  );
}

function DeviceCard({ dev, buildMode }: { dev: Device; buildMode?: boolean }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const m = MODELS[dev.model];
  const here = !dev.rackId || w.trainee.location === dev.rackId;
  if (dev.role !== 'server') {
    return (
      <div>
        <h4>🔀 {dev.hostname}</h4>
        <div className="kv">
          <span>Model</span>
          <span>{m.name}</span>
          <span>Location</span>
          <span className="mono">{locationOf(w, dev)}</span>
          <span>Ports up</span>
          <span>{m.ports.filter((p) => linkState(w, dev.id, p).up).length}</span>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          Read-only access: <code>ssh {dev.hostname}</code> from the jump host. In the rear view, click a port to cable it.
        </p>
        {dev.rackId && <WalkButton rackId={dev.rackId} />}
      </div>
    );
  }
  const led = healthLed(w, dev);
  return (
    <div>
      <div className="row">
        <h4 className="grow">🖥️ {dev.hostname}</h4>
        <span className={`led ${led.startsWith('amber') ? 'amber' : led === 'green' ? 'green' : ''} ${led.endsWith('blink') ? 'blink' : ''}`} />
        {dev.locateLed && hasAC(w, dev) && <span className="led blue blink" />}
      </div>
      <div className="kv">
        <span>Model</span>
        <span>{m.name}</span>
        <span>Location</span>
        <span className="mono">{locationOf(w, dev)}</span>
        <span>Serial / Asset</span>
        <span className="mono">{w.flags[`scanned:${dev.id}`] ? `${dev.serial} / ${dev.assetTag}` : '(scan the tag to read)'}</span>
        <span>Power</span>
        <span>{dev.power === 'on' ? (dev.os === 'up' ? 'On, OS running' : `On (${dev.os})`) : dev.power === 'posting' ? 'POST…' : dev.power === 'standby' ? 'Off (standby power)' : 'No AC'}</span>
        <span>Position</span>
        <span>{dev.rackId ? (dev.servicePosition ? 'Extended (service position)' : 'In rack') : 'On the bench/cart'}</span>
        <span>Cover</span>
        <span>
          Lid {dev.layers.lid ? 'on' : 'OFF'} · shroud {dev.layers.shroud ? 'in' : 'OUT'}
        </span>
      </div>
      {!here && dev.rackId && <WalkButton rackId={dev.rackId} />}
      {here && (
        <>
          <div className="actions">
            <button className="btn sm" onClick={() => dispatch({ type: 'scanAsset', deviceId: dev.id })}>
              📷 Scan asset tag
            </button>
            <button className="btn sm" onClick={() => dispatch({ type: 'powerButton', deviceId: dev.id })}>
              ⏻ Press power
            </button>
            <button className="btn sm danger" onClick={() => dispatch({ type: 'powerButton', deviceId: dev.id, hold: true })}>
              ⏻ Hold 5 s (force off)
            </button>
            {dev.rackId && (
              <button className="btn sm" onClick={() => dispatch({ type: 'servicePosition', deviceId: dev.id, out: !dev.servicePosition })}>
                {dev.servicePosition ? '⇥ Slide back into rack' : '⇤ Slide out (service position)'}
              </button>
            )}
          </div>
          {(dev.servicePosition || !dev.rackId) && (
            <div className="actions">
              <button className="btn sm" onClick={() => dispatch({ type: 'layer', deviceId: dev.id, layer: 'lid', install: !dev.layers.lid })}>
                {dev.layers.lid ? 'Remove lid' : 'Install lid'}
              </button>
              {!dev.layers.lid && (
                <>
                  <button className="btn sm" onClick={() => dispatch({ type: 'layer', deviceId: dev.id, layer: 'shroud', install: !dev.layers.shroud })}>
                    {dev.layers.shroud ? 'Remove air shroud' : 'Install air shroud'}
                  </button>
                  <button className="btn sm" onClick={() => dispatch({ type: 'layer', deviceId: dev.id, layer: 'riser1', install: !dev.layers.riser1 })}>
                    {dev.layers.riser1 ? 'Remove Riser 1' : 'Install Riser 1'}
                  </button>
                  <button className="btn sm" onClick={() => dispatch({ type: 'layer', deviceId: dev.id, layer: 'riser2', install: !dev.layers.riser2 })}>
                    {dev.layers.riser2 ? 'Remove Riser 2' : 'Install Riser 2'}
                  </button>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <b style={{ fontSize: 12 }}>Power cords (rear)</b>
            {['PSU1', 'PSU2'].map((p) => (
              <CordRow key={p} dev={dev} psu={p} />
            ))}
          </div>
          {(buildMode || dev.drained) && dev.rackId && (
            <div className="actions">
              <button className="btn sm danger" onClick={() => dispatch({ type: 'unmountDevice', deviceId: dev.id })}>
                De-rack chassis
              </button>
              <button className={`btn sm ${w.trainee.liftAssist ? 'on' : ''}`} onClick={() => dispatch({ type: 'liftAssist', on: !w.trainee.liftAssist })}>
                {w.trainee.liftAssist ? '✓ Lift assist' : 'Lift assist'}
              </button>
            </div>
          )}
        </>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <select
          style={{ fontSize: 12 }}
          value=""
          onChange={(e) => {
            const s = e.target.value;
            if (!s) return;
            const def = m.slots.find((x) => x.id === s);
            if (def?.access === 'rear') setView('rear');
            if (def?.access === 'front') setView('front');
            select({ deviceId: dev.id, slot: s, rackId: dev.rackId ?? undefined });
          }}
        >
          <option value="">Jump to a part…</option>
          {m.slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({KIND_LABEL[s.kind]})
            </option>
          ))}
        </select>
        <span className="dim" style={{ fontSize: 11 }}>
          …or click it in 3D
        </span>
      </div>
    </div>
  );
}

// ---------- slot ----------

const HEATSINK_ORDER_HINT = 'Click the screws in order, then confirm.';

function HeatsinkWidget({ dev, cpu }: { dev: Device; cpu: string }) {
  const dispatch = useStore((s) => s.dispatch);
  const installed = dev.heatsinks[cpu];
  const [order, setOrder] = useState<number[]>([]);
  return (
    <div>
      <h4>🧊 Heatsink on {cpu}</h4>
      <p style={{ fontSize: 12.5, margin: '4px 0' }}>
        {installed ? 'Loosen the 4 captive Torx screws in sequence.' : 'Seat the heatsink and tighten the screws in sequence.'} {HEATSINK_ORDER_HINT}
      </p>
      <div className="row">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} className={`btn ${order.includes(n) ? 'on' : ''}`} disabled={order.includes(n)} onClick={() => setOrder([...order, n])}>
            {n}
          </button>
        ))}
        <span className="mono dim">{order.join(' → ')}</span>
      </div>
      <div className="actions">
        <button
          className="btn primary sm"
          disabled={order.length < 4}
          onClick={() => {
            dispatch({ type: 'heatsink', deviceId: dev.id, cpu, install: !installed, order });
            setOrder([]);
          }}
        >
          {installed ? 'Loosen & lift heatsink' : 'Seat & torque heatsink'}
        </button>
        <button className="btn sm" onClick={() => setOrder([])}>
          Reset
        </button>
      </div>
      {!installed && <p className="dim" style={{ fontSize: 12 }}>Tip: clean the old paste with IPA and apply fresh thermal paste before seating.</p>}
    </div>
  );
}

function SlotCard({ dev, slot }: { dev: Device; slot: string }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const select = useStore((s) => s.select);
  const [aligned, setAligned] = useState(false);
  const back = (
    <button className="btn ghost sm" onClick={() => select({ deviceId: dev.id, rackId: dev.rackId ?? undefined })}>
      ← {dev.hostname}
    </button>
  );
  if (slot.startsWith('heatsink:'))
    return (
      <div>
        {back}
        <HeatsinkWidget dev={dev} cpu={slot.split(':')[1]} />
      </div>
    );
  if (slot.startsWith('layer:')) {
    const layer = slot.split(':')[1] as 'lid' | 'shroud' | 'riser1' | 'riser2';
    const names = { lid: 'Top cover (lid)', shroud: 'Air shroud', riser1: 'Riser 1 (GPU)', riser2: 'Riser 2' };
    return (
      <div>
        {back}
        <h4>{names[layer]}</h4>
        <div className="actions">
          <button className="btn primary sm" onClick={() => dispatch({ type: 'layer', deviceId: dev.id, layer, install: !dev.layers[layer] })}>
            {dev.layers[layer] ? `Remove ${names[layer].toLowerCase()}` : `Install ${names[layer].toLowerCase()}`}
          </button>
        </div>
      </div>
    );
  }
  const def = MODELS[dev.model].slots.find((s) => s.id === slot);
  if (!def) return <div>{back}</div>;
  const c = dev.slots[slot];
  const flagged = w.trainee.flagged.includes(`${dev.id}:${slot}`);
  const latchable = def.kind === 'dimm' || def.kind === 'hdd' || def.kind === 'nvme';
  const latchOpen = dev.latches[slot] === 'open';
  const isDrive = def.kind === 'hdd' || def.kind === 'nvme';
  const led = slotLed(w, dev, slot);
  const candidates: Array<{ label: string; c: Component; src: { spareIndex: number } | { trayUid: string } }> = [
    ...w.spares.map((s, i) => ({ s, i })).filter(({ s }) => s.location === 'cart' && s.component.kind === def.kind).map(({ s, i }) => ({ label: `🛒 ${s.label}`, c: s.component, src: { spareIndex: i } })),
    ...w.trainee.tray.filter((p) => p.kind === def.kind).map((p) => ({ label: `✋ (removed) ${p.partNumber}`, c: p, src: { trayUid: p.uid } })),
  ];
  const needsAlign = def.kind === 'dimm' || def.kind === 'cpu';
  return (
    <div>
      {back}
      <div className="row">
        <h4 className="grow">
          {KIND_LABEL[def.kind]}: {def.label}
        </h4>
        {led !== 'off' && <span className={`led ${led.split('_')[0]} ${led.endsWith('blink') ? 'blink' : ''}`} />}
      </div>
      <div className="kv">
        <span>Access</span>
        <span>
          {def.access} · {def.hotSwap ? 'hot-swap' : 'COLD (power off + unplug)'}
        </span>
        {c ? (
          <>
            <span>Part number</span>
            <span className="mono">{c.partNumber}</span>
            <span>Description</span>
            <span>{partSpec(c.partNumber).desc}</span>
            <span>Serial</span>
            <span className="mono">{c.serial}</span>
            <span>Condition</span>
            <span className={c.health === 'ok' ? '' : 'pill-bad'}>{c.health === 'ok' ? (c.seated ? 'Looks fine, seated' : 'NOT fully seated') : c.health === 'degraded' ? 'Fault LED / warning' : 'Fault LED lit'}</span>
          </>
        ) : (
          <>
            <span>Status</span>
            <span className="dim">Empty slot</span>
          </>
        )}
      </div>
      <div className="actions">
        {c && (
          <button className={`btn sm ${flagged ? 'on' : ''}`} onClick={() => dispatch(flagged ? { type: 'unflag', deviceId: dev.id, slot } : { type: 'flagFaulty', deviceId: dev.id, slot })}>
            {flagged ? '🚩 Flagged as faulty' : '🚩 Flag as faulty'}
          </button>
        )}
        {latchable && (c || latchOpen) && (
          <button className="btn sm" onClick={() => dispatch({ type: 'latch', deviceId: dev.id, slot, state: latchOpen ? 'closed' : 'open' })}>
            {def.kind === 'dimm' ? (latchOpen ? 'Press down / close latches' : 'Open latches (both ends)') : latchOpen ? 'Push in & close handle' : 'Release carrier handle'}
          </button>
        )}
        {c && (
          <button className="btn sm warn" onClick={() => dispatch({ type: 'removePart', deviceId: dev.id, slot })}>
            {isDrive ? 'Pull drive out' : def.kind === 'psu' ? 'Press release tab & pull PSU' : `Remove ${KIND_LABEL[def.kind]}`}
          </button>
        )}
        {def.kind === 'psu' && dev.rackId && <CordRow dev={dev} psu={slot} />}
        {def.kind === 'cpu' && dev.heatsinks[slot] && (
          <button className="btn sm" onClick={() => select({ deviceId: dev.id, slot: `heatsink:${slot}`, rackId: dev.rackId ?? undefined })}>
            Heatsink…
          </button>
        )}
        {def.kind === 'cpu' && !dev.heatsinks[slot] && c && (
          <button className="btn sm" onClick={() => select({ deviceId: dev.id, slot: `heatsink:${slot}`, rackId: dev.rackId ?? undefined })}>
            Install heatsink…
          </button>
        )}
      </div>
      {!c && (
        <div style={{ marginTop: 8 }}>
          <b style={{ fontSize: 12 }}>Install a part</b>
          {needsAlign && (
            <label className="row" style={{ fontSize: 12.5, margin: '4px 0' }}>
              <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} />
              {def.kind === 'dimm' ? 'I lined up the DIMM notch with the key in the slot' : 'I matched the gold pin-1 triangle on the CPU with the socket mark'}
            </label>
          )}
          {candidates.length === 0 && <div className="dim" style={{ fontSize: 12 }}>No matching parts on your cart or in your tray.</div>}
          {candidates.map((x) => (
            <div key={x.c.uid} className="row" style={{ fontSize: 12, margin: '3px 0' }}>
              <span className="grow mono">
                {x.label} <span className="dim">S/N {x.c.serial}</span>
              </span>
              <button className="btn sm primary" onClick={() => dispatch({ type: 'insertPart', deviceId: dev.id, slot, source: x.src, aligned: needsAlign ? aligned : undefined })}>
                Install
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- cables ----------

function CableCard({ cable }: { cable: Cable }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const select = useStore((s) => s.select);
  const [moveTo, setMoveTo] = useState('');
  const ls = cable.a ? linkState(w, cable.a.deviceId, cable.a.port) : null;
  const autoA = cable.a && cable.b ? `${endLabel(w, cable.a)} > ${endLabel(w, cable.b)}` : '';
  const autoB = cable.a && cable.b ? `${endLabel(w, cable.b)} > ${endLabel(w, cable.a)}` : '';
  const sw = cable.b && w.devices[cable.b.deviceId];
  const freeSwPorts = sw ? MODELS[sw.model].ports.filter((p) => !cableAt(w, sw.id, p)) : [];
  return (
    <div>
      <button className="btn ghost sm" onClick={() => select({ rackId: useStore.getState().sel.rackId })}>
        ← back
      </button>
      <h4>
        🧵 {cable.type.toUpperCase()} {cable.lengthM} m
      </h4>
      <div className="kv">
        <span>End A</span>
        <span className="mono">{hostPort(w, cable.a)}</span>
        <span>End B</span>
        <span className="mono">{hostPort(w, cable.b)}</span>
        <span>Label A</span>
        <span className="mono">{cable.labelA ?? <span className="pill-warn">no label</span>}</span>
        <span>Label B</span>
        <span className="mono">{cable.labelB ?? <span className="pill-warn">no label</span>}</span>
        <span>Condition</span>
        <span className={cable.condition === 'ok' ? '' : 'pill-bad'}>{cable.condition === 'ok' ? 'Looks fine' : cable.condition === 'damaged' ? 'Kinked / crushed jacket' : cable.condition === 'dirty' ? 'Connector end-face looks dirty' : 'Bad termination'}</span>
        {ls && (
          <>
            <span>Link</span>
            <span className={ls.up ? 'pill-ok' : 'pill-bad'}>{ls.up ? `Up ${ls.speed}` : `Down: ${ls.reason}`}</span>
          </>
        )}
      </div>
      <div className="actions">
        {autoA && (
          <button className="btn sm" onClick={() => dispatch({ type: 'labelCable', cableId: cable.id, labelA: autoA, labelB: autoB })}>
            🏷️ Print & apply labels
          </button>
        )}
        {cable.condition !== 'ok' && cable.type !== 'fiber_mmf' && (
          <button className="btn sm warn" onClick={() => dispatch({ type: 'replaceCable', cableId: cable.id })}>
            Replace cable
          </button>
        )}
        {(cable.type === 'fiber_mmf' || cable.type === 'fiber_smf') && (
          <button className="btn sm" onClick={() => dispatch({ type: 'cleanCable', cableId: cable.id })}>
            Clean connectors
          </button>
        )}
        <button
          className="btn sm danger"
          onClick={() => {
            dispatch({ type: 'disconnectCable', cableId: cable.id });
            select({ rackId: useStore.getState().sel.rackId });
          }}
        >
          Remove cable
        </button>
      </div>
      {sw && (
        <div className="row" style={{ marginTop: 6 }}>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">Move switch end to…</option>
            {freeSwPorts.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className="btn sm" disabled={!moveTo} onClick={() => dispatch({ type: 'reconnectCable', cableId: cable.id, end: 'b', port: { deviceId: sw.id, port: moveTo } })}>
            Move
          </button>
        </div>
      )}
    </div>
  );
}

const CABLE_OPTS: Array<{ t: CableType; label: string }> = [
  { t: 'dac', label: '25G SFP28 DAC (passive copper)' },
  { t: 'cat6', label: 'Cat6 patch (RJ45)' },
  { t: 'aoc', label: 'AOC (active optical)' },
  { t: 'fiber_mmf', label: 'MMF OM4 LC-LC duplex' },
];

function CableDraftCard() {
  const w = useStore((s) => s.world!);
  const draft = useStore((s) => s.cableDraft)!;
  const dispatch = useStore((s) => s.dispatch);
  const isRj = [draft.a.port, draft.b.port].some((p) => p === 'bmc' || p.startsWith('mgmt'));
  const [type, setType] = useState<CableType>(isRj ? 'cat6' : 'dac');
  const [len, setLen] = useState(2);
  return (
    <div>
      <h4>🔌 New cable</h4>
      <div className="kv">
        <span>From</span>
        <span className="mono">{hostPort(w, draft.a)}</span>
        <span>To</span>
        <span className="mono">{hostPort(w, draft.b)}</span>
      </div>
      <div className="row wrap">
        <select value={type} onChange={(e) => setType(e.target.value as CableType)}>
          {CABLE_OPTS.map((o) => (
            <option key={o.t} value={o.t}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={len} onChange={(e) => setLen(Number(e.target.value))}>
          {[0.5, 1, 2, 3, 5, 10].map((l) => (
            <option key={l} value={l}>
              {l} m
            </option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button
          className="btn primary sm"
          onClick={() => {
            const r = dispatch({ type: 'connectCable', cableType: type, lengthM: len, a: draft.a, b: draft.b });
            if (r.ok) useStore.setState({ cableDraft: null });
          }}
        >
          Connect
        </button>
        <button className="btn sm" onClick={() => useStore.setState({ cableDraft: null })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
