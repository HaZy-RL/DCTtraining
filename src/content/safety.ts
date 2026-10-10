// M8 — Safety, security & process.
import { createEmptyWorld } from '../engine/factory';
import { Rng } from '../engine/rng';
import type { Hazard, QuizItem, ScenarioDef } from '../engine/scenario';

export const ALL_HAZARDS: Hazard[] = [
  { id: 'tile', kind: 'tile', label: 'Raised-floor tile left open', why: 'A 60 cm hole in the floor is a fall hazard, and it disrupts under-floor airflow. Replace it, or barricade it while you work.', pos: [-1.5, 0, 0.3] },
  { id: 'drink', kind: 'drink', label: 'Coffee cup sitting on a server', why: 'No food or drink on the data hall floor. One spill can short a running server.', pos: [0.62, 2.06, -1.35] },
  { id: 'cardboard', kind: 'cardboard', label: 'Cardboard boxes in the data hall', why: 'Cardboard sheds fibers that clog filters and adds fire load. Unbox in the staging room.', pos: [2.4, 0, 0.45] },
  { id: 'cable', kind: 'cable', label: 'Power cord stretched across the aisle', why: 'Trip hazard, and someone will yank it out of a server. Use overhead trays or cable covers.', pos: [0.9, 0.02, 0] },
  { id: 'blanking', kind: 'blanking', label: 'Missing blanking panels', why: 'Open U\'s let hot exhaust recirculate to the cold aisle and raise inlet temperatures for the whole rack.', pos: [-0.6, 1.2, -1.06] },
  { id: 'ladder', kind: 'ladder', label: 'Open step-ladder left unattended', why: 'Close it and put it away. Ladders get knocked into racks and people.', pos: [2.0, 0, -0.35] },
  { id: 'drive', kind: 'drive', label: 'Loose hard drive left on top of a rack', why: 'Data-bearing devices must stay in your custody or in the locked destruction bin. An unattended drive is a security incident.', pos: [-1.2, 2.04, -1.5] },
  { id: 'extended', kind: 'extended', label: 'Two servers extended from the same rack', why: 'Extending more than one server at a time can tip an unbolted rack. One at a time.', pos: [1.2, 0.9, 0.75] },
  { id: 'epo', kind: 'epo', label: 'EPO button cover missing', why: 'Emergency Power Off kills the whole room. Its cover stops accidental presses. Report it to Facilities immediately.', pos: [-3.42, 1.4, 0.2] },
  { id: 'door', kind: 'door', label: 'Hot-aisle containment door propped open', why: 'An open containment door mixes hot and cold air and defeats the cooling design.', pos: [3.4, 0, 0] },
  { id: 'spill', kind: 'spill', label: 'Liquid puddle under a rack', why: 'It could be a CRAH/CDU coolant leak or condensation. Don\'t touch it: report it to Facilities and keep people clear.', pos: [-0.4, 0.005, 0.6] },
  { id: 'badge', kind: 'badge', label: 'Badge-access door wedged open', why: 'A propped secure door lets anyone tailgate in. Close it and report it to Security.', pos: [-3.42, 0, -0.8] },
];

