import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function NotesTool() {
  const notes = useStore((s) => s.world!.trainee.notes);
  const dispatch = useStore((s) => s.dispatch);
  const [text, setText] = useState(notes);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="col" style={{ height: '100%' }}>
      <p className="dim" style={{ fontSize: 12, margin: 0 }}>
        Scratchpad for serials, MACs and what you saw. Copy from here into your worklog. (Shift Mode: write your handoff here.)
      </p>
      <textarea
        className="mono"
        style={{ flex: 1, minHeight: 300, fontSize: 12.5 }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          window.clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = window.setTimeout(() => dispatch({ type: 'notes', text: v }), 400);
        }}
      />
    </div>
  );
}
