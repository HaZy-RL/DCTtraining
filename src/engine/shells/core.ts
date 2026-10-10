// Simulated shell core: tokenizer, pipes, text filters and the frame stack
// (laptop → jump host → server / BMC / switch / SOL console).
import type { Action, ActionResult } from '../actions';
import type { World } from '../types';

export interface SimApi {
  getWorld(): World;
  dispatch(a: Action): ActionResult;
}

export type FrameKind = 'laptop' | 'jump' | 'host' | 'bmc' | 'switch' | 'sol' | 'bios';

export interface Frame {
  kind: FrameKind;
  deviceId?: string;
  user: string;
  hostLabel: string;
  cwd: string;
  /** Raw-mode frames (SOL/BIOS) render a screen and consume keys. */
  raw?: boolean;
  /** Frame-local state (BIOS cursor, SOL scrollback position…) */
  state?: Record<string, unknown>;
}

export interface CmdCtx {
  api: SimApi;
  w: World;
  frame: Frame;
  session: ShellSession;
  args: string[];
  /** stdin from a pipe */
  stdin?: string;
  sudo: boolean;
}

export interface CmdOut {
  out?: string;
  err?: string;
  code?: number;
}

export type Cmd = (ctx: CmdCtx) => CmdOut | string | void;

export interface CommandPack {
  commands: Record<string, Cmd>;
  /** Paths that exist for completion/ls */
  files?: (ctx: Omit<CmdCtx, 'args'>) => Record<string, () => string>;
  help: string;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** Split on unquoted pipes. */
export function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '|') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

// ---------- text filters usable after a pipe on any frame ----------

export const FILTERS: Record<string, (args: string[], input: string) => CmdOut> = {
  grep(args, input) {
    let i = 0;
    let ci = false;
    let inv = false;
    let count = false;
    let ctxAfter = 0;
    while (args[i]?.startsWith('-') && args[i] !== '-') {
      const a = args[i];
      if (a === '-A') {
        ctxAfter = Number(args[i + 1] ?? 0);
        i += 2;
        continue;
      }
      if (a.includes('i')) ci = true;
      if (a.includes('v')) inv = true;
      if (a.includes('c')) count = true;
      i++;
    }
    const pat = args[i];
    if (pat === undefined) return { err: 'Usage: grep [OPTION]... PATTERNS [FILE]...', code: 2 };
    let re: RegExp;
    try {
      re = new RegExp(pat, ci ? 'i' : '');
    } catch {
      re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : '');
    }
    const lines = input.split('\n');
    const out: string[] = [];
    let after = 0;
    for (const l of lines) {
      const m = re.test(l) !== inv;
      if (m) {
        out.push(l);
        after = ctxAfter;
      } else if (after > 0) {
        out.push(l);
        after--;
      }
    }
    if (count) return { out: String(out.length) };
    return { out: out.join('\n'), code: out.length ? 0 : 1 };
  },
  head(args, input) {
    const n = args[0] === '-n' ? Number(args[1]) : args[0]?.startsWith('-') ? Number(args[0].slice(1)) : 10;
    return { out: input.split('\n').slice(0, n).join('\n') };
  },
  tail(args, input) {
    const n = args[0] === '-n' ? Number(args[1]) : args[0]?.startsWith('-') && args[0] !== '-f' ? Number(args[0].slice(1)) : 10;
    const lines = input.replace(/\n$/, '').split('\n');
    return { out: lines.slice(-n).join('\n') };
  },
  wc(args, input) {
    const lines = input === '' ? 0 : input.replace(/\n$/, '').split('\n').length;
    if (args.includes('-l')) return { out: String(lines) };
    return { out: `${lines} ${input.split(/\s+/).filter(Boolean).length} ${input.length}` };
  },
  sort(args, input) {
    const lines = input.split('\n').filter((l) => l !== '');
    lines.sort();
    if (args.includes('-r')) lines.reverse();
    return { out: lines.join('\n') };
  },
  uniq(args, input) {
    const lines = input.split('\n');
    const out: string[] = [];
    const counts: number[] = [];
    for (const l of lines) {
      if (out[out.length - 1] === l) counts[counts.length - 1]++;
      else {
        out.push(l);
        counts.push(1);
      }
    }
    if (args.includes('-c')) return { out: out.map((l, i) => `${String(counts[i]).padStart(7)} ${l}`).join('\n') };
    return { out: out.join('\n') };
  },
  less(_a, input) {
    return { out: input };
  },
  more(_a, input) {
    return { out: input };
  },
  cat(_a, input) {
    return { out: input };
  },
  awk(args, input) {
    const prog = args.join(' ');
    const m = /\{\s*print\s+([$\d, ]+)\s*\}/.exec(prog);
    if (!m) return { err: 'awk: only {print $N} is supported in this simulator', code: 2 };
    const cols = m[1].split(',').map((c) => Number(c.trim().replace('$', '')));
    return {
      out: input
        .split('\n')
        .map((l) => {
          const f = l.trim().split(/\s+/);
          return cols.map((c) => (c === 0 ? l : f[c - 1] ?? '')).join(' ');
        })
        .join('\n'),
    };
  },
};

