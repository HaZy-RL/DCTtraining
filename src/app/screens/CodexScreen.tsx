import { CHEATSHEETS, CODEX, GLOSSARY } from '../../content/codex';
import { TopNav } from '../App';
import { useStore } from '../store';

export function CodexScreen() {
  const unlocked = useStore((s) => s.progress.codex);
  return (
    <>
      <TopNav />
      <div className="page">
        <h1>Codex</h1>
        <p className="muted">Cards unlock when you meet a component or tool in a scenario. Glossary and cheat-sheets are always open.</p>
        <div className="grid">
          {CODEX.map((c) => {
            const open = unlocked.includes(c.id);
            return (
              <div key={c.id} className="card" style={{ opacity: open ? 1 : 0.55 }}>
                <div className="row">
                  <span style={{ fontSize: 26 }}>{open ? c.icon : '❔'}</span>
                  <div className="grow">
                    <b>{open ? c.title : '???'}</b>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {c.category}
                    </div>
                  </div>
                </div>
                {open ? (
                  <>
                    <p style={{ fontSize: 13 }}>{c.body}</p>
                    <b style={{ fontSize: 12, color: 'var(--warn)' }}>Gotchas</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                      {c.gotchas.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="dim" style={{ fontSize: 12 }}>
                    Meet it in a scenario to unlock.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <h2 style={{ fontSize: 18, marginTop: 24 }}>Cheat-sheets</h2>
        <div className="grid">
          {CHEATSHEETS.map((c) => (
            <div key={c.title} className="card">
              <b>{c.title}</b>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '8px 0 0' }}>
                {c.lines.join('\n')}
              </pre>
            </div>
          ))}
        </div>
        <h2 style={{ fontSize: 18, marginTop: 24 }}>Glossary</h2>
        <div className="card" style={{ padding: 0 }}>
          <table className="t">
            <tbody>
              {GLOSSARY.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 120 }}>
                    <b>{k}</b>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
