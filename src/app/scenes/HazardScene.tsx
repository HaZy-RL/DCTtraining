import { OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import type { Hazard } from '../../engine/scenario';
import { useStore } from '../store';
import { DummyRack } from './three/RackParts';
import { MAT, RACK_D } from './three/common';
import { Look } from './three/Look';

// Units here are meters; DummyRack is modelled in 10 cm units, so it is scaled by 0.1.
const S = 0.1;

function HazardObject({ h, onHit }: { h: Hazard; onHit: (e: ThreeEvent<MouseEvent>) => void }) {
  const [x, y, z] = h.pos;
  const p: [number, number, number] = [x, y, z];
  const common = { onClick: onHit, onPointerOver: () => (document.body.style.cursor = 'pointer'), onPointerOut: () => (document.body.style.cursor = '') };
  switch (h.kind) {
    case 'tile':
      return (
        <group position={p} {...common}>
          <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 0.6]} />
            <meshStandardMaterial color="#020203" />
          </mesh>
          <mesh position={[0.45, 0.15, 0]} rotation={[0, 0, 1.2]}>
            <boxGeometry args={[0.6, 0.03, 0.6]} />
            <meshStandardMaterial color="#3a414b" />
          </mesh>
        </group>
      );
    case 'drink':
      return (
        <mesh position={p} {...common}>
          <cylinderGeometry args={[0.04, 0.035, 0.12, 16]} />
          <meshStandardMaterial color="#f2efe6" />
        </mesh>
      );
    case 'cardboard':
      return (
        <group position={p} {...common}>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.6, 0.4, 0.45]} />
            <meshStandardMaterial color="#b88a52" />
          </mesh>
          <mesh position={[0.1, 0.55, 0.05]}>
            <boxGeometry args={[0.4, 0.3, 0.35]} />
            <meshStandardMaterial color="#c49a62" />
          </mesh>
        </group>
      );
    case 'cable':
      return (
        <mesh position={p} rotation={[Math.PI / 2, 0, 0]} {...common}>
          <cylinderGeometry args={[0.012, 0.012, 2.1, 8]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      );
    case 'blanking':
      return (
        <mesh position={p} {...common}>
          <boxGeometry args={[0.46, 0.18, 0.02]} />
          <meshStandardMaterial color="#000" />
        </mesh>
      );
    case 'ladder':
      return (
        <group position={p} {...common}>
          <mesh position={[0, 0.5, 0.15]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.45, 1.1, 0.05]} />
            <meshStandardMaterial color="#e2b43a" />
          </mesh>
          <mesh position={[0, 0.5, -0.15]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.45, 1.1, 0.05]} />
            <meshStandardMaterial color="#d0a12f" />
          </mesh>
        </group>
      );
    case 'drive':
      return (
        <mesh position={p} {...common}>
          <boxGeometry args={[0.15, 0.04, 0.22]} />
          <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.3} />
        </mesh>
      );
    case 'extended':
      return (
        <group position={p} {...common}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.44, 0.087, 0.75]} />
            <meshStandardMaterial color="#4b5563" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[0.44, 0.087, 0.75]} />
            <meshStandardMaterial color="#4b5563" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      );
    case 'epo':
      return (
        <group position={p} {...common}>
          <mesh>
            <boxGeometry args={[0.05, 0.35, 0.35]} />
            <meshStandardMaterial color="#e2c12f" />
          </mesh>
          <mesh position={[0.04, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.06, 20]} />
            <meshStandardMaterial color="#d22" emissive="#600" />
          </mesh>
        </group>
      );
    case 'door':
      return (
        <mesh position={[p[0], 1, p[2] + 0.5]} rotation={[0, 0.9, 0]} {...common}>
          <boxGeometry args={[0.04, 2, 1]} />
          <meshStandardMaterial color="#8fb3c9" transparent opacity={0.5} />
        </mesh>
      );
    case 'spill':
      return (
        <mesh position={p} rotation={[-Math.PI / 2, 0, 0]} {...common}>
          <circleGeometry args={[0.45, 24]} />
          <meshStandardMaterial color="#5fa8d3" transparent opacity={0.65} metalness={0.9} roughness={0.05} />
        </mesh>
      );
    case 'badge':
      return (
        <group position={p} {...common}>
          <mesh rotation={[0, 0.6, 0]} position={[0, 1, 0.4]}>
            <boxGeometry args={[0.06, 2, 0.9]} />
            <meshStandardMaterial color="#59626e" metalness={0.6} />
          </mesh>
          <mesh position={[0.1, 0.05, 0.05]}>
            <boxGeometry args={[0.15, 0.1, 0.25]} />
            <meshStandardMaterial color="#c49a62" />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** Things that look suspicious but are fine. */
const DISTRACTORS: Array<{ id: string; label: string; why: string; pos: [number, number, number]; kind: 'ext' | 'cart' | 'bin' | 'sign' | 'tilecl' }> = [
  { id: 'ext', label: 'Fire extinguisher on its wall bracket', why: 'Correct: clearly marked, accessible, mounted.', pos: [-3.4, 0.5, 1.0], kind: 'ext' },
  { id: 'cart', label: 'Parts cart parked at the end of the row', why: 'Fine: out of the walkway, brakes on.', pos: [3.1, 0, 1.6], kind: 'cart' },
  { id: 'bin', label: 'Locked secure-destruction bin', why: 'That is where drives belong.', pos: [-2.9, 0, 1.6], kind: 'bin' },
  { id: 'perf', label: 'Perforated floor tile (cold aisle)', why: 'Normal: cold air comes up through these.', pos: [0.4, 0.005, -0.3], kind: 'tilecl' },
];

function Distractor({ d, onHit }: { d: (typeof DISTRACTORS)[number]; onHit: (e: ThreeEvent<MouseEvent>) => void }) {
  const common = { onClick: onHit, onPointerOver: () => (document.body.style.cursor = 'pointer'), onPointerOut: () => (document.body.style.cursor = '') };
  switch (d.kind) {
    case 'ext':
      return (
        <mesh position={d.pos} {...common}>
          <cylinderGeometry args={[0.1, 0.1, 0.55, 16]} />
          <meshStandardMaterial color="#c81e1e" />
        </mesh>
      );
    case 'cart':
      return (
        <group position={d.pos} {...common}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.6, 0.05, 1]} />
            <meshStandardMaterial color="#59626e" />
          </mesh>
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[0.6, 0.05, 1]} />
            <meshStandardMaterial color="#59626e" />
          </mesh>
        </group>
      );
    case 'bin':
      return (
        <mesh position={[d.pos[0], 0.5, d.pos[2]]} {...common}>
          <boxGeometry args={[0.6, 1, 0.6]} />
          <meshStandardMaterial color="#1f4f8f" />
        </mesh>
      );
    case 'tilecl':
      return (
        <mesh position={d.pos} rotation={[-Math.PI / 2, 0, 0]} {...common}>
          <planeGeometry args={[0.6, 0.6]} />
          <meshStandardMaterial color="#4b5563" wireframe />
        </mesh>
      );
    default:
      return null;
  }
}

