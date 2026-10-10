import { parseOutlet, pduCapacityW, pduDeratedW, pduLoadW } from '../../engine/projectors';
import { useStore } from '../store';

export function PduTool() {
  const w = useStore((s) => s.world!);
  const sel = useStore((s) => s.sel);
  const inst = useStore((s) => s.inst!);
  const dispatch = useStore((s) => s.dispatch);
  const rackId = (w.trainee.location && w.racks[w.trainee.location] ? w.trainee.location : null) ?? sel.rackId ?? inst.focusRackId ?? Object.keys(w.racks)[0];
  const rack = w.racks[rackId];
  if (!rack) return <p className="muted">No rack selected.</p>;
  const here = w.trainee.location === rack.id;
  const outletMap: Record<string, string> = {};
  for (const d of Object.values(w.devices))
    for (const [psu, o] of Object.entries(d.powerCords)) if (o && parseOutlet(o)?.rackId === rack.id) outletMap[o] = `${d.hostname} ${psu}`;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <b className="grow">Rack {rack.location}</b>
        {!here && (
          <button className="btn sm" onClick={() => dispatch({ type: 'walk', to: rack.id })}>
            Walk to rack
          </button>
        )}
      </div>
      {rack.pdus.map((p) => {
        const load = pduLoadW(w, p.id);
        const der = pduDeratedW(p);
        const pct = Math.min(100, (load / pduCapacityW(p)) * 100);
        return (
          <div key={p.id} className="card">
            <div className="row">
              <b className="grow">
                PDU-{p.side} <span className="dim">({p.volts} V / {p.breakerAmps} A)</span>
              </b>
              <span className={p.breakerTripped ? 'pill-bad' : 'pill-ok'}>{p.breakerTripped ? '⛔ BREAKER TRIPPED' : '● ON'}</span>
            </div>
            <div className="bar" style={{ margin: '8px 0 4px', ['--tile-color' as string]: pct > 80 ? '#fc8181' : pct > 60 ? '#f6ad55' : '#48bb78' }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {(load / 1000).toFixed(2)} kW of {(pduCapacityW(p) / 1000).toFixed(2)} kW nameplate · 80% continuous limit {(der / 1000).toFixed(2)} kW
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {p.breakerTripped ? (
                <button className="btn warn sm" disabled={!here} onClick={() => dispatch({ type: 'pduBreaker', rackId: rack.id, side: p.side, on: true })}>
                  Reset breaker
                </button>
              ) : (
                <button className="btn danger sm" disabled={!here} onClick={() => dispatch({ type: 'pduBreaker', rackId: rack.id, side: p.side, on: false })}>
                  Switch breaker off
                </button>
              )}
              {!here && <span className="dim" style={{ fontSize: 12 }}>You need to be at the rack.</span>}
            </div>
            <details style={{ marginTop: 6 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                Outlets
              </summary>
              <table className="t" style={{ marginTop: 4 }}>
                <tbody>
                  {Array.from({ length: p.outlets }, (_, i) => `${p.id}:${i + 1}`).map((o, i) => (
                    <tr key={o}>
                      <td className="dim">{i + 1}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {outletMap[o] ?? <span className="dim">free</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        );
      })}
    </div>
  );
}
