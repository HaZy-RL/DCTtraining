import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const nl = (s: string) => s.replace(/\r?\n/g, '\r\n');

export function TerminalDock() {
  const shell = useStore((s) => s.shell)!;
  const open = useStore((s) => s.terminalOpen);
  const toggle = useStore((s) => s.toggleTerminal);
  const unlock = useStore((s) => s.unlockCodex);
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [tall, setTall] = useState(false);
  const [where, setWhere] = useState(shell.frame.hostLabel);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: `ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'DCT Emoji'`,
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: { background: '#05080c', foreground: '#d6e2ee', cursor: '#4fd1c5', selectionBackground: '#2a4a5a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* hidden */
    }
    term.writeln('\x1b[1;36mDCO laptop — you are already connected to the jump host (dco-jump01).\x1b[0m');
    term.writeln('\x1b[2mType "help" for the command cheat-sheet. Tab completes. ↑/↓ history.\x1b[0m');
    let buf = '';
    let hIdx = -1;
    const prompt = () => {
      term.write(shell.prompt());
      setWhere(shell.frame.hostLabel + (shell.raw ? ' (console)' : ''));
    };
    prompt();
    const redraw = () => {
      term.write('\r\x1b[2K' + shell.prompt() + buf);
    };
    const sub = term.onData((data) => {
      if (shell.raw) {
        const out = shell.key(data);
        if (out) term.write(nl(out));
        if (!shell.raw) prompt();
        return;
      }
      for (const ch of data.length > 1 && !data.startsWith('\x1b') ? data.split('') : [data]) {
        if (ch === '\r') {
          term.write('\r\n');
          const line = buf;
          buf = '';
          hIdx = -1;
          const out = shell.exec(line);
          if (out) term.write(nl(out) + '\r\n');
          if (shell.raw) {
            const t = shell.tick();
            if (t) term.write(nl(t));
            setWhere(shell.frame.hostLabel + ' (console)');
          } else prompt();
        } else if (ch === '\x7f' || ch === '\b') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            term.write('\b \b');
          }
        } else if (ch === '\x03') {
          term.write('^C\r\n');
          buf = '';
          prompt();
        } else if (ch === '\x0c') {
          term.clear();
          redraw();
        } else if (ch === '\t') {
          const opts = shell.complete(buf);
          if (opts.length === 1) {
            const toks = buf.split(/\s+/);
            toks[toks.length - 1] = opts[0];
            buf = toks.join(' ') + (toks.length === 1 ? ' ' : '');
            redraw();
          } else if (opts.length > 1) {
            term.write('\r\n' + opts.join('  ') + '\r\n');
            redraw();
          }
        } else if (ch === '\x1b[A') {
          const h = shell.history;
          if (!h.length) continue;
          hIdx = hIdx < 0 ? h.length - 1 : Math.max(0, hIdx - 1);
          buf = h[hIdx];
          redraw();
        } else if (ch === '\x1b[B') {
          const h = shell.history;
          if (hIdx < 0) continue;
          hIdx++;
          buf = hIdx >= h.length ? '' : h[hIdx];
          if (hIdx >= h.length) hIdx = -1;
          redraw();
        } else if (ch.startsWith('\x1b')) {
          /* ignore other escapes in line mode */
        } else if (ch >= ' ') {
          buf += ch;
          term.write(ch);
        }
      }
    });
    const raw = window.setInterval(() => {
      if (shell.raw) {
        const out = shell.tick();
        if (out) term.write(nl(out));
      }
    }, 500);
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(host.current!);
    unlock('tool:terminal');
    return () => {
      sub.dispose();
      window.clearInterval(raw);
      ro.disconnect();
      term.dispose();
    };
  }, [shell, unlock]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        termRef.current?.focus();
      }, 30);
    }
  }, [open, tall]);

  return (
    <div className={`term-dock ${open ? '' : 'hidden'} ${tall ? 'tall' : ''}`}>
      <div className="term-head">
        <span>⌨️ Terminal: {where}</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => setTall(!tall)}>
          {tall ? '▾ Shorter' : '▴ Taller'}
        </button>
        <button className="btn ghost sm" onClick={() => toggle(false)}>
          ✕
        </button>
      </div>
      <div className="term-body" ref={host} onClick={() => termRef.current?.focus()} />
    </div>
  );
}
