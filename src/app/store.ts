// Global app state (zustand). The World is immutable and updated through immer,
// so components can subscribe to small slices and only re-render when those change.
import { produce, setAutoFreeze } from 'immer';
import { create } from 'zustand';
import { scenarioById } from '../content';
import { applyAction, type Action, type ActionResult } from '../engine/actions';
import { randomSeed } from '../engine/rng';
import { evaluate, type Mode, type ScenarioInstance, type ScoreResult, type ToolId } from '../engine/scenario';
import { createSession } from '../engine/shells/packs';
import type { ShellSession } from '../engine/shells/core';
import { advance, nextPendingAt } from '../engine/sim';
import type { PortRef, World } from '../engine/types';
import { loadProgress, recordAttempt, saveProgress, type ProgressData, type Settings } from './progress';
import { sfx } from './audio';

setAutoFreeze(false);

export type Screen =
  | { name: 'menu' }
  | { name: 'module'; module: string }
  | { name: 'play' }
  | { name: 'review' }
  | { name: 'progress' }
  | { name: 'codex' }
  | { name: 'settings' };

export type Panel = ToolId | 'findings' | 'objectives';

export interface Selection {
  deviceId?: string;
  slot?: string;
  cableId?: string;
  rackId?: string;
  /** Build mode: a U position in the rack */
  u?: number;
}

interface State {
  screen: Screen;
  progress: ProgressData;
  // play session
  defId: string | null;
  seed: number;
  mode: Mode;
  inst: ScenarioInstance | null;
  world: World | null;
  paused: boolean;
  showBriefing: boolean;
  result: ScoreResult | null;
  panel: Panel | null;
  terminalOpen: boolean;
  view: 'front' | 'rear';
  sel: Selection;
  pendingPort: PortRef | null;
  cableDraft: { a: PortRef; b: PortRef } | null;
  hintsUsed: number;
  shell: ShellSession | null;

  go: (s: Screen) => void;
  start: (defId: string, mode: Mode, seed?: number) => void;
  dispatch: (a: Action) => ActionResult;
  tick: (dtReal: number) => void;
  waitUntilNext: () => void;
  finish: () => void;
  quit: () => void;
  setPanel: (p: Panel | null) => void;
  toggleTerminal: (open?: boolean) => void;
  setView: (v: 'front' | 'rear') => void;
  select: (s: Selection) => void;
  setPendingPort: (p: PortRef | null) => void;
  setPaused: (p: boolean) => void;
  dismissBriefing: () => void;
  useHint: () => void;
  updateSettings: (s: Partial<Settings>) => void;
  unlockCodex: (id: string) => void;
  resetProgress: () => void;
}

