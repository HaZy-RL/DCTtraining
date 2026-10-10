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
