import { useMemo, useState } from 'react';
import { evaluate, type CoachLine } from '../../engine/scenario';
import { useStore } from '../store';
import { showTarget, useCoach, walkTargetPending } from './guide';

function CoachLines({ lines }: { lines: CoachLine[] }) {
  const dispatch = useStore((s) => s.dispatch);
  const currentIdx = lines.findIndex((l) => !l.done);
  return (
    <ol className="coach-lines">
      {lines.map((l, i) => {
        const cur = i === currentIdx;
        const walk = cur ? walkTargetPending(l.target) : null;
        return (
          <li key={i} className={`${l.done ? 'done' : ''} ${cur ? 'cur' : ''}`}>
            <span className="mark">{l.done ? '✓' : cur ? '▶' : '·'}</span>
            <span className="grow">{l.text}</span>
            {cur && walk && (
              <button className="btn sm primary" onClick={() => dispatch({ type: 'walk', to: walk.to, side: walk.side })}>
                🚶 Go
              </button>
            )}
            {cur && !walk && l.target && (
              <button className="btn sm" onClick={() => showTarget(l.target)} title="Point the camera / open the right tool">
                {l.target.tool ? 'Open' : '👁 Show me'}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Objectives() {
  const { inst, world, mode, revealCoach } = useStore();
  const [collapsed, setCollapsed] = useState(() => inst?.scene === 'quiz' || inst?.scene === 'triage');
  const [playbook, setPlaybook] = useState(false);
  const coach = useCoach();
  const r = useMemo(() => (inst && world ? evaluate({ ...inst, world }, mode) : null), [inst, world, mode]);
  if (!inst || !r) return null;
  const nextIdx = r.steps.findIndex((s) => !s.done && s.required && !s.guard);
  return (
    <div className={`overlay objectives ${collapsed ? 'collapsed' : ''}`}>
      <div className="row" style={{ marginBottom: collapsed ? 0 : 6 }}>
        <b className="grow">Objectives</b>
        <span className="dim" style={{ fontSize: 12 }}>
          {r.steps.filter((s) => s.done).length}/{r.steps.length}
        </span>
        <button className="btn ghost sm" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed &&
        inst.steps.map((s, i) => {
          const done = r.steps[i].done;
          const isNext = i === nextIdx;
          const showCoach = isNext && coach.visible;
          return (
            <div key={s.id} className={`obj ${done && !s.guard ? 'done' : ''} ${isNext ? 'next' : ''} ${s.guard ? 'guard' : ''}`}>
              <span className="ck">{s.guard ? '🛡' : done ? '✓' : ''}</span>
              <span className="t">
                {s.text}
                {s.guard ? <span className="opt">rule: don't break it</span> : !s.required && <span className="opt">optional</span>}
              </span>
              {showCoach && (
                <div className="why">
                  {s.why && <div>💡 {s.why}</div>}
                  {s.hint && <div style={{ marginTop: 3 }}>👉 {s.hint}</div>}
                  {coach.lines.length > 0 && <CoachLines lines={coach.lines} />}
                </div>
              )}
              {isNext && mode === 'practice' && !coach.visible && (
                <div className="why ask">
                  <button className="btn sm" onClick={() => revealCoach(s.id)}>
                    💡 Show me how
                  </button>
                  <span className="dim"> step-by-step help for this objective (counts as a hint)</span>
                </div>
              )}
            </div>
          );
        })}
      {!collapsed && r.allRequired && (
        <div className="pill-ok" style={{ marginTop: 8, fontSize: 13 }}>
          ✓ All required objectives done. Hit "Finish & review", or polish the optional ones first.
        </div>
      )}
      {!collapsed && mode !== 'challenge' && inst.expertPath.length > 0 && (
        <div className="playbook">
          <button className="btn ghost sm" onClick={() => setPlaybook(!playbook)}>
            📖 {playbook ? 'Hide' : 'Show'} the playbook (how an experienced tech works this)
          </button>
          {playbook && (
            <ol>
              {inst.expertPath.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
