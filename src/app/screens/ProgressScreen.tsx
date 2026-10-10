import { MODULES, SCENARIOS, scenarioById } from '../../content';
import { TopNav } from '../App';
import { useStore } from '../store';

export function ProgressScreen() {
  const prog = useStore((s) => s.progress);
  return (
    <>
      <TopNav />
      <div className="page">
        <h1>Progress</h1>
        <div className="grid" style={{ marginBottom: 20 }}>
          {MODULES.map((m) => {
            const list = SCENARIOS.filter((s) => s.module === m.id);
            const passed = list.filter((s) => prog.scenarios[s.id]?.completed).length;
            const gold = list.filter((s) => prog.scenarios[s.id]?.bestRating === 'Gold').length;
            return (
              <div key={m.id} className="card" style={{ ['--tile-color' as string]: m.color }}>
                <div className="row">
                  <span style={{ fontSize: 22 }}>{m.icon}</span>
                  <b className="grow">{m.title}</b>
                  <span className="medal Gold">{gold ? `★${gold}` : ''}</span>
                </div>
                <div className="bar" style={{ margin: '8px 0' }}>
                  <i style={{ width: `${(passed / list.length) * 100}%` }} />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {passed}/{list.length} passed
                </span>
              </div>
            );
          })}
        </div>
        <h2 style={{ fontSize: 18 }}>Recent reps</h2>
        {prog.history.length === 0 && <p className="muted">No attempts yet. Go break (and fix) something.</p>}
        {prog.history.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Scenario</th>
                  <th>Mode</th>
                  <th>Result</th>
                  <th>Score</th>
                  <th>Penalties</th>
                  <th>Safety</th>
                </tr>
              </thead>
              <tbody>
                {prog.history.map((h, i) => (
                  <tr key={i}>
                    <td className="dim">{new Date(h.at).toLocaleString()}</td>
                    <td>{scenarioById(h.scenarioId)?.title ?? h.scenarioId}</td>
                    <td>{h.mode}</td>
                    <td className={`medal ${h.rating}`}>{h.rating}</td>
                    <td>{h.pct}%</td>
                    <td>{h.penalties ? `−${h.penalties}` : '—'}</td>
                    <td className={h.safety ? 'pill-bad' : ''}>{h.safety || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
