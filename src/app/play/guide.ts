// UI side of the coach: which step is next, its live checklist, and "show me" navigation.
import { useMemo } from 'react';
import { evaluate, type CoachLine, type CoachTarget, type Step } from '../../engine/scenario';
import { useStore, type Panel } from '../store';

export interface CoachState {
  step: Step | null;
  lines: CoachLine[];
  /** First line that isn't done yet. */
  current: CoachLine | null;
  /** Checklist visible: always in Learn, after "Show me how" in Practice, never in Challenge. */
  visible: boolean;
}

export function useCoach(): CoachState {
  const inst = useStore((s) => s.inst);
  const world = useStore((s) => s.world);
  const mode = useStore((s) => s.mode);
  const revealed = useStore((s) => s.coachRevealed);
  return useMemo(() => {
    if (!inst || !world) return { step: null, lines: [], current: null, visible: false };
    const r = evaluate({ ...inst, world }, mode);
    const i = r.steps.findIndex((s) => !s.done && s.required && !s.guard);
    const step = i >= 0 ? inst.steps[i] : null;
    let lines: CoachLine[] = [];
    try {
      lines = step?.coach?.(world) ?? [];
    } catch {
      lines = [];
    }
    const visible = !!step && (mode === 'learn' || (mode === 'practice' && !!revealed[step.id]));
    return { step, lines, current: lines.find((l) => !l.done) ?? null, visible };
  }, [inst, world, mode, revealed]);
}

/** Map a guide key to what the inspector should select for it. */
export function selectionFor(sel?: string): string | undefined {
  if (!sel || sel === 'power' || sel === 'chassis' || sel === 'assettag') return undefined;
  if (sel.startsWith('cord:')) return sel.slice(5);
  if (sel.startsWith('fastener:')) {
    const parts = sel.split(':');
    const target = parts[1] === 'heatsink' ? `heatsink:${parts[2]}` : parts[1];
    if (target === 'chassis') return undefined;
    if (target === 'lid' || target === 'riser1' || target === 'riser2') return `layer:${target}`;
    return target;
  }
  return sel;
}

/** Point the camera and panels at a coach target. Never performs the action itself. */
export function showTarget(t: CoachTarget | undefined) {
  if (!t) return;
  const st = useStore.getState();
  if (t.room) {
    st.select({ room: t.room });
    st.setCamMode('inspect');
    return;
  }
  if (t.tool) {
    if (t.tool === 'terminal') st.toggleTerminal(true);
    else st.setPanel(t.tool as Panel);
    return;
  }
  if (t.deviceId) {
    const d = st.world?.devices[t.deviceId];
    st.select({ deviceId: t.deviceId, rackId: d?.rackId ?? t.rackId, slot: selectionFor(t.sel) });
    if (t.side) st.setView(t.side);
    st.setCamMode('inspect');
  } else if (t.rackId) {
    st.select({ rackId: t.rackId });
    if (t.side) st.setView(t.side);
  }
}

/** Approach lines ("walk to the rack / go round to the hot aisle") can be done with one click. */
export function walkTargetPending(t: CoachTarget | undefined): { to: string; side: 'front' | 'rear' } | null {
  const w = useStore.getState().world;
  if (!w || !t) return null;
  if (t.room === 'walk') return w.trainee.location === 'noc' || w.trainee.location === 'cage' ? null : { to: 'cage', side: 'front' };
  if (!t.rackId || !t.side || t.sel) return null;
  if (w.trainee.location === t.rackId && w.trainee.side === t.side) return null;
  return { to: t.rackId, side: t.side };
}