export function columns(rows: string[][], gap = 2): string {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] + gap))).join('')).join('\n');
}

// ---------- session ----------

export type PackResolver = (frame: Frame) => CommandPack;

export class ShellSession {
  stack: Frame[];
  history: string[] = [];
  api: SimApi;
  resolver: PackResolver;
  /** Raw-mode renderer hooks provided by sol.ts */
  rawHandler?: {
    render: (s: ShellSession, f: Frame) => string;
    key: (s: ShellSession, f: Frame, data: string) => string | void;
  };
  pendingOut: string[] = [];

  constructor(api: SimApi, resolver: PackResolver, start: Frame[]) {
    this.api = api;
    this.resolver = resolver;
    this.stack = start;
  }

  get frame(): Frame {
    return this.stack[this.stack.length - 1];
  }

  push(f: Frame) {
    this.stack.push(f);
  }
  pop(): Frame | undefined {
    if (this.stack.length <= 1) return undefined;
    return this.stack.pop();
  }

  prompt(): string {
    const f = this.frame;
    if (f.raw) return '';
    if (f.kind === 'bmc') return `\x1b[33m${f.user}@${f.hostLabel}\x1b[0m:${f.cwd}> `;
    if (f.kind === 'switch') return `\x1b[36m${f.hostLabel}\x1b[0m# `;
    const color = f.kind === 'host' ? '32' : f.kind === 'jump' ? '35' : '34';
    const sym = f.user === 'root' ? '#' : '$';
    return `\x1b[1;${color}m${f.user}@${f.hostLabel}\x1b[0m:\x1b[1;34m${f.cwd.replace(/^\/home\/[^/]+/, '~')}\x1b[0m${sym} `;
  }

  /** Execute a full command line; returns text to print (with \n line breaks). */
  exec(line: string): string {
    const trimmed = line.trim();
    if (trimmed) {
      this.history.push(trimmed);
      if (this.history.length > 200) this.history.shift();
    }
    if (!trimmed) return '';
    // simple && chaining
    if (trimmed.includes('&&')) {
      const outs: string[] = [];
      for (const part of trimmed.split('&&')) {
        const { text, code } = this.execPipeline(part.trim());
        if (text) outs.push(text);
        if (code !== 0) break;
      }
      return outs.join('\n');
    }
    return this.execPipeline(trimmed).text;
  }

  private execPipeline(line: string): { text: string; code: number } {
    // output redirection (mostly to teach read-only FS / no-op)
    let redirect: string | null = null;
    const rm = /\s(>>?)\s*(\S+)\s*$/.exec(line);
    if (rm) {
      redirect = rm[2];
      line = line.slice(0, rm.index);
    }
    const parts = splitPipes(line);
    let stdin: string | undefined;
    let code = 0;
    let errText = '';
    for (let i = 0; i < parts.length; i++) {
      let toks = tokenize(parts[i]);
      if (!toks.length) continue;
      let sudo = false;
      if (toks[0] === 'sudo') {
        sudo = true;
        toks = toks.slice(1);
        if (toks[0] === '-i' || toks[0] === 'su') {
          return { text: '\x1b[33mInteractive root shells are disabled by policy. Use sudo <command>.\x1b[0m', code: 1 };
        }
      }
      const [name, ...args] = toks;
      if (i > 0 && FILTERS[name]) {
        const r = FILTERS[name](args, stdin ?? '');
        stdin = r.out ?? '';
        code = r.code ?? 0;
        if (r.err) errText += r.err + '\n';
        continue;
      }
      const r = this.run(name, args, stdin, sudo);
      stdin = r.out ?? '';
      if (r.err) errText += r.err + (r.err.endsWith('\n') ? '' : '\n');
      code = r.code ?? 0;
    }
    if (redirect) {
      const f = this.frame;
      const w = this.api.getWorld();
      const dev = f.deviceId ? w.devices[f.deviceId] : undefined;
      if (dev?.os === 'readonly_fs') return { text: `-bash: ${redirect}: Read-only file system`, code: 1 };
      return { text: errText.trimEnd(), code };
    }
    const text = (errText ? errText : '') + (stdin ?? '');
    return { text: text.replace(/\n+$/, ''), code };
  }

