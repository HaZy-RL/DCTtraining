import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { Rng } from '../../engine/rng';
import { useStore } from '../store';

const WIRES = ['W/O', 'O', 'W/G', 'B', 'W/B', 'G', 'W/Br', 'Br'] as const; // T568B
const T568A = ['W/G', 'G', 'W/O', 'B', 'W/B', 'O', 'W/Br', 'Br'];
type Wire = (typeof WIRES)[number];
const COLOR: Record<Wire, [string, string]> = {
  'W/O': ['#f4f4f4', '#ff8a1e'],
  O: ['#ff8a1e', '#ff8a1e'],
  'W/G': ['#f4f4f4', '#34b25a'],
  G: ['#34b25a', '#34b25a'],
  'W/B': ['#f4f4f4', '#2f6fe1'],
  B: ['#2f6fe1', '#2f6fe1'],
  'W/Br': ['#f4f4f4', '#8a5a2b'],
  Br: ['#8a5a2b', '#8a5a2b'],
};
const PAIR: Record<Wire, number> = { 'W/O': 2, O: 2, 'W/G': 3, G: 3, 'W/B': 1, B: 1, 'W/Br': 4, Br: 4 };

type Phase = 'strip' | 'arrange' | 'trim' | 'crimp' | 'done';

function Plug3D({ order, untwist, crimped, stripped }: { order: Wire[]; untwist: number; crimped: boolean; stripped: number }) {
  return (
    <group rotation={[0.35, -0.5, 0]}>
      {/* transparent plug body */}
      <mesh position={[0, 0, 0.9]}>
        <boxGeometry args={[1.18, 0.62, 1.6]} />
        <meshPhysicalMaterial color="#d9f1ff" transparent opacity={0.28} roughness={0.05} transmission={0.6} thickness={0.3} />
      </mesh>
      {/* latch clip (on top = pin 1 on the left when the clip faces away) */}
      <mesh position={[0, 0.38, 0.6]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.36, 0.05, 1.0]} />
        <meshPhysicalMaterial color="#d9f1ff" transparent opacity={0.4} />
      </mesh>
      {/* gold contacts */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-0.49 + i * 0.14, -0.27, 1.55]}>
          <boxGeometry args={[0.04, crimped ? 0.18 : 0.08, 0.3]} />
          <meshStandardMaterial color="#e2b43a" metalness={1} roughness={0.25} />
        </mesh>
      ))}
      {/* wires */}
      {order.map((w, i) => (
        <group key={i}>
          <mesh position={[-0.49 + i * 0.14, -0.05, 1.05]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 1.1, 12]} />
            <meshStandardMaterial color={COLOR[w][0]} />
          </mesh>
          {COLOR[w][0] !== COLOR[w][1] && (
            <mesh position={[-0.49 + i * 0.14, -0.05, 1.05]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.057, 0.057, 0.25, 12]} />
              <meshStandardMaterial color={COLOR[w][1]} />
            </mesh>
          )}
        </group>
      ))}
      {/* untwisted section + jacket */}
      <mesh position={[0, -0.05, 0.5 - untwist / 40]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.1 + untwist / 20, 16]} />
        <meshStandardMaterial color="#222" transparent opacity={0.2} />
      </mesh>
      <mesh position={[0, -0.05, -0.6 - (stripped > 30 ? 0.4 : 0)]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 2, 20]} />
        <meshStandardMaterial color="#2f6fe1" roughness={0.6} />
      </mesh>
    </group>
  );
}

