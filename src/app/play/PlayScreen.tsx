import { useEffect, useMemo, useState } from 'react';
import { scenarioById } from '../../content';
import { evaluate } from '../../engine/scenario';
import { nextPendingAt } from '../../engine/sim';
import { fmtSimClock, fmtTime } from '../format';
import { useStore, type Panel } from '../store';
import { Objectives } from './Objectives';
import { SceneHost } from './SceneHost';
import { SidePanel } from './SidePanel';
import { TerminalDock } from './TerminalDock';
import { Toasts } from './Toasts';

function useClock() {
  const tick = useStore((s) => s.tick);
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      tick(Math.min((now - last) / 1000, 1));
      last = now;
    }, 500);
    return () => window.clearInterval(id);
  }, [tick]);
}

const TOOL_META: Record<string, { ic: string; label: string }> = {
  ticket: { ic: '🎫', label: 'Tickets' },
  terminal: { ic: '⌨️', label: 'Terminal' },
  bmc: { ic: '📡', label: 'BMC' },
  assets: { ic: '🗃️', label: 'CMDB' },
  parts: { ic: '📦', label: 'Parts' },
  notes: { ic: '📝', label: 'Notes' },
  cutsheet: { ic: '📋', label: 'Cut sheet' },
  pdu: { ic: '🔌', label: 'PDUs' },
  findings: { ic: '🔎', label: 'Findings' },
};

function TopBar() {
  const { inst, world, mode, paused, setPaused, waitUntilNext, finish, quit, useHint, hintsUsed, progress, updateSettings } = useStore();
  const [confirmQuit, setConfirmQuit] = useState(false);
  const r = useMemo(() => (inst && world ? evaluate({ ...inst, world }, mode) : null), [inst, world, mode]);
  if (!inst || !world || !r) return null;
  const limit = mode === 'challenge' ? inst.timeLimitSec : undefined;
  const left = limit ? limit - world.t : undefined;
  const nxt = nextPendingAt(world);
  return (
    <div className="play-top">
      <span className="title" title={inst.title}>
        {inst.title}
      </span>
      <span className="tag">{mode}</span>
      <span className="clock" title="Simulated wall clock">
        🕑 {fmtSimClock(world.t)}
      </span>
      {left !== undefined && <span className={`clock ${left < 120 ? 'low' : ''}`}>⏱ {fmtTime(left)}</span>}
      <button className="btn sm" onClick={() => setPaused(!paused)}>
        {paused ? '▶ Resume' : '⏸ Pause'}
      </button>
      <select
        value={progress.settings.speed}
        onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
        title="Simulation speed"
        style={{ padding: '3px 4px', fontSize: 12 }}
      >
        {[1, 2, 4, 8].map((x) => (
          <option key={x} value={x}>
            {x}×
          </option>
        ))}
      </select>
      <button className="btn sm" onClick={waitUntilNext} title={nxt !== null ? `Skip ahead to the next event (in ${Math.round(nxt - world.t)}s)` : 'Skip ahead 30s'}>
        ⏩ Wait{nxt !== null ? ` (${Math.round(nxt - world.t)}s)` : ''}
      </button>
      {mode === 'practice' && (
        <button
          className="btn sm"
          onClick={() => {
            useHint();
            const next = inst.steps.find((s, i) => !r.steps[i].done && s.required);
            useStore.setState((st) => {
              if (!st.world) return {};
              const w = { ...st.world, toasts: [...st.world.toasts, { id: st.world.toastSeq + 1, t: st.world.t, kind: 'info' as const, text: `💡 ${next ? next.hint ?? next.why ?? next.text : 'All required steps done. Finish!'}` }], toastSeq: st.world.toastSeq + 1 };
              return { world: w };
            });
          }}
        >
          💡 Hint{hintsUsed ? ` (${hintsUsed})` : ''}
        </button>
      )}
      <div className="spacer" />
      <span className="muted" style={{ fontSize: 12 }}>
        {r.steps.filter((s) => s.done).length}/{r.steps.length} · {r.pct}%
      </span>
      <button className={`btn ${r.allRequired ? 'primary' : ''}`} onClick={finish}>
        {r.allRequired ? '✓ Finish & review' : 'End & review'}
      </button>
      {!confirmQuit ? (
        <button className="btn ghost sm" onClick={() => setConfirmQuit(true)}>
          ✕
        </button>
      ) : (
        <>
          <button className="btn danger sm" onClick={quit}>
            Quit without saving
          </button>
          <button className="btn sm" onClick={() => setConfirmQuit(false)}>
            Stay
          </button>
        </>
      )}
    </div>
  );
}

