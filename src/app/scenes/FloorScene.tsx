import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { FLOOR_ROWS } from '../../content/floor';
import { useStore } from '../store';
import { Label } from './three/common';

const PITCH_X = 0.8;
const ROW_GAP = 3.2;

export default function FloorScene() {
  const w = useStore((s) => s.world!);
  const targets = useStore((s) => s.inst!.bench!.floor!.targets);
  const dispatch = useStore((s) => s.dispatch);
  const [flash, setFlash] = useState<{ id: string; ok: boolean } | null>(null);
  const idx = targets.findIndex((_, i) => !w.flags[`floor:found:${i}`]);
  const target = idx >= 0 ? w.racks[targets[idx]] : null;
  const racks = useMemo(() => Object.values(w.racks), [w.racks]);
  const pos = (row: string, p: number): [number, number, number] => [(p - 7.5) * PITCH_X, 0, (FLOOR_ROWS.indexOf(row) - 2.5) * ROW_GAP];
  return (
    <>
      <Canvas camera={{ position: [0, 16, 13], fov: 45 }}>
        <color attach="background" args={['#0a0e13']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 20, 10]} intensity={1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[20, 24]} />
          <meshStandardMaterial color="#232a33" />
        </mesh>
        {/* aisle markings */}
        {FLOOR_ROWS.map((r, i) => (
          <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, (i - 2.5) * ROW_GAP + (i % 2 ? -1.1 : 1.1)]}>
            <planeGeometry args={[13, 1.4]} />
            <meshStandardMaterial color={i % 2 ? '#3a2526' : '#1f2e3d'} />
          </mesh>
        ))}
        {racks.map((r) => {
          const [x, , z] = pos(r.row, r.position);
          const hit = flash?.id === r.id;
          return (
            <group key={r.id} position={[x, 0, z]}>
              <mesh
                position={[0, 1, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!target) return;
                  const ok = r.id === target.id;
                  setFlash({ id: r.id, ok });
                  setTimeout(() => setFlash(null), 700);
                  dispatch({ type: 'setFlag', name: ok ? `floor:found:${idx}` : 'floor:miss' });
                  if (!ok) dispatch({ type: 'penalty', rule: 'floor_miss', points: 1, reason: `Wrong rack: that was ${r.location}`, key: `${idx}:${r.id}` });
                }}
                onPointerOver={() => (document.body.style.cursor = 'pointer')}
                onPointerOut={() => (document.body.style.cursor = '')}
              >
                <boxGeometry args={[0.6, 2, 1.07]} />
                <meshStandardMaterial color={hit ? (flash!.ok ? '#2f855a' : '#9b2c2c') : '#15181d'} metalness={0.4} roughness={0.6} />
              </mesh>
              <Label text={String(r.position).padStart(2, '0')} position={[0, 2.02, 0]} rotation={[-Math.PI / 2, 0, 0]} size={[0.5, 0.3]} opts={{ bg: '#0e141b', fg: '#9fb4c9', w: 96, h: 56 }} />
            </group>
          );
        })}
        {FLOOR_ROWS.map((row, i) => (
          <Label key={row} text={`ROW ${row}`} position={[-6.8, 1.6, (i - 2.5) * ROW_GAP]} rotation={[0, Math.PI / 2, 0]} size={[1.4, 0.5]} opts={{ bg: '#c9a227', fg: '#111', w: 200, h: 72 }} />
        ))}
        <Label text="← 01 … 14 →" position={[0, 0.02, 9.6]} rotation={[-Math.PI / 2, 0, 0]} size={[4, 0.6]} opts={{ bg: '#0a0e13', fg: '#5d6d82', w: 400, h: 60 }} />
        <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.45} />
      </Canvas>
      <div className="overlay" style={{ top: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,19,27,.94)', border: '1px solid var(--line2)', borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
        {target ? (
          <>
            <div className="muted" style={{ fontSize: 12 }}>
              Find ({idx + 1}/{targets.length})
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {target.location}
            </div>
            <div className="dim" style={{ fontSize: 11 }}>
              Site-Hall-RowRack
            </div>
          </>
        ) : (
          <div className="pill-ok">✓ All racks found. Finish & review.</div>
        )}
      </div>
    </>
  );
}
