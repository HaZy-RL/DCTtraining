import { partSpec } from '../../engine/catalog';
import type { BinKind } from '../../engine/types';
import { useStore } from '../store';

export function PartsTool() {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const loc = w.trainee.location;
  const locLabel = loc === 'noc' ? 'DCO desk' : loc === 'cage' ? 'Parts cage' : loc ? w.racks[loc]?.location ?? loc : '—';
  const cart = w.spares.filter((s) => s.location === 'cart');
  const cage = w.spares.filter((s) => s.location === 'cage');
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="row wrap">
          <b className="grow">📍 You are at: {locLabel}</b>
          {loc !== 'noc' && (
            <button className="btn sm" onClick={() => dispatch({ type: 'walk', to: 'noc' })}>
              Walk to DCO desk
            </button>
          )}
          {loc !== 'cage' && (
            <button className="btn sm" onClick={() => dispatch({ type: 'walk', to: 'cage' })}>
              Walk to parts cage
            </button>
          )}
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className={`btn ${w.trainee.esdStrap ? 'on primary' : ''}`} onClick={() => dispatch({ type: 'esd', on: !w.trainee.esdStrap })}>
            {w.trainee.esdStrap ? '✓ ESD strap ON' : 'Put on ESD wrist strap'}
          </button>
          <button className={`btn ${w.trainee.liftAssist ? 'on primary' : ''}`} onClick={() => dispatch({ type: 'liftAssist', on: !w.trainee.liftAssist })}>
            {w.trainee.liftAssist ? '✓ Lift assist / buddy ready' : 'Get lift assist / 2nd person'}
          </button>
        </div>
      </div>
      <div>
        <b>🛒 Parts cart ({cart.length})</b>
        <p className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          Check the PN on the label against the part you are replacing. Look-alikes are common.
        </p>
        {cart.length === 0 && <div className="dim">Cart is empty.</div>}
        {cart.map((s) => (
          <div key={s.component.uid} className="tk" style={{ cursor: 'default' }}>
            <div className="mono" style={{ fontSize: 12.5 }}>
              <b>PN {s.component.partNumber}</b>
            </div>
            <div style={{ fontSize: 12.5 }}>{partSpec(s.component.partNumber).desc}</div>
            <div className="dim mono" style={{ fontSize: 11 }}>
              S/N {s.component.serial}
            </div>
          </div>
        ))}
        {cage.length > 0 && (
          <div className="tk" style={{ borderColor: '#6b4416', cursor: 'default' }}>
            📦 {cage.length} part(s) waiting in the parts cage: {cage.map((s) => s.component.partNumber).join(', ')}. Walk to the cage to scan them out.
          </div>
        )}
      </div>
      <div>
        <b>✋ In your hands / tray ({w.trainee.tray.length})</b>
        {w.trainee.tray.length === 0 && <div className="dim">Nothing. Removed parts land here.</div>}
        {w.trainee.tray.map((p) => (
          <div key={p.uid} className="tk" style={{ cursor: 'default' }}>
            <div className="row wrap">
              <b className="mono" style={{ fontSize: 12.5 }}>
                {p.partNumber}
              </b>
              <span className="dim mono" style={{ fontSize: 11 }}>
                S/N {p.serial}
              </span>
              {p.fromSlot && <span className="tag">from {p.fromSlot}</span>}
              {p.health !== 'ok' && <span className="tag pill-bad">FAILED</span>}
              {p.dataBearing && <span className="tag pill-warn">data-bearing</span>}
            </div>
            <div className="row wrap" style={{ marginTop: 6 }}>
              <button className={`btn sm ${p.bagged ? 'on' : ''}`} disabled={p.bagged} onClick={() => dispatch({ type: 'bag', uid: p.uid })}>
                {p.bagged ? '✓ Bagged' : 'ESD bag'}
              </button>
              <button className={`btn sm ${p.tagged ? 'on' : ''}`} disabled={p.tagged} onClick={() => dispatch({ type: 'tag', uid: p.uid })}>
                {p.tagged ? '✓ Tagged' : 'Defect tag'}
              </button>
              {(['rma', 'secure_destruction', 'ewaste'] as BinKind[]).map((b) => (
                <button key={b} className={`btn sm ${b === 'secure_destruction' ? 'warn' : ''}`} onClick={() => dispatch({ type: 'bin', uid: p.uid, bin: b })}>
                  → {b === 'rma' ? 'RMA bin' : b === 'secure_destruction' ? '🔒 Secure destruction' : 'E-waste'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>
        Bins so far: RMA {w.bins.rma.length} · Secure destruction {w.bins.secure_destruction.length} · E-waste {w.bins.ewaste.length}
      </div>
    </div>
  );
}