const QUIZ: QuizItem[] = [
  { q: 'What weight is the usual one-person lift limit for racking equipment?', options: ['10 kg', '23 kg (≈50 lb)', '40 kg', 'No limit with good technique'], answer: 1, why: 'About 23 kg is the common NIOSH-derived limit. Over that, use two people or a lift.' },
  { q: 'Someone you don\'t recognize follows you through a badge door. You…', options: ['Hold the door: being polite matters', 'Ask them to badge in themselves; if they can\'t, don\'t let them in and call Security', 'Ignore it', 'Let them in if they are carrying a box'], answer: 1, why: 'Tailgating is one of the most common physical-security failures. Everyone badges, every time.' },
  { q: 'A failed HDD from a customer server should go…', options: ['In the RMA box back to the vendor', 'In e-waste', 'In the locked secure destruction bin, with its serial logged', 'Home with you for analysis'], answer: 2, why: 'Data-bearing media never leaves the site intact. It is shredded or degaussed with chain of custody.' },
  { q: 'The big red EPO button by the door is for…', options: ['Resetting a tripped rack PDU', 'Life-safety emergencies only: it cuts power to the entire room', 'Turning off the lights', 'Silencing alarms'], answer: 1, why: 'Pressing EPO drops every server in the hall. Only in an emergency (fire, electrocution).' },
  { q: 'Hot aisles can exceed 40 °C and sound levels can exceed 85 dB. You should…', options: ['Work as normal', 'Wear hearing protection and limit time, hydrate', 'Open the containment doors to cool it down', 'Turn off nearby servers'], answer: 1, why: 'Prolonged exposure above 85 dB damages hearing.' },
  { q: 'The fire suppression alarm sounds (clean-agent / gas system). You…', options: ['Finish your current task first', 'Evacuate immediately via the nearest exit and do not re-enter', 'Look for the fire', 'Hold the abort button and keep working'], answer: 1, why: 'Clean-agent discharge is loud and the environment is unsafe. Get out.' },
  { q: 'Before handling a DIMM you should…', options: ['Touch the server frame once', 'Wear an ESD wrist strap clipped to bare chassis metal, with power removed', 'Rub your hands on the carpet', 'Only use gloves'], answer: 1, why: 'ESD damage is often invisible and latent.' },
  { q: 'Taking photos on the data hall floor is…', options: ['Fine for training', 'Prohibited unless approved, because it can expose customer and security information', 'Required for every ticket', 'Only banned at night'], answer: 1, why: 'Rack labels, layouts and badges are sensitive.' },
  { q: 'You see a small puddle of liquid under a cooling unit. You…', options: ['Mop it up', 'Keep clear, report it to Facilities, and don\'t touch it', 'Ignore it', 'Put cardboard over it'], answer: 1, why: 'It could be glycol or coolant, or a sign of electrical risk.' },
  { q: 'How many servers should be extended (slid out on rails) at once in one rack?', options: ['As many as needed', 'One', 'Two max', 'Only the top half'], answer: 1, why: 'Rack tip-over risk.' },
  { q: 'A ticket asks you to reboot a host that\'s still in production. You…', options: ['Reboot it, the ticket says so', 'Request a drain/release from the service owner first', 'Pull the power cords', 'Power-cycle via the BMC'], answer: 1, why: 'A drain prevents customer impact.' },
  { q: 'Raised-floor tiles should be…', options: ['Left open while you work all shift', 'Opened only with a barricade, and replaced as soon as possible', 'Stacked in the aisle', 'Cut to fit cables'], answer: 1, why: 'Fall hazard and airflow loss.' },
];

export const safetyScenarios: ScenarioDef[] = [
  {
    id: 'sf-hazards',
    module: 'safety',
    title: 'Spot the hazards',
    summary: 'Walk a 3D aisle and find the safety and security hazards. Click a thing to flag it.',
    difficulty: 1,
    tags: ['safety', 'security', 'housekeeping'],
    minutes: 5,
    build: (seed) => {
      const rng = new Rng(seed);
      const hazards = rng.shuffle(ALL_HAZARDS).slice(0, 8);
      const w = createEmptyWorld(seed);
      return {
        world: w,
        title: 'Spot the hazards',
        briefing: 'Eight hazards are hidden in this aisle. Orbit the camera and click anything that is unsafe or insecure. Wrong guesses count against you.',
        steps: [
          { id: 'found6', text: 'Find at least 6 of the 8 hazards', points: 30, required: true, done: (ww) => hazards.filter((h) => ww.flags[`hazard:${h.id}`]).length >= 6 },
          { id: 'found8', text: 'Find all 8', points: 10, required: false, done: (ww) => hazards.every((h) => ww.flags[`hazard:${h.id}`]) },
          { id: 'misses', text: 'No more than 3 wrong guesses', points: 10, required: false, guard: true, done: (ww) => (ww.flags['hazard:miss']?.count ?? 0) <= 3 },
        ],
        tools: ['notes'],
        scene: 'hazard',
        rootCause: hazards.map((h) => h.label).join('; '),
        expertPath: hazards.map((h) => `${h.label}: ${h.why}`),
        bench: { hazards },
      };
    },
  },
  {
    id: 'sf-quiz',
    module: 'safety',
    title: 'Safety & security knowledge check',
    summary: 'Ten randomized questions on lifting, ESD, EPO, tailgating, fire suppression and data-bearing media.',
    difficulty: 1,
    tags: ['quiz', 'safety', 'security'],
    minutes: 5,
    build: (seed) => {
      const rng = new Rng(seed);
      const quiz = rng.shuffle(QUIZ).slice(0, 10);
      return {
        world: createEmptyWorld(seed),
        title: 'Safety & security knowledge check',
        briefing: 'Answer at least 8 of 10 correctly.',
        steps: [{ id: 'quiz', text: 'Score at least 8/10', points: 50, required: true, done: (w) => Object.keys(w.flags).filter((k) => k.startsWith('quiz:') && k.endsWith(':correct')).length >= 8 }],
        tools: ['notes'],
        scene: 'quiz',
        rootCause: 'Knowledge check.',
        expertPath: quiz.map((x) => `${x.q} → ${x.options[x.answer]}`),
        bench: { quiz, quizPass: 8 },
      };
    },
  },
];
