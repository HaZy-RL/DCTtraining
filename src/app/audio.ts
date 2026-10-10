// Tiny WebAudio synth: no audio assets needed.
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.05, delay = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(a.destination);
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(kind: 'click' | 'error' | 'warn' | 'success' | 'beep') {
  switch (kind) {
    case 'click':
      tone(1800, 0.03, 'square', 0.015);
      break;
    case 'error':
      tone(160, 0.18, 'sawtooth', 0.04);
      break;
    case 'warn':
      tone(440, 0.12, 'triangle', 0.05);
      tone(330, 0.16, 'triangle', 0.05, 0.12);
      break;
    case 'success':
      tone(660, 0.1, 'sine', 0.05);
      tone(880, 0.12, 'sine', 0.05, 0.1);
      tone(1320, 0.18, 'sine', 0.04, 0.2);
      break;
    case 'beep':
      tone(1000, 0.2, 'square', 0.03);
      break;
  }
}