function ToolDock() {
  const { inst, panel, setPanel, terminalOpen, toggleTerminal, unlockCodex } = useStore();
  const openTickets = useStore((s) => (s.world ? Object.values(s.world.tickets).filter((t) => t.status === 'Open').length : 0));
  const tray = useStore((s) => s.world?.trainee.tray.length ?? 0);
  if (!inst) return null;
  const tools: string[] = [...inst.tools];
  if (inst.bench?.findings?.length) tools.push('findings');
  return (
    <div className="dock">
      {tools.map((t) => {
        const m = TOOL_META[t];
        const on = t === 'terminal' ? terminalOpen : panel === t;
        return (
          <button
            key={t}
            className={on ? 'on' : ''}
            title={m.label}
            onClick={() => {
              unlockCodex(`tool:${t}`);
              if (t === 'terminal') toggleTerminal();
              else setPanel(panel === t ? null : (t as Panel));
            }}
          >
            <span className="ic">{m.ic}</span>
            {m.label}
            {t === 'ticket' && openTickets > 0 && <span className="badge">{openTickets}</span>}
            {t === 'parts' && tray > 0 && <span className="badge">{tray}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Briefing() {
  const { inst, mode, dismissBriefing, defId } = useStore();
  if (!inst) return null;
  const def = scenarioById(defId!)!;
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="row">
          <span className="tag">{def.module}</span>
          <span className="tag">{mode}</span>
          <span className="diff">{'●'.repeat(def.difficulty)}</span>
        </div>
        <h2 style={{ marginTop: 10 }}>{inst.title}</h2>
        <p style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{inst.briefing}</p>
        <div className="card" style={{ background: 'var(--bg2)', fontSize: 13 }}>
          <b>How this works</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>Tools are on the left: tickets, terminal (jump host), BMC web UI, CMDB, parts and notes.</li>
            <li>In the 3D view, click a rack to walk to it and click a server or part to inspect and act on it. Toggle Front/Rear.</li>
            <li>The clock is simulated. Long waits (POST, drains, deliveries) can be skipped with ⏩ Wait.</li>
            <li>Every action is graded, including safety and process. {mode === 'learn' ? 'Learn mode shows the next step and why it matters.' : mode === 'practice' ? 'Use 💡 Hint if you get stuck.' : 'Challenge mode is timed, with no hints.'}</li>
          </ul>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <div className="spacer" />
          <button className="btn primary lg" onClick={dismissBriefing}>
            Clock in ▶
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoEnd() {
  const { inst, world, mode, finish } = useStore();
  useEffect(() => {
    if (inst && world && mode === 'challenge' && inst.timeLimitSec && world.t >= inst.timeLimitSec) finish();
  }, [inst, world, mode, finish]);
  return null;
}

export default function PlayScreen() {
  useClock();
  const inst = useStore((s) => s.inst);
  const panel = useStore((s) => s.panel);
  const showBriefing = useStore((s) => s.showBriefing);
  const shell = useStore((s) => s.shell);
  if (!inst) return null;
  return (
    <div className="play">
      <TopBar />
      <ToolDock />
      <div className="main">
        <SceneHost />
        <Objectives />
        <Toasts />
      </div>
      {panel && <SidePanel />}
      {shell && <TerminalDock />}
      {showBriefing && <Briefing />}
      <AutoEnd />
    </div>
  );
}
