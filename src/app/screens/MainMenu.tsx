import { useMemo } from 'react';
import { MODULES, SCENARIOS, scenarioById, scenariosFor } from '../../content';
import { TopNav } from '../App';
import { badgesOf, rankOf, starsFor, streakDays } from '../progress';
import { useStore } from '../store';

/** A little rack with blinking lights for the hero. */
function HeroRack() {
  return (
    <div className="hero-rack" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="hr-unit">
          <span className="hr-bays" />
          <i className={`hr-led ${i === 4 ? 'amber' : ''}`} style={{ animationDelay: `${(i * 0.37) % 1.6}s` }} />
          <i className="hr-led" style={{ animationDelay: `${(i * 0.61) % 1.3}s` }} />
        </div>
      ))}
    </div>
  );
}

function dailyPick(): { id: string; seed: number } {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const pool = SCENARIOS.filter((s) => s.module !== 'shift');
  return { id: pool[seed % pool.length].id, seed };
}

export function MainMenu() {
  const go = useStore((s) => s.go);
  const start = useStore((s) => s.start);
  const prog = useStore((s) => s.progress);
  const rank = rankOf(prog);
  const streak = streakDays(prog);
  const stars = SCENARIOS.reduce((a, s) => a + starsFor(prog.scenarios[s.id]), 0);
  const golds = SCENARIOS.filter((s) => prog.scenarios[s.id]?.bestRating === 'Gold').length;
  const badges = useMemo(() => badgesOf(prog, { moduleOf: (id) => scenarioById(id)?.module, hardwareIds: scenariosFor('hardware').map((s) => s.id) }), [prog]);
  // Next mission: the easiest scenario you haven't passed yet, in module order.
  const next = useMemo(() => {
    for (const m of MODULES) {
      const s = [...scenariosFor(m.id)].sort((a, b) => a.difficulty - b.difficulty).find((x) => !prog.scenarios[x.id]?.completed);
      if (s) return s;
    }
    return null;
  }, [prog]);
  const daily = dailyPick();
  const dailyDef = scenarioById(daily.id)!;
  const pctToNext = Math.round(((rank.xp - rank.floor) / (rank.next - rank.floor)) * 100);
  const newPlayer = prog.history.length === 0;
  return (
    <>
      <TopNav />
      <div className="page menu">
        <section className="hero-bright">
          <div className="hero-copy">
            <span className="kicker">Hyperscale Datacenter Technician Simulator</span>
            <h1>
              Suit up, badge in, <span className="hl">fix the fleet.</span>
            </h1>
            <p>Work realistic tickets in a living data hall: triage through the BMC, walk the aisles, unclip and unscrew real parts, swap them, verify, and close it out. Every run earns XP toward your next rank.</p>
            <div className="cta-row">
              {newPlayer ? (
                <button className="btn primary xl" onClick={() => start('hw-psu', 'learn', 1001)}>
                  ▶ Start here: guided PSU swap
                </button>
              ) : next ? (
                <button className="btn primary xl" onClick={() => start(next.id, prog.scenarios[next.id] ? 'practice' : 'learn')}>
                  Next mission: {next.title}
                </button>
              ) : (
                <button className="btn primary xl" onClick={() => go({ name: 'progress' })}>
                  🏆 Everything passed: go for Gold
                </button>
              )}
              <button className="btn xl daily" onClick={() => start(daily.id, 'challenge', daily.seed)} title={dailyDef.summary}>
                Daily drill <small>{dailyDef.title}</small>
              </button>
            </div>
          </div>
          <div className="player-card">
            <div className="row">
              <div className="avatar">👷</div>
              <div className="grow">
                <div className="pc-name">{prog.settings.name || 'You'}</div>
                <div className="pc-rank">
                  Lv {rank.level} · {rank.title}
                </div>
              </div>
              <HeroRack />
            </div>
            <div className="xp">
              <div className="xp-bar">
                <i style={{ width: `${pctToNext}%` }} />
              </div>
              <div className="row" style={{ fontSize: 12 }}>
                <span>
                  <b>{rank.xp.toLocaleString()}</b> XP
                </span>
                <div className="spacer" />
                <span className="muted">{(rank.next - rank.xp).toLocaleString()} XP to Lv {rank.level + 1}</span>
              </div>
            </div>
            <div className="pc-next">
              {(() => {
                const ladder: Array<[number, string]> = [
                  [2, 'Cart Pusher'],
                  [3, 'Cable Wrangler'],
                  [4, 'DCT I'],
                  [6, 'DCT II'],
                  [8, 'DCT III'],
                  [10, 'Senior DCT'],
                  [12, 'Lead Tech'],
                  [14, 'Datacenter Legend'],
                ];
                const nx = ladder.find(([l]) => l > rank.level);
                return nx ? (
                  <span>
                    Next rank: <b>{nx[1]}</b> at Lv {nx[0]}
                  </span>
                ) : (
                  <span>Top rank reached. Legendary.</span>
                );
              })()}
              <span className="pc-badges">
                {badges.filter((b) => b.earned).map((b) => (
                  <span key={b.id} title={b.name}>
                    {b.icon}
                  </span>
                ))}
                {!badges.some((b) => b.earned) && <span className="muted">Badges you earn show up here</span>}
              </span>
            </div>
            <div className="pc-stats">
              <div>
                <b>{stars}</b>
                <span>stars</span>
              </div>
              <div>
                <b>{golds}</b>
                <span>golds</span>
              </div>
              <div>
                <b>{streak}</b>
                <span>day streak</span>
              </div>
              <div>
                <b>{prog.history.length}</b>
                <span>reps</span>
              </div>
            </div>
          </div>
        </section>

        <div className="section-head">
          <h2>Pick your training zone</h2>
          <span className="muted">Each zone has Learn (coached), Practice (hints on request) and Challenge (timed) runs. Earn up to ⭐⭐⭐ per scenario.</span>
        </div>
        <div className="zones">
          {MODULES.map((m, i) => {
            const list = scenariosFor(m.id);
            const passed = list.filter((s) => prog.scenarios[s.id]?.completed).length;
            const st = list.reduce((a, s) => a + starsFor(prog.scenarios[s.id]), 0);
            const fresh = !list.some((s) => prog.scenarios[s.id]);
            return (
              <button key={m.id} className="zone" style={{ ['--zc' as string]: m.color, animationDelay: `${i * 40}ms` }} onClick={() => go({ name: 'module', module: m.id })}>
                {fresh && <span className="zone-new">NEW</span>}
                {passed === list.length && <span className="zone-new done">CLEARED</span>}
                <span className="zone-icon">{m.icon}</span>
                <h3>{m.title}</h3>
                <p>{m.blurb}</p>
                <div className="zone-foot">
                  <div className="zone-bar">
                    <i style={{ width: `${(passed / list.length) * 100}%` }} />
                  </div>
                  <span className="zone-stars">
                    ⭐ {st}/{list.length * 3}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="section-head">
          <h2>Badges</h2>
          <span className="muted">
            {badges.filter((b) => b.earned).length}/{badges.length} unlocked
          </span>
        </div>
        <div className="badges">
          {badges.map((b) => (
            <div key={b.id} className={`badge-card ${b.earned ? 'earned' : ''}`} title={b.how}>
              <span className="bi">{b.icon}</span>
              <b>{b.name}</b>
              <span>{b.how}</span>
            </div>
          ))}
        </div>
        <p className="dim" style={{ marginTop: 28, fontSize: 12 }}>
          Generic, vendor-neutral hardware inspired by OCP/hyperscale designs. Progress is saved in this browser only.
        </p>
      </div>
    </>
  );
}
