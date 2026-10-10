import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Look } from './three/Look';

function LcDuplex({ capOn, inserted, flipped }: { capOn: boolean; inserted: boolean; flipped: boolean }) {
  return (
    <group position={[inserted ? 0.55 : 0, 0, 0]}>
      {[-0.13, 0.13].map((y, i) => (
        <group key={y} position={[0, y, 0]}>
          <mesh position={[-0.35, 0, 0]}>
            <boxGeometry args={[0.6, 0.2, 0.22]} />
            <meshStandardMaterial color="#2fd1d1" />
          </mesh>
          <mesh position={[0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.04, 0.04, 0.22, 16]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
          {capOn && (
            <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.06, 0.06, 0.12, 16]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          )}
          <mesh position={[-0.33, 0.11, 0]}>
            <planeGeometry args={[0.1, 0.06]} />
            <meshBasicMaterial color={(i === 0) !== flipped ? '#ff4040' : '#3d8bff'} />
          </mesh>
        </group>
      ))}
      <mesh position={[-1.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.6, 12]} />
        <meshStandardMaterial color="#2fd1d1" />
      </mesh>
    </group>
  );
}

function Optic() {
  return (
    <group position={[1.05, 0, 0]}>
      <mesh>
        <boxGeometry args={[0.7, 0.55, 0.42]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[-0.36, 0, 0]}>
        <planeGeometry args={[0.02, 0.5]} />
        <meshBasicMaterial color="#000" />
      </mesh>
    </group>
  );
}

function Scope({ dirty }: { dirty: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const W = c.width;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, W);
    const grd = g.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2);
    grd.addColorStop(0, '#5d5d55');
    grd.addColorStop(1, '#141412');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c9c9b8';
    g.beginPath();
    g.arc(W / 2, W / 2, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fffbe0';
    g.beginPath();
    g.arc(W / 2, W / 2, 9, 0, Math.PI * 2);
    g.fill();
    if (dirty) {
      for (let i = 0; i < 22; i++) {
        g.fillStyle = `rgba(30,25,15,${0.5 + Math.random() * 0.5})`;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 70;
        g.beginPath();
        g.arc(W / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r, 1 + Math.random() * 5, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(40,30,20,.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W / 2 - 30, W / 2 + 4);
      g.quadraticCurveTo(W / 2, W / 2 - 10, W / 2 + 40, W / 2 + 20);
      g.stroke();
    }
  }, [dirty]);
  return <canvas ref={ref} width={200} height={200} className="scope" />;
}