export default function HazardScene() {
  const hazards = useStore((s) => s.inst!.bench!.hazards!);
  const flags = useStore((s) => s.world!.flags);
  const dispatch = useStore((s) => s.dispatch);
  const [info, setInfo] = useState<{ title: string; why: string; ok: boolean } | null>(null);
  const found = hazards.filter((h) => flags[`hazard:${h.id}`]);
  return (
    <>
      <Canvas camera={{ position: [4.6, 1.8, 0.4], fov: 60 }} shadows>
        <color attach="background" args={['#0a0e13']} />
        <ambientLight intensity={0.55} />
        <Look aoRadius={0.3} aoIntensity={1.6} />
        <pointLight position={[0, 2.8, 0]} intensity={6} distance={8} />
        <pointLight position={[-2, 2.8, 0]} intensity={4} distance={6} />
        <directionalLight position={[3, 8, 5]} intensity={0.8} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color="#2b3139" />
        </mesh>
        {/* two rack rows facing the cold aisle (scaled) */}
        <group scale={S}>
          {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => (
            <DummyRack key={`a${i}`} x={i * 6.15} z={-(RACK_D / 2 + 10.7)} />
          ))}
          {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => (
            <DummyRack key={`b${i}`} x={i * 6.15} z={RACK_D / 2 + 10.7} flip />
          ))}
        </group>
        {/* end walls */}
        <mesh position={[-3.5, 1.5, 0]} material={MAT.chassisDark}>
          <boxGeometry args={[0.1, 3, 6]} />
        </mesh>
        {hazards.map((h) => (
          <HazardObject
            key={h.id}
            h={h}
            onHit={(e) => {
              e.stopPropagation();
              if (!flags[`hazard:${h.id}`]) dispatch({ type: 'setFlag', name: `hazard:${h.id}` });
              setInfo({ title: `⚠ ${h.label}`, why: h.why, ok: true });
            }}
          />
        ))}
        {DISTRACTORS.map((d) => (
          <Distractor
            key={d.id}
            d={d}
            onHit={(e) => {
              e.stopPropagation();
              dispatch({ type: 'setFlag', name: 'hazard:miss' });
              setInfo({ title: `✓ ${d.label}`, why: `Not a hazard. ${d.why}`, ok: false });
            }}
          />
        ))}
        <OrbitControls makeDefault target={[0, 1, 0]} maxPolarAngle={Math.PI * 0.49} minDistance={0.5} maxDistance={8} />
      </Canvas>
      <div className="overlay" style={{ top: 10, right: 10, width: 300, background: 'rgba(13,19,27,.94)', border: '1px solid var(--line2)', borderRadius: 10, padding: 10 }}>
        <b>
          Hazards found: {found.length}/{hazards.length}
        </b>
        {found.map((h) => (
          <div key={h.id} style={{ fontSize: 12.5 }} className="pill-warn">
            ⚠ {h.label}
          </div>
        ))}
        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
          Wrong guesses: {flags['hazard:miss']?.count ?? 0}
        </div>
      </div>
      {info && (
        <div className="overlay inspector" style={{ maxWidth: 420 }}>
          <b className={info.ok ? 'pill-warn' : 'pill-ok'}>{info.title}</b>
          <p style={{ fontSize: 13, margin: '6px 0' }}>{info.why}</p>
          <button className="btn sm" onClick={() => setInfo(null)}>
            OK
          </button>
        </div>
      )}
    </>
  );
}
