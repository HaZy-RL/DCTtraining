import { useState } from 'react';
import { MODULES, scenariosFor } from '../../content';
import type { Mode } from '../../engine/scenario';
import { VENDORS } from '../../engine/vendors';
import { TopNav } from '../App';
import { VendorLogo } from '../brand';
import { starsFor } from '../progress';
import { useStore } from '../store';

const MODE_INFO: Record<Mode, string> = {
  learn: 'A coach walks you through every physical step (which clip, which screw, which aisle) with a glowing marker and the "why". No timer.',
  practice: 'Objectives listed. Stuck? "Show me how" reveals the step-by-step checklist for one objective (counts as a hint). No timer.',
  challenge: 'Timed and randomized. Objectives only, no hints. Scored for a medal.',
};

export function ModuleScreen({ moduleId }: { moduleId: string }) {
  const m = MODULES.find((x) => x.id === moduleId)!;
  const list = scenariosFor(m.id);
  const prog = useStore((s) => s.progress);
  const start = useStore((s) => s.start);
  const go = useStore((s) => s.go);
  const [mode, setMode] = useState<Mode>('practice');
  return (
    <>
      <TopNav />
      <div className="page">
        <button className="btn ghost sm" onClick={() => go({ name: 'menu' })}>
          ← All modules
        </button>
        <div className="hero" style={{ paddingTop: 10 }}>
          {m.vendor ? (
            <div className="row" style={{ gap: 16, alignItems: 'center' }}>
              <VendorLogo vendor={m.vendor} width={150} height={44} />
              <h1 style={{ margin: 0 }}>{VENDORS[m.vendor].family}</h1>
            </div>
          ) : (
            <h1>
              {m.icon} {m.title}
            </h1>
          )}
          <p>{m.blurb}</p>
          {m.vendor && (
            <div className="card vendor-brief">
              <div>
                <b>Management controller</b>
                <span>
                  {VENDORS[m.vendor].bmc.product} ({VENDORS[m.vendor].bmc.short}): {VENDORS[m.vendor].bmc.logName}, {VENDORS[m.vendor].bmc.cli} over SSH, default user <code>{VENDORS[m.vendor].bmc.defaultUser}</code>
                </span>
              </div>
              <div>
                <b>Touch points</b>
                <span>{VENDORS[m.vendor].touchPoints}</span>
              </div>
              <div>
                <b>Parts and dispatch</b>
                <span>{VENDORS[m.vendor].dispatch}</span>
              </div>
            </div>
          )}
        </div>
        <div className="card row wrap" style={{ marginBottom: 14 }}>
          <b>Mode:</b>
          <div className="modes">
            {(['learn', 'practice', 'challenge'] as Mode[]).map((x) => (
              <button key={x} className={`btn ${mode === x ? 'on primary' : ''}`} onClick={() => setMode(x)}>
                {x === 'learn' ? '📘 Learn' : x === 'practice' ? '🛠 Practice' : '⏱ Challenge'}
              </button>
            ))}
          </div>
          <span className="muted grow">{MODE_INFO[mode]}</span>
        </div>
        <div className="col">
          {list.map((s) => {
            const p = prog.scenarios[s.id];
            return (
              <div key={s.id} className="card scenario">
                <div>
                  <div className="row wrap">
                    <h3 style={{ margin: 0 }}>{s.title}</h3>
                    <span className="diff" title={`Difficulty ${s.difficulty}/5`}>
                      {'●'.repeat(s.difficulty)}
                      <span className="dim">{'●'.repeat(5 - s.difficulty)}</span>
                    </span>
                    <span className="tag">~{s.minutes} min</span>
                    <span className="stars" title={p?.bestRating ? `Best: ${p.bestRating} ${p.bestPct}%` : 'Not played yet'}>
                      {[1, 2, 3].map((n) => (
                        <span key={n} className={n <= starsFor(p) ? 'on' : ''}>
                          ★
                        </span>
                      ))}
                    </span>
                    {p?.bestRating && <span className={`medal ${p.bestRating}`}>{p.bestRating === 'Incomplete' ? '—' : p.bestRating} {p.bestPct}%</span>}
                  </div>
                  <p className="muted" style={{ margin: '6px 0' }}>
                    {s.summary}
                  </p>
                  <div className="row wrap">
                    {s.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                    {p && <span className="dim" style={{ fontSize: 12 }}>{p.attempts} attempt{p.attempts === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <button className="btn primary lg" onClick={() => start(s.id, mode)}>
                  Start ▶
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
