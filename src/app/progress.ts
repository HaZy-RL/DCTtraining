// Browser-local progress + settings. Wrapped in try/catch so private windows still work.
import type { Mode, ScoreResult } from '../engine/scenario';

export interface AttemptRecord {
  scenarioId: string;
  mode: Mode;
  seed: number;
  at: number; // epoch ms
  pct: number;
  rating: ScoreResult['rating'];
  simSeconds: number;
  penalties: number;
  safety: number;
}

export interface ScenarioProgress {
  attempts: number;
  bestPct: number;
  bestRating: ScoreResult['rating'] | null;
  completed: boolean;
}

export interface Settings {
  name: string;
  sound: boolean;
  speed: number; // sim seconds per real second
  reducedMotion: boolean;
  quality: 'high' | 'low';
}

export interface ProgressData {
  version: 1;
  scenarios: Record<string, ScenarioProgress>;
  history: AttemptRecord[];
  codex: string[];
  settings: Settings;
}

const KEY = 'dct-training-progress-v1';

export const DEFAULT_SETTINGS: Settings = { name: 'You', sound: true, speed: 1, reducedMotion: false, quality: 'high' };

function empty(): ProgressData {
  return { version: 1, scenarios: {}, history: [], codex: [], settings: { ...DEFAULT_SETTINGS } };
}

export function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as ProgressData;
    return { ...empty(), ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } };
  } catch {
    return empty();
  }
}

export function saveProgress(p: ProgressData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — progress lives for this session only */
  }
}

const RANK = { Gold: 3, Silver: 2, Bronze: 1, Incomplete: 0 } as const;

export function recordAttempt(p: ProgressData, a: AttemptRecord): ProgressData {
  const prev = p.scenarios[a.scenarioId] ?? { attempts: 0, bestPct: 0, bestRating: null, completed: false };
  const better = !prev.bestRating || RANK[a.rating] > RANK[prev.bestRating] || (RANK[a.rating] === RANK[prev.bestRating] && a.pct > prev.bestPct);
  return {
    ...p,
    scenarios: {
      ...p.scenarios,
      [a.scenarioId]: {
        attempts: prev.attempts + 1,
        bestPct: Math.max(prev.bestPct, a.pct),
        bestRating: better ? a.rating : prev.bestRating,
        completed: prev.completed || a.rating !== 'Incomplete',
      },
    },
    history: [a, ...p.history].slice(0, 200),
  };
}

export function exportProgress(p: ProgressData): string {
  return JSON.stringify(p, null, 2);
}

// ---------- gamification: XP, levels, ranks, streaks, badges ----------

export const RATING_XP = { Gold: 300, Silver: 200, Bronze: 120, Incomplete: 20 } as const;

export interface Rank {
  level: number;
  title: string;
  xp: number;
  /** XP at the start of this level and of the next. */
  floor: number;
  next: number;
}

const TITLES: Array<[number, string]> = [
  [1, 'Badge Holder'],
  [2, 'Cart Pusher'],
  [3, 'Cable Wrangler'],
  [4, 'DCT I'],
  [6, 'DCT II'],
  [8, 'DCT III'],
  [10, 'Senior DCT'],
  [12, 'Lead Tech'],
  [14, 'Datacenter Legend'],
];

const levelFloor = (n: number) => 75 * n * (n - 1); // L1 0, L2 150, L3 450, L4 900…

export function rankOf(p: ProgressData): Rank {
  let xp = 0;
  for (const s of Object.values(p.scenarios)) xp += s.bestRating ? RATING_XP[s.bestRating] : 0;
  xp += Math.min(p.history.length, 200) * 10;
  let level = 1;
  while (levelFloor(level + 1) <= xp) level++;
  const title = [...TITLES].reverse().find(([l]) => level >= l)![1];
  return { level, title, xp, floor: levelFloor(level), next: levelFloor(level + 1) };
}

/** Consecutive days (ending today or yesterday) with at least one rep. */
export function streakDays(p: ProgressData): number {
  const days = new Set(p.history.map((h) => new Date(h.at).toDateString()));
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export interface Badge {
  id: string;
  icon: string;
  name: string;
  how: string;
  earned: boolean;
}

export function badgesOf(p: ProgressData, ctx: { moduleOf: (scenarioId: string) => string | undefined; hardwareIds: string[] }): Badge[] {
  const passed = p.history.filter((h) => h.rating !== 'Incomplete');
  const golds = Object.values(p.scenarios).filter((s) => s.bestRating === 'Gold').length;
  const modules = new Set(p.history.map((h) => ctx.moduleOf(h.scenarioId)).filter(Boolean));
  const b = (id: string, icon: string, name: string, how: string, earned: boolean): Badge => ({ id, icon, name, how, earned });
  return [
    b('first', '🎓', 'First Shift', 'Pass any scenario', passed.length > 0),
    b('gold', '🥇', 'Gold Standard', 'Earn a Gold rating', golds > 0),
    b('safe', '🦺', 'Safety First', 'Pass 5 runs with zero safety violations', passed.filter((h) => h.safety === 0).length >= 5),
    b('explorer', '🧭', 'Explorer', 'Try scenarios in 5 different modules', modules.size >= 5),
    b('clock', '⏱️', 'Beat the Clock', 'Pass a Challenge-mode run', passed.some((h) => h.mode === 'challenge')),
    b('perfect', '💯', 'Perfectionist', 'Score 100% on any run', p.history.some((h) => h.pct >= 100)),
    b('streak', '🔥', 'On a Roll', 'Train 3 days in a row', streakDays(p) >= 3),
    b('wrench', '🔧', 'Wrench Wizard', 'Pass every hardware replacement drill', ctx.hardwareIds.every((id) => p.scenarios[id]?.completed)),
    b('scholar', '📚', 'Scholar', 'Unlock 10 codex entries', p.codex.length >= 10),
    b('legend', '🏆', 'Hall of Fame', 'Earn 10 Gold ratings', golds >= 10),
  ];
}

/** 0–3 stars for a scenario's best result. */
export function starsFor(s: ScenarioProgress | undefined): number {
  if (!s?.bestRating) return 0;
  return s.bestRating === 'Gold' ? 3 : s.bestRating === 'Silver' ? 2 : s.bestRating === 'Bronze' ? 1 : 0;
}