  run(name: string, args: string[], stdin: string | undefined, sudo: boolean): CmdOut {
    const frame = this.frame;
    const pack = this.resolver(frame);
    const w = this.api.getWorld();
    const ctx: CmdCtx = { api: this.api, w, frame, session: this, args, stdin, sudo };
    if (name === 'history') return { out: this.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') };
    if (name === 'help' || name === '?') return { out: pack.help };
    const cmd = pack.commands[name];
    if (!cmd) {
      if (FILTERS[name] && stdin === undefined && args.length) {
        // filters with file arg, e.g. `grep foo /var/log/messages`
        const files = pack.files?.({ api: this.api, w, frame, session: this, sudo });
        const file = args[args.length - 1];
        const path = resolvePath(frame.cwd, file);
        if (files && files[path]) return FILTERS[name](args.slice(0, -1), files[path]());
        if (name === 'cat' || name === 'less' || name === 'more' || name === 'head' || name === 'tail') {
          if (files && files[path]) return FILTERS[name](args.slice(0, -1), files[path]());
          return { err: `${name}: ${file}: No such file or directory`, code: 1 };
        }
      }
      if (frame.kind === 'bmc') return { err: `Unknown command "${name}". Type "help".`, code: 127 };
      if (frame.kind === 'switch') return { err: `% Unknown command: ${name}`, code: 127 };
      return { err: `${name}: command not found`, code: 127 };
    }
    try {
      const r = cmd(ctx);
      if (r === undefined) return { out: '' };
      if (typeof r === 'string') return { out: r };
      return r;
    } catch (e) {
      return { err: `simulator error: ${(e as Error).message}`, code: 1 };
    }
  }

  /** Raw-mode keystroke (SOL / BIOS). */
  key(data: string): string {
    const f = this.frame;
    if (!f.raw || !this.rawHandler) return '';
    return (this.rawHandler.key(this, f, data) ?? '') + (this.frame.raw ? this.tick() : '');
  }

  /** Raw-mode periodic render (new SOL output since last tick). */
  tick(): string {
    const f = this.frame;
    if (!f.raw || !this.rawHandler) return '';
    return this.rawHandler.render(this, f);
  }

  get raw(): boolean {
    return !!this.frame.raw;
  }

  complete(line: string): string[] {
    const toks = tokenize(line);
    const pack = this.resolver(this.frame);
    const endsSpace = /\s$/.test(line);
    if (toks.length <= 1 && !endsSpace) {
      const p = toks[0] ?? '';
      return Object.keys(pack.commands)
        .concat(['help', 'history', 'sudo'])
        .filter((c) => c.startsWith(p))
        .sort();
    }
    const last = endsSpace ? '' : toks[toks.length - 1];
    const w = this.api.getWorld();
    const files = pack.files?.({ api: this.api, w, frame: this.frame, session: this, sudo: false }) ?? {};
    const names = new Set<string>();
    for (const p of Object.keys(files)) names.add(p);
    // hostnames are handy completions everywhere
    for (const d of Object.values(w.devices)) names.add(d.hostname);
    return [...names].filter((n) => n.startsWith(last)).sort().slice(0, 50);
  }
}

export function resolvePath(cwd: string, p: string): string {
  if (!p) return cwd;
  if (p.startsWith('~')) p = '/home/dcotech' + p.slice(1);
  const base = p.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return '/' + base.join('/');
}

export function parseFlags(args: string[]): { flags: Set<string>; opts: Record<string, string>; pos: string[] } {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opts[k] = v;
      else flags.add(k);
    } else if (a.startsWith('-') && a.length > 1) {
      flags.add(a.slice(1));
    } else pos.push(a);
  }
  return { flags, opts, pos };
}
