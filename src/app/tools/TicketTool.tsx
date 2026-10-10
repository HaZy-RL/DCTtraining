import { useMemo, useState } from 'react';
import { ESCALATION_TEAMS } from '../../content/ticketing';
import { TRANSITIONS } from '../../engine/actions';
import type { Ticket } from '../../engine/types';
import { fmtRelative, fmtSimClock } from '../format';
import { useStore } from '../store';

const PRIO = { P1: 1, P2: 2, P3: 3, P4: 4 };

function sortQueue(ts: Ticket[]) {
  const open = (t: Ticket) => (t.status === 'Resolved' || t.status === 'Closed' ? 1 : 0);
  return [...ts].sort((a, b) => open(a) - open(b) || PRIO[a.priority] - PRIO[b.priority] || a.slaDueAt - b.slaDueAt);
}

export function TicketTool() {
  const tickets = useStore((s) => s.world!.tickets);
  const now = useStore((s) => s.world!.t);
  const list = useMemo(() => sortQueue(Object.values(tickets)), [tickets]);
  const [selKey, setSelKey] = useState<string | null>(list[0]?.key ?? null);
  const sel = selKey ? tickets[selKey] : list[0];
  return (
    <div className="row" style={{ alignItems: 'stretch', gap: 12, minHeight: '100%' }}>
      <div className="tk-list" style={{ width: 240, flexShrink: 0 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Queue: DCO-{`PHX1`} ({list.filter((t) => t.status !== 'Resolved' && t.status !== 'Closed').length} open)
        </div>
        {list.map((t) => (
          <div key={t.key} className={`tk ${sel?.key === t.key ? 'sel' : ''}`} onClick={() => setSelKey(t.key)}>
            <div className="row">
              <span className={`prio ${t.priority}`}>{t.priority}</span>
              <b style={{ fontSize: 12 }}>{t.key}</b>
              <div className="spacer" />
              <span className={`status ${t.status}`}>{t.status}</span>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>{t.summary}</div>
            {t.status !== 'Resolved' && t.status !== 'Closed' && (
              <div className={t.slaDueAt - now < 1800 ? 'pill-bad' : 'dim'} style={{ fontSize: 11, marginTop: 2 }}>
                SLA {fmtRelative(t.slaDueAt - now)}
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <div className="dim">No tickets yet.</div>}
      </div>
      <div className="grow">{sel ? <TicketDetail t={sel} /> : <p className="muted">Select a ticket.</p>}</div>
    </div>
  );
}

function TicketDetail({ t }: { t: Ticket }) {
  const dispatch = useStore((s) => s.dispatch);
  const now = useStore((s) => s.world!.t);
  const me = useStore((s) => s.world!.trainee.name);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'worklog' | 'comment'>('worklog');
  const [pn, setPn] = useState('');
  const [serial, setSerial] = useState('');
  const [team, setTeam] = useState<string>(ESCALATION_TEAMS[0]);
  const [reason, setReason] = useState('');
  const closed = t.status === 'Resolved' || t.status === 'Closed';
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap">
        <span className={`prio ${t.priority}`}>{t.priority}</span>
        <b>{t.key}</b>
        <span className="tag">{t.type}</span>
        <span className={`status ${t.status}`}>{t.status}</span>
        <div className="spacer" />
        {!closed && <span className={t.slaDueAt - now < 1800 ? 'pill-bad' : 'muted'}>SLA {fmtRelative(t.slaDueAt - now)}</span>}
      </div>
      <h3 style={{ margin: 0 }}>{t.summary}</h3>
      <div className="kv" style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
        <span>Hostname</span>
        <span className="mono">{t.hostname ?? '—'}</span>
        <span>Asset tag</span>
        <span className="mono">{t.assetTag ?? '—'}</span>
        <span>Serial</span>
        <span className="mono">{t.serial ?? '—'}</span>
        <span>Location</span>
        <span className="mono">{t.location ?? '—'}</span>
        <span>Host state</span>
        <span className={t.hostState === 'Drained' ? 'pill-ok' : t.hostState === 'In Production' ? 'pill-warn' : ''}>{t.hostState}</span>
        <span>Assignee</span>
        <span>{t.assignee ?? 'Unassigned'}</span>
        <span>Reporter</span>
        <span>{t.reporter}</span>
        <span>Part / RMA</span>
        <span className="mono">
          {t.partRequested ?? '—'} {t.linkedRma ? ` / ${t.linkedRma}` : ''}
        </span>
      </div>
      <div className="card" style={{ background: 'var(--bg2)', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {t.description}
      </div>
      <div className="row wrap">
        {!t.assignee && (
          <button className="btn" onClick={() => dispatch({ type: 'ticketAssign', key: t.key, who: me })}>
            Assign to me
          </button>
        )}
        {TRANSITIONS[t.status].map((to) => (
          <button key={to} className={`btn ${to === 'In Progress' || to === 'Resolved' ? 'primary' : ''}`} onClick={() => dispatch({ type: 'ticketTransition', key: t.key, to })}>
            → {to}
          </button>
        ))}
        {t.hostState === 'In Production' && t.hostname && !closed && (
          <button className="btn warn" onClick={() => dispatch({ type: 'requestDrain', key: t.key })}>
            Request drain / release
          </button>
        )}
      </div>
      {!closed && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Parts, RMA and escalation
          </summary>
          <div className="col" style={{ marginTop: 8 }}>
            <div className="row">
              <input className="grow mono" placeholder="Part number, e.g. PSU-1600W-AC-TI" value={pn} onChange={(e) => setPn(e.target.value.toUpperCase())} />
              <button className="btn" disabled={!pn} onClick={() => dispatch({ type: 'requestPart', key: t.key, pn: pn.trim() })}>
                Request part
              </button>
            </div>
            <div className="row">
              <input className="grow mono" placeholder="Failed part serial for RMA" value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} />
              <button className="btn" disabled={!serial} onClick={() => dispatch({ type: 'createRma', key: t.key, serial: serial.trim() })}>
                Create RMA
              </button>
            </div>
            <div className="row wrap">
              <select value={team} onChange={(e) => setTeam(e.target.value)}>
                {ESCALATION_TEAMS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input className="grow" placeholder="Reason + evidence" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn warn" disabled={!reason} onClick={() => dispatch({ type: 'escalate', key: t.key, team, reason })}>
                Escalate
              </button>
            </div>
          </div>
        </details>
      )}
      <div className="col">
        <textarea rows={4} placeholder="What you found, what you did (old/new serials), how you verified it…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'worklog')}>
            <option value="worklog">Worklog (internal record)</option>
            <option value="comment">Comment</option>
          </select>
          <div className="spacer" />
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => {
              dispatch({ type: 'ticketWorklog', key: t.key, text, kind });
              setText('');
            }}
          >
            Add {kind}
          </button>
        </div>
      </div>
      <div>
        <b>Activity</b>
        {[...t.worklogs].reverse().map((l, i) => (
          <div key={i} className={`log ${l.kind}`}>
            <div className="meta">
              {l.author} · {fmtSimClock(l.t)} · {l.kind}
            </div>
            {l.text}
          </div>
        ))}
        {t.worklogs.length === 0 && <div className="dim">No activity yet.</div>}
      </div>
    </div>
  );
}
