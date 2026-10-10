import { useState } from 'react';
import { fmtRelative } from '../format';
import { useStore } from '../store';

export function TriageScene() {
  const triage = useStore((s) => s.inst!.bench!.triage!);
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const [order, setOrder] = useState<string[]>(triage.keys);
  const [drag, setDrag] = useState<number | null>(null);
  const submitted = !!w.flags['triage:submitted'];
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const o = [...order];
    const [x] = o.splice(from, 1);
    o.splice(to, 0, x);
    setOrder(o);
  };
  return (
    <div className="bench">
      <div className="quiz">
        <h2>Order the queue (top = work first)</h2>
        <p className="muted">Drag cards, or use the arrows. Read the descriptions, because automation does not always pick the right priority.</p>
        {order.map((k, i) => {
          const t = w.tickets[k];
          const right = submitted && triage.expected[i] === k;
          return (
            <div
              key={k}
              className="tk"
              draggable={!submitted}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) move(drag, i);
                setDrag(null);
              }}
              style={{ marginBottom: 6, borderColor: submitted ? (right ? '#2f6f4c' : '#a8474f') : undefined, cursor: submitted ? 'default' : 'grab' }}
            >
              <div className="row">
                <b style={{ width: 22 }}>{i + 1}.</b>
                <span className={`prio ${t.priority}`}>{t.priority}</span>
                <b className="mono" style={{ fontSize: 12 }}>
                  {t.key}
                </b>
                <span className="grow">{t.summary}</span>
                <span className={t.slaDueAt - w.t < 3 * 3600 ? 'pill-bad' : 'dim'} style={{ fontSize: 12 }}>
                  SLA {fmtRelative(t.slaDueAt - w.t)}
                </span>
                {!submitted && (
                  <>
                    <button className="btn sm" onClick={() => move(i, i - 1)}>
                      ▲
                    </button>
                    <button className="btn sm" onClick={() => move(i, i + 1)}>
                      ▼
                    </button>
                  </>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginLeft: 30 }}>
                {t.description}
              </div>
            </div>
          );
        })}
        {!submitted ? (
          <button
            className="btn primary lg"
            onClick={() => {
              dispatch({ type: 'setFlag', name: 'triage:submitted' });
              if (order[0] === triage.expected[0]) dispatch({ type: 'setFlag', name: 'triage:first_ok' });
              if (order.slice(1).join() === triage.expected.slice(1).join()) dispatch({ type: 'setFlag', name: 'triage:order_ok' });
            }}
          >
            Submit order
          </button>
        ) : (
          <div className="card">
            <b>Expected:</b> {triage.explain}
            <ol style={{ marginBottom: 0 }}>
              {triage.expected.map((k) => (
                <li key={k}>
                  {w.tickets[k].priority} {w.tickets[k].summary}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
