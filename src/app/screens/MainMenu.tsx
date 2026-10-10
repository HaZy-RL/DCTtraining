import { MODULES, SCENARIOS, scenariosFor } from '../../content';
import { TopNav } from '../App';
import { useStore } from '../store';

export function MainMenu() {
  const go = useStore((s) => s.go);
  const start = useStore((s) => s.start);
  const prog = useStore((s) => s.progress);
  const done = SCENARIOS.filter((s) => prog.scenarios[s.id]?.completed).length;
  const gold = SCENARIOS.filter((s) => prog.scenarios[s.id]?.bestRating === 'Gold').length;
  const attempts = prog.history.length;
  return (
    <>
      <TopNav />
      <div className="page">
        <section className="hero">
          <h1>Hyperscale Datacenter Technician Simulator</h1>
          <p>
            Work real-feeling tickets on a simulated data hall. Triage through the BMC, dig through Linux, walk to the rack, swap the part, verify it and document it.
            The BMC, the OS, the LEDs and the ticket all read from one simulated datacenter, so the evidence always lines up, and so do the consequences.
          </p>
          <div className="stats">
            <div className="stat">
              <b>
                {done}/{SCENARIOS.length}
              </b>
              <span className="muted">scenarios passed</span>
            </div>
            <div className="stat">
              <b className="medal Gold">{gold}</b>
              <span className="muted">gold ratings</span>
            </div>
            <div className="stat">
              <b>{attempts}</b>
              <span className="muted">reps logged</span>
            </div>
            <div className="row" style={{ marginLeft: 'auto' }}>
              <button className="btn primary lg" onClick={() => start('hw-psu', 'learn', 1001)}>
                ▶ First time? Guided PSU swap
              </button>
            </div>
          </div>
        </section>
        <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>What do you want to practice?</h2>
        <div className="grid">
          {MODULES.map((m) => {
            const list = scenariosFor(m.id);
            const passed = list.filter((s) => prog.scenarios[s.id]?.completed).length;
            return (
              <button key={m.id} className="tile" style={{ ['--tile-color' as string]: m.color }} onClick={() => go({ name: 'module', module: m.id })}>
                <div className="row">
                  <span className="icon">{m.icon}</span>
                  <h3 className="grow">{m.title}</h3>
                  <span className="tag">{list.length}</span>
                </div>
                <p>{m.blurb}</p>
                <div className="bar">
                  <i style={{ width: `${(passed / list.length) * 100}%` }} />
                </div>
                <span className="dim" style={{ fontSize: 12 }}>
                  {passed}/{list.length} passed
                </span>
              </button>
            );
          })}
        </div>
        <p className="dim" style={{ marginTop: 28, fontSize: 12 }}>
          Generic, vendor-neutral hardware inspired by OCP/hyperscale designs. Progress is saved in this browser only.
        </p>
      </div>
    </>
  );
}
