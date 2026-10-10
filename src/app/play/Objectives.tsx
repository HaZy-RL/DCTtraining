import { useMemo, useState } from 'react';
import { evaluate } from '../../engine/scenario';
import { useStore } from '../store';

export function Objectives() {
  const { inst, world, mode } = useStore();
  const [collapsed, setCollapsed] = useState(() => inst?.scene === 'quiz' || inst?.scene === 'triage');
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
          return (
            <div key={s.id} className={`obj ${done && !s.guard ? 'done' : ''} ${isNext ? 'next' : ''} ${s.guard ? 'guard' : ''}`}>
              <span className="ck">{s.guard ? '🛡' : done ? '✓' : ''}</span>
              <span className="t">
                {s.text}
                {s.guard ? <span className="opt">rule: don't break it</span> : !s.required && <span className="opt">optional</span>}
              </span>
              {mode === 'learn' && isNext && (s.why || s.hint) && (
                <div className="why">
                  {s.why && <div>💡 {s.why}</div>}
                  {s.hint && <div style={{ marginTop: 3 }}>👉 {s.hint}</div>}
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
    </div>
  );
}