function testCable(a: Wire[], b: Wire[]): { pass: boolean; lines: string[]; verdict: string } {
  const lines: string[] = [];
  let pass = true;
  for (let pin = 0; pin < 8; pin++) {
    const wire = a[pin];
    const farPin = b.indexOf(wire);
    lines.push(`${pin + 1} ──── ${farPin + 1}${farPin !== pin ? '  ✗' : ''}`);
    if (farPin !== pin) pass = false;
  }
  if (!pass) return { pass: false, lines, verdict: 'FAIL: MISWIRE (crossed/reversed pairs)' };
  // straight-through but are the pairs on the right pins? 1-2, 3-6, 4-5, 7-8
  const pairsOk = PAIR[a[0]] === PAIR[a[1]] && PAIR[a[2]] === PAIR[a[5]] && PAIR[a[3]] === PAIR[a[4]] && PAIR[a[6]] === PAIR[a[7]];
  if (!pairsOk) return { pass: false, lines, verdict: 'FAIL: SPLIT PAIR. Continuity is fine, but the twisted pairs are split across pins, so NEXT/crosstalk fails. A simple continuity tester would have "passed" it!' };
  const isB = a.join() === WIRES.join();
  const isA = a.join() === T568A.join();
  if (!isB && !isA) return { pass: false, lines, verdict: 'FAIL: non-standard pinout' };
  return { pass: true, lines, verdict: `PASS: wiremap OK (${isB ? 'T568B' : 'T568A'} straight-through)` };
}

