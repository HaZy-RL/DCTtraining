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

type StoreState = ReturnType<typeof useStore.getState>;
type CoachInputs = Pick<StoreState, 'inst' | 'world' | 'mode' | 'coachRevealed'>;

// One evaluation per store snapshot, shared by every hook that asks (the clock ticks twice a second).
let cacheKey: [unknown, unknown, unknown, unknown] | null = null;
let cacheVal: CoachState | null = null;

function coachFor(s: CoachInputs): CoachState {
  const { inst, world, mode, coachRevealed: revealed } = s;
  if (cacheKey && cacheVal && cacheKey[0] === inst && cacheKey[1] === world && cacheKey[2] === mode && cacheKey[3] === revealed) return cacheVal;
  let out: CoachState;
  if (!inst || !world) out = { step: null, lines: [], current: null, visible: false };
  else {
    const r = evaluate({ ...inst, world }, mode);
    const i = r.steps.findIndex((st) => !st.done && st.required && !st.guard);
    const step = i >= 0 ? inst.steps[i] : null;
    let lines: CoachLine[] = [];
    try {
      lines = step?.coach?.(world) ?? [];
    } catch {
      lines = [];
    }
    const visible = !!step && (mode === 'learn' || (mode === 'practice' && !!revealed[step.id]));
    out = { step, lines, current: lines.find((l) => !l.done) ?? null, visible };
  }
  cacheKey = [inst, world, mode, revealed];
  cacheVal = out;
  return out;
}

export function useCoach(): CoachState {
  const inst = useStore((s) => s.inst);
  const world = useStore((s) => s.world);
  const mode = useStore((s) => s.mode);
  const coachRevealed = useStore((s) => s.coachRevealed);
  return coachFor({ inst, world, mode, coachRevealed });
}

/**
 * Just the coach's current 3D target (when the checklist is visible). Only re-renders when the target itself changes,
 * so the 3D scene isn't rebuilt on every clock tick.
 */
export function useCoachTarget(): CoachTarget | undefined {
  const key = useStore((s) => {
    const c = coachFor(s);
    return c.visible && c.current?.target ? JSON.stringify(c.current.target) : '';
  });
  return useMemo(() => (key ? (JSON.parse(key) as CoachTarget) : undefined), [key]);
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
