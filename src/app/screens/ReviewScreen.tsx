import { scenarioById } from '../../content';
import { fmtTime } from '../format';
import { useStore } from '../store';

export function ReviewScreen() {
  const { result, inst, world, defId, mode, seed, start, quit } = useStore();
  if (!result || !inst || !world || !defId) return null;
  const def = scenarioById(defId)!;
  return (
    <div className="page">
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <h2 className="grow" style={{ margin: 0 }}>
          After-action review: {inst.title}
        </h2>
        <span className="tag">{mode}</span>
        <span className="tag">seed {seed}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <div className={`rating medal ${result.rating}`}>{result.rating === 'Incomplete' ? 'Incomplete' : `★ ${result.rating}`}</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{result.pct}%</div>
          <div className="kv">
            <span>Objectives</span>
            <span>
              {result.earned}/{result.possible} pts
            </span>
            <span>Penalties</span>
            <span className={result.penaltyPoints ? 'pill-bad' : ''}>−{result.penaltyPoints}</span>
            <span>Safety violations</span>
            <span className={result.safetyViolations ? 'pill-bad' : 'pill-ok'}>{result.safetyViolations}</span>
            {result.timeBonus > 0 && (
              <>
                <span>Time bonus</span>
                <span className="pill-ok">+{result.timeBonus}%</span>
              </>
            )}
            <span>Sim time</span>
            <span>{fmtTime(world.t)}</span>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Gold: ≥90% with zero safety violations. Silver: ≥75%. Bronze: all required objectives done.
          </p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => start(defId, mode, seed)}>
              ↻ Retry same scenario
            </button>
            <button className="btn" onClick={() => start(defId, mode)}>
              🎲 New variation
            </button>
            <button className="btn ghost" onClick={quit}>
              Back to {def.module}
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Root cause</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{inst.rootCause}</p>
          <h3>Expert path</h3>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {inst.expertPath.map((s, i) => (
              <li key={i} style={{ margin: '3px 0' }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 14 }}>
        <div className="card">
          <h3>Objectives</h3>
          {result.steps.map((s) => (
            <div key={s.id} className={`obj ${s.done ? 'done' : ''}`}>
              <span className="ck">{s.done ? '✓' : ''}</span>
              <span className="t">
                {s.text} <span className="dim">({s.points} pts{s.required ? '' : ', optional'})</span>
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Penalties</h3>
          {world.penalties.length === 0 && <p className="pill-ok">Clean run, no penalties. 👏</p>}
          {world.penalties.map((p, i) => (
            <div key={i} className="penalty">
              <span className="dim mono">{fmtTime(p.t)}</span> {p.safety ? '⚠️' : '•'} {p.reason} <b className="pill-bad">−{p.points}</b>
            </div>
          ))}
          <h3 style={{ marginTop: 14 }}>Your timeline</h3>
          <div className="timeline">
            {world.log
              .filter((l) => l.detail)
              .map((l, i) => (
                <div key={i} className={l.ok ? '' : 'bad'}>
                  [{fmtTime(l.t)}] {l.action}: {l.detail}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
