import type { Finding, Step } from '../engine/scenario';
import type { World } from '../engine/types';

export function findingStep(id: string, text: string, points = 10, why?: string): Step {
  return { id: `finding_${id}`, text, why, points, required: true, done: (w: World) => !!w.flags[`finding:${id}:ok`] };
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/^\/dev\//, '').replace(/\s+/g, ' ');

export function eqAny(input: string, answers: string[]): boolean {
  const n = norm(input);
  return answers.some((a) => n === norm(a) || n.includes(norm(a)));
}

export function finding(id: string, prompt: string, answers: string[] | ((s: string, w: World) => boolean), explain: string, placeholder?: string): Finding {
  return {
    id,
    prompt,
    placeholder,
    explain,
    check: typeof answers === 'function' ? answers : (s) => eqAny(s, answers),
  };
}

export function worklogStep(key: string, mustContain: Array<string | RegExp>, text = 'Document your findings and actions in a worklog', points = 10): Step {
  return {
    id: 'worklog',
    text,
    why: 'If it is not in the ticket, it did not happen. The next shift, the vendor and the auditors all read your worklog.',
    points,
    required: true,
    done: (w) =>
      w.tickets[key]?.worklogs.some(
        (l) => l.author === w.trainee.name && l.kind === 'worklog' && mustContain.every((m) => (typeof m === 'string' ? l.text.toUpperCase().includes(m.toUpperCase()) : m.test(l.text))),
      ) ?? false,
  };
}

export function statusStep(key: string, status: string, text?: string, points = 5, required = true): Step {
  return { id: `status_${status.replace(/\s/g, '_')}`, text: text ?? `Move ${key} to ${status}`, points, required, done: (w) => !!w.flags[`ticket:${key}:${status}`] };
}

export function noPenaltyStep(id: string, rule: string | string[], text: string, why: string, points = 10): Step {
  const rules = Array.isArray(rule) ? rule : [rule];
  return { id, text, why, points, required: false, guard: true, done: (w) => !w.penalties.some((p) => rules.includes(p.rule)) };
}
