// M9 — Floor navigation & location codes.
import { createEmptyWorld, createRack, SITE } from '../engine/factory';
import { Rng } from '../engine/rng';
import type { QuizItem, ScenarioDef, Step } from '../engine/scenario';

export const FLOOR_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const FLOOR_RACKS_PER_ROW = 14;

export function floorWorld(seed: number) {
  const w = createEmptyWorld(seed);
  for (const row of FLOOR_ROWS) for (let p = 1; p <= FLOOR_RACKS_PER_ROW; p++) {
    const r = createRack(row, p);
    w.racks[r.id] = r;
  }
  return w;
}

const CODES_QUIZ: QuizItem[] = [
  { q: `Location code ${SITE}-H2-C07-U22. What does "C07" mean?`, options: ['Cage 7', 'Row C, rack position 07', 'Column 7 of hall C', 'Circuit 7'], answer: 1, why: 'Site → Hall → Row+Rack → U.' },
  { q: 'U numbering in a standard rack starts…', options: ['At the top (U1 = top)', 'At the bottom (U1 = bottom)', 'In the middle', 'It varies per server'], answer: 1, why: 'U1 is the bottom on EIA-310 racks; always double-check the rack\'s printed U labels.' },
  { q: 'A 2U server "at U22" occupies…', options: ['U22 and U23', 'U21 and U22', 'U22 only', 'U20–U22'], answer: 0, why: 'The location is the LOWEST U it occupies.' },
  { q: 'You stand in the cold aisle. You are looking at the…', options: ['Rear of the servers (PSUs, cables)', 'Front of the servers (drive bays, bezels)', 'Top of the racks', 'PDUs'], answer: 1, why: 'Servers take in cold air at the front and exhaust hot air out the back into the hot aisle.' },
  { q: 'Where do you usually do PSU, cabling and PDU work?', options: ['Cold aisle', 'Hot aisle (rear)', 'Under the floor', 'From the NOC'], answer: 1, why: 'PSUs, NIC ports and PDUs are at the rear, which faces the hot aisle.' },
  { q: 'The quickest reliable way to find one server in a row of identical racks is…', options: ['Count from the end of the row', 'Trust the hostname', 'Light its locate (UID) LED through the BMC and look for the blue blink', 'Ask a coworker'], answer: 2, why: 'The locate LED is tied to the physical box, not to stale records.' },
];

export const floorScenarios: ScenarioDef[] = [
  {
    id: 'fl-find',
    module: 'floor',
    title: 'Find the rack',
    summary: 'Read a location code and walk to the right rack on a 3D hall map. Five codes, against the clock.',
    difficulty: 1,
    tags: ['location-codes', 'navigation', 'speed'],
    minutes: 3,
    build: (seed) => {
      const rng = new Rng(seed);
      const w = floorWorld(seed);
      const ids = rng.shuffle(Object.keys(w.racks)).slice(0, 5);
      return {
        world: w,
        title: 'Find the rack',
        briefing: `Hall H2 has rows A–F and ${FLOOR_RACKS_PER_ROW} racks per row. For each location code, click the matching rack on the floor.`,
        steps: ids.map((id, i): Step => ({ id: `t${i}`, text: `Find ${w.racks[id].location}`, points: 10, required: true, done: (ww) => !!ww.flags[`floor:found:${i}`] })).concat([
          { id: 'acc', text: 'No more than 2 wrong racks clicked', points: 10, required: false, guard: true, done: (ww) => (ww.flags['floor:miss']?.count ?? 0) <= 2 },
        ]),
        tools: ['notes'],
        scene: 'floor',
        rootCause: 'Navigation drill.',
        expertPath: ['Row letter → aisle, then count rack positions from the row-end label'],
        timeLimitSec: 180,
        bench: { floor: { targets: ids } },
      };
    },
  },
  {
    id: 'fl-codes',
    module: 'floor',
    title: 'Location codes, U numbering & aisles',
    summary: 'Quick knowledge check on how locations, U positions and hot/cold aisles work.',
    difficulty: 1,
    tags: ['quiz', 'u-numbering', 'aisles'],
    minutes: 3,
    build: (seed) => ({
      world: floorWorld(seed),
      title: 'Location codes, U numbering & aisles',
      briefing: 'Get at least 5 of 6.',
      steps: [{ id: 'quiz', text: 'Score at least 5/6', points: 50, required: true, done: (w) => Object.keys(w.flags).filter((k) => k.startsWith('quiz:') && k.endsWith(':correct')).length >= 5 }],
      tools: ['notes'],
      scene: 'quiz',
      rootCause: 'Knowledge check.',
      expertPath: CODES_QUIZ.map((x) => `${x.q} → ${x.options[x.answer]}`),
      bench: { quiz: new Rng(seed).shuffle(CODES_QUIZ), quizPass: 5 },
    }),
  },
];