export default function FiberBench() {
  const fiber = useStore((s) => s.inst!.bench!.fiber!);
  const focus = useStore((s) => s.inst!.focusDeviceId!);
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const cable = w.cables[fiber.cableId];
  const [capOn, setCapOn] = useState(true);
  const [flipped, setFlipped] = useState(fiber.polarityFlipped);
  const [scoped, setScoped] = useState<boolean | null>(null);
  const inserted = !!cable?.a;
  const dirty = cable?.condition === 'dirty';
  const f = (n: string) => dispatch({ type: 'setFlag', name: n });
  const tor = w.devices[focus];
  return (
    <div className="bench" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 440px)', gap: 16, padding: 0 }}>
      <div style={{ position: 'relative', minHeight: 320 }}>
        <Canvas camera={{ position: [0.4, 1.0, 3.2], fov: 40 }}>
          <color attach="background" args={['#0d1218']} />
          <ambientLight intensity={0.7} />
          <Look aoRadius={0.08} aoIntensity={1.6} />
          <directionalLight position={[3, 5, 4]} intensity={1.2} />
          <LcDuplex capOn={capOn} inserted={inserted} flipped={flipped} />
          <Optic />
          <OrbitControls makeDefault enablePan={false} />
        </Canvas>
        <div className="overlay" style={{ left: 10, top: 10, fontSize: 12 }}>
          <span className="tag">{tor.hostname} swp49 (100G-SR4 optic)</span>
        </div>
      </div>
      <div style={{ padding: 16, overflow: 'auto' }} className="col">
        <h3>MMF jumper → {tor.hostname} swp49</h3>
        <div className="kv">
          <span>Jumper</span>
          <span>OM4 aqua LC-LC duplex, 30 m</span>
          <span>Labels</span>
          <span className="mono">{cable.labelA} ⇄ {cable.labelB}</span>
          <span>Duplex clip</span>
          <span>{flipped ? 'A-A (red on top at both ends)' : 'A-B (red top here, blue top far end)'}</span>
        </div>
        <div className="actions">
          <button className="btn sm" disabled={!capOn} onClick={() => setCapOn(false)}>
            Remove dust caps
          </button>
          <button
            className="btn sm danger"
            disabled={capOn}
            onClick={() => dispatch({ type: 'penalty', rule: 'fiber_eye', points: 10, reason: 'Looked into a fiber end with the naked eye: invisible laser light can burn your retina', safety: true, key: 'eye' })}
          >
            👁 Look into the end
          </button>
          <button
            className="btn sm primary"
            disabled={capOn || inserted}
            onClick={() => {
              setScoped(dirty);
              f('fiber:inspected');
              if (!dirty) f('fiber:inspected_clean');
            }}
          >
            🔬 Inspect with scope
          </button>
          <button
            className="btn sm"
            disabled={capOn || inserted}
            onClick={() => {
              dispatch({ type: 'cleanCable', cableId: cable.id });
              setScoped(null);
            }}
          >
            🧽 One-click cleaner
          </button>
        </div>
        {scoped !== null && (
          <div className="row">
            <Scope dirty={scoped} />
            <div style={{ fontSize: 13 }}>
              {scoped ? (
                <span className="pill-bad">
                  <b>FAIL:</b> particles and an oil film on the core and cladding. Clean it.
                </span>
              ) : (
                <span className="pill-ok">
                  <b>PASS:</b> core and cladding are clean.
                </span>
              )}
            </div>
          </div>
        )}
        <div className="actions">
          <button className="btn sm" disabled={inserted} onClick={() => setFlipped(!flipped)}>
            ↻ Flip duplex clip (swap Tx/Rx)
          </button>
          <button
            className="btn sm"
            disabled={inserted}
            onClick={() => {
              if (!flipped) f('fiber:polarity_ok');
              else dispatch({ type: 'penalty', rule: 'fiber_polarity', points: 3, reason: 'Polarity is A-A: Tx would meet Tx and no light reaches Rx', key: 'pol' });
            }}
          >
            ✓ Confirm polarity A→B
          </button>
        </div>
        <div className="actions">
          {!inserted ? (
            <button
              className="btn primary"
              disabled={capOn}
              onClick={() => {
                if (!w.flags['fiber:inspected_clean'] || dirty) dispatch({ type: 'penalty', rule: 'fiber_dirty_connect', points: 10, reason: 'Connected a fiber without a clean inspection', key: 'dc' });
                if (flipped) dispatch({ type: 'penalty', rule: 'fiber_polarity_connect', points: 3, reason: 'Connected with flipped polarity: link stays down', key: 'pc' });
                dispatch({ type: 'reconnectCable', cableId: cable.id, end: 'a', port: { deviceId: tor.id, port: 'swp49' } });
                if (flipped) useStore.setState((st) => ({ world: st.world ? { ...st.world, cables: { ...st.world.cables, [cable.id]: { ...st.world.cables[cable.id], condition: 'bad_termination' } } } : st.world }));
              }}
            >
              Insert into the optic (click!)
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                dispatch({ type: 'disconnectCable', cableId: cable.id, end: 'a' });
                if (cable.condition === 'bad_termination') useStore.setState((st) => ({ world: st.world ? { ...st.world, cables: { ...st.world.cables, [cable.id]: { ...st.world.cables[cable.id], condition: 'ok' } } } : st.world }));
              }}
            >
              Unplug from optic
            </button>
          )}
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          After inserting, verify from the terminal: <code>ssh {tor.hostname}</code> → <code>show interface transceiver swp49</code>. Rx should be around -2 to -3 dBm.
        </p>
      </div>
    </div>
  );
}