export const useStore = create<State>((set, get) => ({
  screen: { name: 'menu' },
  progress: loadProgress(),
  defId: null,
  seed: 0,
  mode: 'practice',
  inst: null,
  world: null,
  paused: false,
  showBriefing: true,
  result: null,
  panel: null,
  terminalOpen: false,
  view: 'front',
  sel: {},
  pendingPort: null,
  cableDraft: null,
  hintsUsed: 0,
  shell: null,

  go: (screen) => {
    set({ screen });
    try {
      window.location.hash = screen.name === 'module' ? `#/module/${screen.module}` : screen.name === 'menu' ? '#/' : `#/${screen.name}`;
    } catch {
      /* ignore */
    }
  },

  start: (defId, mode, seed) => {
    const def = scenarioById(defId);
    if (!def) return;
    const s = seed ?? randomSeed();
    const inst = def.build(s, mode);
    inst.world.trainee.name = 'You';
    const api = {
      getWorld: () => get().world!,
      dispatch: (a: Action) => get().dispatch(a),
    };
    const shell = inst.tools.includes('terminal') ? createSession(api) : null;
    set({
      defId,
      seed: s,
      mode,
      inst,
      world: inst.world,
      paused: false,
      showBriefing: true,
      result: null,
      panel: inst.startTool ?? null,
      terminalOpen: inst.startTool === 'terminal',
      view: 'front',
      sel: { deviceId: inst.focusDeviceId, rackId: inst.focusRackId },
      pendingPort: null,
      cableDraft: null,
      hintsUsed: 0,
      shell,
      screen: { name: 'play' },
    });
    if (inst.startTool === 'terminal') set({ panel: null });
  },

  dispatch: (a) => {
    const w = get().world;
    if (!w) return { ok: false, message: 'No scenario running' };
    let res: ActionResult = { ok: false, message: '' };
    const next = produce(w, (d) => {
      res = applyAction(d, a);
    });
    set({ world: next });
    if (a.type !== 'setFlag' && a.type !== 'notes' && get().progress.settings.sound) {
      if (!res.ok) sfx('error');
      else if (next.penalties.length > w.penalties.length) sfx('warn');
      else sfx('click');
    }
    return res;
  },

  tick: (dtReal) => {
    const { world, paused, showBriefing, result, progress } = get();
    if (!world || paused || showBriefing || result) return;
    const dt = dtReal * progress.settings.speed;
    set({ world: produce(world, (d) => advance(d, dt)) });
  },

  waitUntilNext: () => {
    const w = get().world;
    if (!w) return;
    const nxt = nextPendingAt(w);
    const dt = nxt !== null ? Math.max(1, Math.min(nxt - w.t + 1, 600)) : 30;
    set({ world: produce(w, (d) => advance(d, dt)) });
  },

  finish: () => {
    const { inst, world, mode, defId, seed, progress } = get();
    if (!inst || !world || !defId) return;
    const r = evaluate({ ...inst, world }, mode, world.t);
    const p = recordAttempt(progress, {
      scenarioId: defId,
      mode,
      seed,
      at: Date.now(),
      pct: r.pct,
      rating: r.rating,
      simSeconds: Math.round(world.t),
      penalties: r.penaltyPoints,
      safety: r.safetyViolations,
    });
    saveProgress(p);
    if (progress.settings.sound) sfx(r.rating === 'Incomplete' ? 'error' : 'success');
    set({ result: r, progress: p, screen: { name: 'review' } });
  },

  quit: () => {
    const { inst } = get();
    const mod = inst ? scenarioById(get().defId!)?.module : undefined;
    set({ inst: null, world: null, result: null, shell: null, defId: null });
    get().go(mod ? { name: 'module', module: mod } : { name: 'menu' });
  },

  setPanel: (panel) => set({ panel }),
  toggleTerminal: (open) => set({ terminalOpen: open ?? !get().terminalOpen }),
  setView: (view) => set({ view }),
  select: (sel) => set({ sel }),
  setPendingPort: (pendingPort) => set({ pendingPort }),
  setPaused: (paused) => set({ paused }),
  dismissBriefing: () => set({ showBriefing: false }),
  useHint: () => set({ hintsUsed: get().hintsUsed + 1 }),
  updateSettings: (s) => {
    const p = { ...get().progress, settings: { ...get().progress.settings, ...s } };
    saveProgress(p);
    set({ progress: p });
  },
  unlockCodex: (id) => {
    const p = get().progress;
    if (p.codex.includes(id)) return;
    const np = { ...p, codex: [...p.codex, id] };
    saveProgress(np);
    set({ progress: np });
  },
  resetProgress: () => {
    const p = { ...loadProgress(), scenarios: {}, history: [], codex: [] };
    saveProgress(p);
    set({ progress: p });
  },
}));

/** Convenience hook for the live world (non-null inside the play screen). */
export function useWorld<T>(sel: (w: World) => T): T {
  return useStore((s) => sel(s.world!));
}

// Exposed for debugging and the E2E smoke tests (scripts/*.mjs).
(window as unknown as { __DCT__?: typeof useStore }).__DCT__ = useStore;
