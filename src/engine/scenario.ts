// Scenario contract + scoring.
import type { CableType, PortRef, World } from './types';

export type Mode = 'learn' | 'practice' | 'challenge';

export type ModuleId =
  | 'hardware'
  | 'cabling'
  | 'rackstack'
  | 'oob'
  | 'linux'
  | 'troubleshoot'
  | 'ticketing'
  | 'safety'
  | 'floor'
  | 'shift'
  // vendor tracks
  | 'dell'
  | 'hpe'
  | 'supermicro'
  | 'lenovo';

export type ToolId = 'ticket' | 'terminal' | 'bmc' | 'assets' | 'parts' | 'notes' | 'floor' | 'cutsheet' | 'pdu';
export type SceneId = 'rack' | 'floor' | 'rackbuild' | 'rj45' | 'fiber' | 'hazard' | 'triage' | 'quiz' | 'none';

/** Where the coach points: a device/part in 3D (with the aisle you must stand in), or a tool panel. */
export interface CoachTarget {
  deviceId?: string;
  rackId?: string;
  /** Selection/highlight key: a slot id, "layer:lid", "heatsink:CPU0", "fastener:<target>:<id>", "cord:PSU1", "power", "chassis". */
  sel?: string;
  side?: 'front' | 'rear';
  tool?: ToolId;
  /** DCO workroom object: 'laptop', 'rma', 'shelf:<kind>'. */
  room?: string;
}

/** One physical/UI micro-action in the coach checklist. */
export interface CoachLine {
  text: string;
  done: boolean;
  target?: CoachTarget;
}

export interface Step {
  id: string;
  text: string;
  /** Shown in Learn mode: why this step matters in the real world. */
  why?: string;
  /** Short nudge used for Practice-mode hints. */
  hint?: string;
  points: number;
  required: boolean;
  /** "Don't break this" rule: shown with a shield and only scored once real progress is made. */
  guard?: boolean;
  done: (w: World) => boolean;
  /** Hand-holding: the micro-actions that make up this step, computed from the live world. */
  coach?: (w: World) => CoachLine[];
}

export interface ScenarioInstance {
  world: World;
  title: string;
  briefing: string;
  steps: Step[];
  tools: ToolId[];
  scene: SceneId;
  /** Which tool should open first. */
  startTool?: ToolId;
  focusDeviceId?: string;
  focusRackId?: string;
  rootCause: string;
  expertPath: string[];
  timeLimitSec?: number;
  /** Data for benches/forms (RJ45, quiz items, hazards, findings…) */
  bench?: Bench;
}

/** Typed answer the trainee submits in the Findings panel. */
export interface Finding {
  id: string;
  prompt: string;
  placeholder?: string;
  check: (input: string, w: World) => boolean;
  explain: string;
}

export interface QuizItem {
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export type HazardKind = 'tile' | 'cart' | 'zipties' | 'door' | 'drink' | 'cable' | 'blanking' | 'ladder' | 'drive' | 'box' | 'badge' | 'epo' | 'spill' | 'extended' | 'cardboard';

export interface Hazard {
  id: string;
  kind: HazardKind;
  label: string;
  why: string;
  pos: [number, number, number];
}

export interface CutsheetRow {
  a: PortRef;
  b: PortRef;
  aLabel: string;
  bLabel: string;
  cableType: CableType;
  lengthM: number;
}

export interface BuildRow {
  deviceId: string;
  u: number;
  note: string;
}

export interface Bench {
  findings?: Finding[];
  quiz?: QuizItem[];
  quizPass?: number;
  hazards?: Hazard[];
  triage?: { keys: string[]; expected: string[]; explain: string };
  cutsheet?: CutsheetRow[];
  build?: BuildRow[];
  rj45?: { standard: 'A' | 'B'; bothEnds: boolean };
  fiber?: { cableId: string; dirty: boolean; polarityFlipped: boolean };
  floor?: { targets: string[] };
  /** Rack the build/cabling scene focuses on. */
  rackId?: string;
}

export interface ScenarioDef {
  id: string;
  module: ModuleId;
  title: string;
  summary: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  /** Approx. minutes per rep */
  minutes: number;
  build: (seed: number, mode: Mode) => ScenarioInstance;
}

export interface StepResult {
  id: string;
  text: string;
  done: boolean;
  points: number;
  required: boolean;
  guard?: boolean;
}

export interface ScoreResult {
  steps: StepResult[];
  earned: number;
  possible: number;
  penaltyPoints: number;
  safetyViolations: number;
  timeBonus: number;
  pct: number;
  allRequired: boolean;
  rating: 'Gold' | 'Silver' | 'Bronze' | 'Incomplete';
}

export function evaluate(inst: ScenarioInstance, mode: Mode, elapsedSec?: number): ScoreResult {
  const w = inst.world;
  const raw = inst.steps.map((s) => {
    let done = false;
    try {
      done = s.done(w);
    } catch {
      done = false;
    }
    return { id: s.id, text: s.text, done, points: s.points, required: s.required, guard: s.guard };
  });
  // Guard rules only pay out once at least half the required work is done (no free points for idling).
  const req = raw.filter((s) => s.required && !s.guard);
  const progress = req.length ? req.filter((s) => s.done).length / req.length : 1;
  const steps = raw.map((s) => (s.guard && progress < 0.5 ? { ...s, done: false } : s));
  const possible = steps.reduce((a, s) => a + s.points, 0) || 1;
  const earned = steps.filter((s) => s.done).reduce((a, s) => a + s.points, 0);
  const penaltyPoints = w.penalties.reduce((a, p) => a + p.points, 0);
  const safetyViolations = w.penalties.filter((p) => p.safety).length;
  const allRequired = steps.filter((s) => s.required).every((s) => s.done);
  let timeBonus = 0;
  if (mode === 'challenge' && inst.timeLimitSec && elapsedSec !== undefined && allRequired) {
    const frac = 1 - elapsedSec / inst.timeLimitSec;
    timeBonus = Math.max(0, Math.round(frac * 10));
  }
  const pct = Math.max(0, Math.min(100, Math.round(((earned - penaltyPoints) / possible) * 100) + timeBonus));
  let rating: ScoreResult['rating'] = 'Incomplete';
  if (allRequired) {
    if (pct >= 90 && safetyViolations === 0) rating = 'Gold';
    else if (pct >= 75) rating = 'Silver';
    else if (pct >= 40) rating = 'Bronze';
  }
  return { steps, earned, possible, penaltyPoints, safetyViolations, timeBonus, pct, allRequired, rating };
}

// ---------- flag helpers for step predicates ----------

export function f(w: World, name: string) {
  return w.flags[name];
}
/** Flag `b` was set (last) after flag `a` was first set. */
export function after(w: World, a: string, b: string): boolean {
  const fa = w.flags[a];
  const fb = w.flags[b];
  return !!fa && !!fb && fb.last >= fa.first;
}
export function anyFlag(w: World, prefix: string): boolean {
  return Object.keys(w.flags).some((k) => k.startsWith(prefix));
}
export function flagAfter(w: World, prefix: string, t: number): boolean {
  return Object.entries(w.flags).some(([k, v]) => k.startsWith(prefix) && v.last >= t);
}
