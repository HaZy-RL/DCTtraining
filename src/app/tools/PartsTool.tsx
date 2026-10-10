import { KIND_LABEL, partSpec } from '../../engine/catalog';
import type { BinKind, ComponentKind } from '../../engine/types';
import { useStore } from '../store';

export const inRoom = (loc: string | null) => loc === 'noc' || loc === 'cage';

export function locationLabel(loc: string | null, rackLoc?: string): string {
  if (loc === 'noc') return 'DCO workroom · laptop desk';
  if (loc === 'cage') return 'DCO workroom · parts & RMA';
  if (loc === 'aisle') return 'Walking the hall';
  return rackLoc ?? loc ?? '—';
}

/** Spares on the workroom shelves (optionally one kind), with pick-up / put-back. */
export function ShelfList({ kind }: { kind?: ComponentKind }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const here = inRoom(w.trainee.location);
  const items = w.spares.map((s, i) => ({ s, i })).filter(({ s }) => !kind || s.component.kind === kind);
  if (!items.length) return <div className="dim">{kind ? `The ${KIND_LABEL[kind].toLowerCase()} shelf is empty.` : 'No spares.'}</div>;
  return (
    <div className="col" style={{ gap: 6 }}>
      {items.map(({ s, i }) => (
        <div key={s.component.uid} className="tk" style={{ cursor: 'default' }}>
          <div className="row wrap">
            <b className="mono grow" style={{ fontSize: 12.5 }}>
              PN {s.component.partNumber}
            </b>
            <span className={`tag ${s.location === 'cart' ? 'pill-ok' : ''}`}>{s.location === 'cart' ? '🛒 on your cart' : `📦 ${KIND_LABEL[s.component.kind]} shelf`}</span>
          </div>
          <div style={{ fontSize: 12.5 }}>{partSpec(s.component.partNumber).desc}</div>
          <div className="row wrap" style={{ marginTop: 4 }}>
            <span className="dim mono grow" style={{ fontSize: 11 }}>
              S/N {s.component.serial}
            </span>
            {s.location === 'cage' ? (
              <button className="btn sm primary" disabled={!here} title={here ? '' : 'Walk to the DCO workroom first'} onClick={() => dispatch({ type: 'pickPart', spareIndex: i })}>
                Pick up
              </button>
            ) : (
              <button className="btn sm" disabled={!here} title={here ? '' : 'Walk to the DCO workroom first'} onClick={() => dispatch({ type: 'returnPart', spareIndex: i })}>
                Put back
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Parts you've pulled: bag, tag, and (in the workroom) drop in the right bin. */
export function TrayList({ only }: { only?: BinKind }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const here = inRoom(w.trainee.location);
  if (w.trainee.tray.length === 0) return <div className="dim">Nothing in your hands. Removed parts land here.</div>;
  return (
    <div className="col" style={{ gap: 6 }}>
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
            {(['rma', 'secure_destruction', 'ewaste'] as BinKind[])
              .filter((b) => !only || b === only)
              .map((b) => (
                <button key={b} className={`btn sm ${b === 'secure_destruction' ? 'warn' : ''}`} disabled={!here} title={here ? '' : 'The bins are in the DCO workroom'} onClick={() => dispatch({ type: 'bin', uid: p.uid, bin: b })}>
                  → {b === 'rma' ? 'RMA bin' : b === 'secure_destruction' ? '🔒 Secure destruction' : 'E-waste'}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PartsTool() {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const loc = w.trainee.location;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="row wrap">
          <b className="grow">📍 {locationLabel(loc, loc ? w.racks[loc]?.location : undefined)}</b>
          {!inRoom(loc) && (
            <button className="btn sm" onClick={() => dispatch({ type: 'walk', to: 'cage' })}>
              🚶 Walk to the DCO workroom
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
        <b>📦 Spares (workroom shelves + your cart)</b>
        <p className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          Check the PN on the label against the part you're replacing. Look-alikes sit on the same shelf.
        </p>
        <ShelfList />
      </div>
      <div>
        <b>✋ In your hands / tray ({w.trainee.tray.length})</b>
        <p className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          Bag and tag anywhere; the RMA, secure-destruction and e-waste bins are at the RMA station in the workroom.
        </p>
        <TrayList />
      </div>
      <div className="dim" style={{ fontSize: 12 }}>
        Bins so far: RMA {w.bins.rma.length} · Secure destruction {w.bins.secure_destruction.length} · E-waste {w.bins.ewaste.length}
      </div>
    </div>
  );
}
