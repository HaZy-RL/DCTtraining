import { useState } from 'react';
import type { Finding } from '../../engine/scenario';
import { useStore } from '../store';

export function FindingsTool() {
  const findings = useStore((s) => s.inst?.bench?.findings ?? []);
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="dim" style={{ fontSize: 12, margin: 0 }}>
        Answer from evidence you collected (terminal, BMC). Wrong answers cost points, like a wrong diagnosis would on the floor.
      </p>
      {findings.map((f) => (
        <FindingRow key={f.id} f={f} />
      ))}
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const [val, setVal] = useState('');
  const ok = !!w.flags[`finding:${f.id}:ok`];
  const wrong = w.flags[`finding:${f.id}:wrong`]?.count ?? 0;
  const submit = () => {
    if (!val.trim()) return;
    if (f.check(val, w)) dispatch({ type: 'setFlag', name: `finding:${f.id}:ok` });
    else {
      dispatch({ type: 'setFlag', name: `finding:${f.id}:wrong` });
      dispatch({ type: 'penalty', rule: 'wrong_finding', points: 2, reason: `Wrong answer for "${f.prompt}"`, key: `${f.id}:${wrong}` });
    }
  };
  return (
    <div className="card" style={{ borderColor: ok ? '#2f6f4c' : undefined }}>
      <b>{f.prompt}</b>
      {ok ? (
        <div className="pill-ok" style={{ marginTop: 6 }}>
          ✓ Correct. <span className="muted">{f.explain}</span>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="grow mono" placeholder={f.placeholder ?? 'Your answer'} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <button className="btn primary" onClick={submit}>
              Submit
            </button>
          </div>
          {wrong > 0 && (
            <div className="pill-bad" style={{ fontSize: 12, marginTop: 4 }}>
              ✗ Not quite ({wrong} wrong). {wrong >= 3 ? `Answer: ${f.explain}` : 'Go back to the evidence.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
