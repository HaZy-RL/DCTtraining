export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

export function fmtSimClock(sec: number): string {
  const d = new Date(Date.UTC(2026, 9, 9, 14, 0, 0) + sec * 1000);
  return d.toISOString().slice(11, 19);
}

export function fmtRelative(secFromNow: number): string {
  const neg = secFromNow < 0;
  const s = Math.abs(secFromNow);
  const txt = s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;
  return neg ? `overdue ${txt}` : `in ${txt}`;
}