export default function Rj45Bench() {
  const seed = useStore((s) => s.seed);
  const mode = useStore((s) => s.mode);
  const flags = useStore((s) => s.world!.flags);
  const dispatch = useStore((s) => s.dispatch);
  const start = useMemo(() => new Rng(seed).shuffle([...WIRES]) as Wire[], [seed]);
  const [end, setEnd] = useState<'A' | 'B'>('A');
  const [phase, setPhase] = useState<Phase>('strip');
  const [order, setOrder] = useState<Wire[]>(start);
  const [sel, setSel] = useState<number | null>(null);
  const [strip, setStrip] = useState(40);
  const [untwist, setUntwist] = useState(22);
  const [ends, setEnds] = useState<Record<'A' | 'B', Wire[] | null>>({ A: null, B: null });
  const [result, setResult] = useState<ReturnType<typeof testCable> | null>(null);
  const [holding, setHolding] = useState(0);
  const f = (n: string) => dispatch({ type: 'setFlag', name: n });

  const resetEnd = (which: 'A' | 'B') => {
    setEnd(which);
    setPhase('strip');
    setOrder(new Rng(seed + (which === 'B' ? 7 : 0) + Math.round(Math.random() * 1000)).shuffle([...WIRES]) as Wire[]);
    setStrip(40);
    setUntwist(22);
    setResult(null);
  };

  const crimpHold = () => {
    let t = 0;
    const id = window.setInterval(() => {
      t += 100;
      setHolding(t);
      if (t >= 1000) {
        window.clearInterval(id);
        setHolding(0);
        f(`rj45:crimped:${end}`);
        setEnds((e) => ({ ...e, [end]: order }));
        if (end === 'A') resetEnd('B');
        else setPhase('done');
      }
    }, 100);
    const up = () => {
      window.clearInterval(id);
      setHolding(0);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="bench" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 440px)', gap: 16, padding: 0 }}>
      <div style={{ position: 'relative', minHeight: 320 }}>
        <Canvas camera={{ position: [3.4, 2.4, 4.2], fov: 38 }}>
          <color attach="background" args={['#0d1218']} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 4]} intensity={1.2} />
          <Plug3D order={order} untwist={untwist} crimped={!!flags[`rj45:crimped:${end}`] && phase !== 'arrange'} stripped={strip} />
          <OrbitControls makeDefault enablePan={false} target={[0, 0, 0.3]} />
        </Canvas>
        <div className="overlay" style={{ left: 10, top: 10, fontSize: 12 }}>
          <span className="tag">End {end}</span> <span className="tag">{phase}</span>
        </div>
      </div>
      <div style={{ padding: 16, overflow: 'auto' }}>
        <h3>Cat6 termination, end {end}</h3>
        {mode === 'learn' && (
          <div className="card" style={{ fontSize: 12, marginBottom: 10 }}>
            T568B, pin 1→8 with the clip facing away: <b>W/O · O · W/G · B · W/B · G · W/Br · Br</b>
          </div>
        )}
        {phase === 'strip' && (
          <div className="col">
            <b>1. Strip the jacket</b>
            <label>
              Strip length: <b>{strip} mm</b>
              <input type="range" min={10} max={50} value={strip} onChange={(e) => setStrip(Number(e.target.value))} style={{ width: '100%' }} />
            </label>
            <button
              className="btn primary"
              onClick={() => {
                if (strip >= 20 && strip <= 30) f('rj45:strip_ok');
                if (strip >= 20 && strip <= 32) f('rj45:jacket_ok');
                if (strip < 15) dispatch({ type: 'penalty', rule: 'rj45_short_strip', points: 1, reason: 'Stripped too little: there is not enough wire to arrange the pairs', key: end });
                setPhase('arrange');
              }}
            >
              Score & pull the jacket
            </button>
          </div>
        )}
        {phase === 'arrange' && (
          <div className="col">
            <b>2. Untwist and arrange: click two wires to swap them</b>
            <div className="dim" style={{ fontSize: 12 }}>
              Pin 1 ← (clip facing away from you) → Pin 8
            </div>
            <div className="wires">
              {order.map((w, i) => (
                <div
                  key={i}
                  className={`wire ${sel === i ? 'sel' : ''}`}
                  style={{ background: COLOR[w][0] === COLOR[w][1] ? COLOR[w][0] : `repeating-linear-gradient(135deg, ${COLOR[w][0]} 0 8px, ${COLOR[w][1]} 8px 14px)` }}
                  onClick={() => {
                    if (sel === null) setSel(i);
                    else {
                      const o = [...order];
                      [o[sel], o[i]] = [o[i], o[sel]];
                      setOrder(o);
                      setSel(null);
                    }
                  }}
                >
                  {i + 1}
                  <br />
                  {w}
                </div>
              ))}
            </div>
            <button
              className="btn primary"
              onClick={() => {
                if (order.join() === WIRES.join()) f(`rj45:order_ok:${end}`);
                setPhase('trim');
              }}
            >
              Flatten & straighten
            </button>
          </div>
        )}
        {phase === 'trim' && (
          <div className="col">
            <b>3. Trim flush, then insert</b>
            <label>
              Untwisted length left: <b>{untwist} mm</b>
              <input type="range" min={6} max={30} value={untwist} onChange={(e) => setUntwist(Number(e.target.value))} style={{ width: '100%' }} />
            </label>
            <button
              className="btn primary"
              onClick={() => {
                if (untwist <= 13) f('rj45:untwist_ok');
                setPhase('crimp');
              }}
            >
              Trim & push into the plug
            </button>
          </div>
        )}
        {phase === 'crimp' && (
          <div className="col">
            <b>4. Crimp: press and hold</b>
            <div className="dim" style={{ fontSize: 12 }}>
              Check through the clear plug: every conductor reaches the end, and the jacket sits under the strain-relief wedge.
            </div>
            <button className="btn primary lg" onPointerDown={crimpHold}>
              {holding ? `Crimping… ${Math.round(holding / 10)}%` : '🗜 Hold to crimp'}
            </button>
          </div>
        )}
        {phase === 'done' && ends.A && ends.B && (
          <div className="col">
            <b>5. Cable tester</b>
            <button
              className="btn primary"
              onClick={() => {
                const r = testCable(ends.A!, ends.B!);
                setResult(r);
                if (r.pass) f('rj45:test_pass');
                else dispatch({ type: 'penalty', rule: 'rj45_fail', points: 3, reason: r.verdict.split('.')[0], key: `${ends.A!.join()}|${ends.B!.join()}` });
              }}
            >
              Run wiremap test
            </button>
            {result && (
              <div className="card mono" style={{ fontSize: 12.5, background: '#071018' }}>
                <div style={{ color: result.pass ? 'var(--ok)' : 'var(--bad)', fontWeight: 700, marginBottom: 6 }}>{result.verdict}</div>
                {result.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
            {result && !result.pass && (
              <div className="row">
                <button className="btn" onClick={() => resetEnd('A')}>
                  ✂ Cut off end A and redo
                </button>
                <button className="btn" onClick={() => resetEnd('B')}>
                  ✂ Cut off end B and redo
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
