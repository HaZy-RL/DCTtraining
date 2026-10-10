import { useEffect, useState } from 'react';
import { useStore } from '../store';

/** Shows world toasts for ~6 s (real time) each. */
export function Toasts() {
  const toasts = useStore((s) => s.world?.toasts ?? []);
  const [seenAt, setSeenAt] = useState<Record<number, number>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    setSeenAt((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const t of toasts)
        if (!next[t.id]) {
          next[t.id] = Date.now();
          changed = true;
        }
      return changed ? next : prev;
    });
  }, [toasts]);
  const visible = toasts.filter((t) => seenAt[t.id] && now - seenAt[t.id] < (t.kind === 'error' ? 8000 : 6000)).slice(-5);
  return (
    <div className="toasts">
      {visible.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
