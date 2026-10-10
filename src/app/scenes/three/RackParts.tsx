import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo, useState } from 'react';
import * as THREE from 'three';
import { MODELS } from '../../../engine/catalog';
import { hasAC, linkState, parseOutlet } from '../../../engine/projectors';
import type { Cable, Device, Rack, World } from '../../../engine/types';
import { useStore } from '../../store';
import { deviceOrigin, Label, Led, MAT, outletWorld, PDU_X, PDU_Z, PLINTH, portLocal, portWorld, RACK_D, RACK_W, U, uBaseY } from './common';

// ---------- switch ----------

function SwitchMeshInner({ dev, x, selected, pendingPort, onDevice, onPort }: { dev: Device; x: number; selected: boolean; pendingPort?: string | null; onDevice: (id: string) => void; onPort: (id: string, p: string) => void; cablesSig: string }) {
  const w = useStore.getState().world!;
  const m = MODELS[dev.model];
  const pos = deviceOrigin(dev, x);
  const ac = hasAC(w, dev);
  return (
    <group position={pos}>
      <mesh
        position={[0, U / 2 - 0.01, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onDevice(dev.id);
        }}
      >
        <boxGeometry args={[4.4, U - 0.02, 4.5]} />
        <meshStandardMaterial color={dev.role === 'switch' ? '#20262e' : '#1f2b3a'} metalness={0.5} roughness={0.5} emissive={selected ? '#103040' : '#000'} />
      </mesh>
      {m.ports.map((p) => {
        const lp = portLocal(dev, p);
        const ls = linkState(w, dev.id, p);
        const pend = pendingPort === p;
        const qsfp = dev.role === 'switch' && Number(p.slice(3)) > 48;
        return (
          <group key={p}>
            <mesh
              position={lp}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onPort(dev.id, p);
              }}
              onPointerOver={() => (document.body.style.cursor = 'crosshair')}
              onPointerOut={() => (document.body.style.cursor = '')}
            >
              <boxGeometry args={qsfp ? [0.085, 0.12, 0.03] : [0.11, 0.1, 0.03]} />
              <meshStandardMaterial color={pend ? '#4fd1c5' : '#060606'} emissive={pend ? '#4fd1c5' : '#000'} emissiveIntensity={0.9} />
            </mesh>
            {ac && ls.up && <Led state={ls.crcErrors ? 'amber_blink' : 'green'} position={[lp.x + 0.04, lp.y + 0.065, lp.z - 0.01]} size={0.012} />}
          </group>
        );
      })}
      <Label text={dev.hostname} position={[1.6, 0.36, -2.27]} rotation={[0, Math.PI, 0]} size={[1.1, 0.07]} opts={{ bg: '#20262e', fg: '#9fb4c9', w: 400, h: 28 }} />
      <Led state={ac ? 'green' : 'off'} position={[-2.15, 0.3, -2.27]} size={0.03} />
    </group>
  );
}
export const SwitchMesh = memo(SwitchMeshInner);

// ---------- rack frame ----------

function RackFrameInner({ rack, x, here, selected, onRack, buildMode, onU, hoverU }: { rack: Rack; x: number; here: boolean; selected: boolean; onRack: (id: string) => void; buildMode?: boolean; onU?: (u: number) => void; hoverU?: number | null }) {
  const h = rack.heightU * U + PLINTH + 0.6;
  const uTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 42 * 32;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b3038';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#cbd5e0';
    g.font = 'bold 18px monospace';
    g.textAlign = 'center';
    for (let u = 1; u <= 42; u++) {
      const y = c.height - (u - 0.5) * 32;
      g.fillText(String(u), 32, y + 6);
      g.fillRect(4, c.height - u * 32, 56, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const posts: Array<[number, number]> = [
    [-2.55, 4.95],
    [2.55, 4.95],
    [-2.55, -4.95],
    [2.55, -4.95],
  ];
  return (
    <group position={[x, 0, 0]}>
      {/* plinth + roof */}
      <mesh position={[0, PLINTH / 2, 0]} material={MAT.rack} onClick={(e) => (e.stopPropagation(), onRack(rack.id))}>
        <boxGeometry args={[RACK_W, PLINTH, RACK_D]} />
      </mesh>
      <mesh position={[0, h - 0.15, 0]} material={MAT.rack} onClick={(e) => (e.stopPropagation(), onRack(rack.id))}>
        <boxGeometry args={[RACK_W, 0.3, RACK_D]} />
      </mesh>
      {/* side panels (thin, dark) */}
      {[-RACK_W / 2, RACK_W / 2].map((sx) => (
        <mesh key={sx} position={[sx, h / 2, 0]} onClick={(e) => (e.stopPropagation(), onRack(rack.id))}>
          <boxGeometry args={[0.05, h, RACK_D]} />
          <meshStandardMaterial color={selected ? '#1b2c3a' : '#101317'} metalness={0.4} roughness={0.7} />
        </mesh>
      ))}
      {posts.map(([px, pz], i) => (
        <mesh key={i} position={[px, PLINTH + (rack.heightU * U) / 2, pz]} material={MAT.post}>
          <boxGeometry args={[0.18, rack.heightU * U, 0.08]} />
        </mesh>
      ))}
      {/* U labels on front and rear left posts */}
      <mesh position={[-2.67, PLINTH + (rack.heightU * U) / 2, 5.0]}>
        <planeGeometry args={[0.18, rack.heightU * U]} />
        <meshBasicMaterial map={uTex} toneMapped={false} />
      </mesh>
      <mesh position={[2.67, PLINTH + (rack.heightU * U) / 2, -5.0]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.18, rack.heightU * U]} />
        <meshBasicMaterial map={uTex} toneMapped={false} />
      </mesh>
      {/* location sign */}
      <Label text={rack.location} position={[0, h + 0.35, 5.36]} size={[3.2, 0.42]} opts={{ bg: here ? '#1f6f6a' : '#0e141b', fg: '#e6edf3', w: 512, h: 68 }} />
      <Label text={rack.location} position={[0, h + 0.35, -5.36]} rotation={[0, Math.PI, 0]} size={[3.2, 0.42]} opts={{ bg: here ? '#1f6f6a' : '#0e141b', fg: '#e6edf3', w: 512, h: 68 }} />
      {/* PDUs */}
      {rack.pdus.map((p) => (
        <group key={p.id} position={[PDU_X[p.side], 0, PDU_Z]}>
          <mesh position={[0, PLINTH + 9, 0]}>
            <boxGeometry args={[0.32, 18, 0.2]} />
            <meshStandardMaterial color={p.side === 'A' ? '#1b2d4a' : '#4a1b22'} metalness={0.4} roughness={0.6} />
          </mesh>
          <Label text={`PDU-${p.side}`} position={[0, PLINTH + 18.3, -0.11]} rotation={[0, Math.PI, 0]} size={[0.3, 0.12]} opts={{ bg: p.side === 'A' ? '#2f7de1' : '#e1442f', fg: '#fff', w: 120, h: 48 }} />
          <Led state={p.breakerTripped ? 'red' : 'green'} position={[0, PLINTH + 17.8, -0.11]} size={0.05} />
          {Array.from({ length: p.outlets }, (_, i) => (
            <mesh key={i} position={[0, 1.4 + i * 0.72, -0.11]} material={MAT.port}>
              <boxGeometry args={[0.18, 0.2, 0.03]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* rails */}
      {Object.entries(rack.rails).map(([uStr, r]) => {
        const u = Number(uStr);
        const y = uBaseY(u) + (r.holeOffset * U) / 3;
        return [-2.35, 2.35].map((sx) => (
          <mesh key={`${u}${sx}`} position={[sx, y + 0.05, 0]}>
            <boxGeometry args={[0.12, 0.1, 9.6]} />
            <meshStandardMaterial color={r.holeOffset ? '#c05621' : '#7c8794'} metalness={0.8} roughness={0.3} />
          </mesh>
        ));
      })}
      {/* clickable U slots in build mode */}
      {buildMode &&
        Array.from({ length: rack.heightU }, (_, i) => i + 1).map((u) => (
          <mesh
            key={u}
            position={[0, uBaseY(u) + U / 2, 4.95]}
            onClick={(e) => {
              e.stopPropagation();
              onU?.(u);
            }}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}
          >
            <planeGeometry args={[4.6, U * 0.92]} />
            <meshBasicMaterial color={hoverU === u ? '#4fd1c5' : '#4fd1c5'} transparent opacity={hoverU === u ? 0.35 : 0.04} side={THREE.DoubleSide} />
          </mesh>
        ))}
    </group>
  );
}
export const RackFrame = memo(RackFrameInner);

/** Simple placeholder rack for atmosphere (not in the world). */
export function DummyRack({ x, z = 0, flip = false }: { x: number; z?: number; flip?: boolean }) {
  const [lights] = useState(() => Array.from({ length: 14 }, () => Math.random()));
  const h = 42 * U + PLINTH + 0.6;
  return (
    <group position={[x, 0, z]} rotation={[0, flip ? Math.PI : 0, 0]}>
      <mesh position={[0, h / 2, 0]} material={MAT.rack}>
        <boxGeometry args={[RACK_W, h, RACK_D]} />
      </mesh>
      {lights.map((r, i) => (
        <mesh key={i} position={[1.8, PLINTH + 0.5 + i * 1.25, RACK_D / 2 + 0.01]}>
          <planeGeometry args={[0.06, 0.06]} />
          <meshBasicMaterial color={r > 0.92 ? '#ffae2b' : '#2bff6a'} toneMapped={false} />
        </mesh>
      ))}
      {lights.map((_, i) => (
        <mesh key={`b${i}`} position={[0, PLINTH + 0.5 + i * 1.25, RACK_D / 2 + 0.005]}>
          <planeGeometry args={[4.4, 0.86]} />
          <meshStandardMaterial color="#2a3038" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- cables ----------

const CABLE_COLORS: Record<string, string> = { dac: '#111316', cat6: '#d9b72b', aoc: '#2bb3c0', fiber_mmf: '#2fd1d1', fiber_smf: '#e2d92b', power_c13: '#222', power_c19: '#222' };

/** Route: out of the port, into the vertical cable manager on the side of the rack, up/down, then into the far port. */
function curveFor(a: THREE.Vector3, b: THREE.Vector3, side: number): THREE.CatmullRomCurve3 {
  const zRun = -4.55; // vertical run just inside the rear posts
  const lo = a.y < b.y ? a : b;
  const hi = a.y < b.y ? b : a;
  const pts = [
    lo.clone(),
    new THREE.Vector3(lo.x, lo.y, lo.z - 0.3),
    new THREE.Vector3(side, lo.y + 0.05, zRun),
    new THREE.Vector3(side, hi.y - 0.4, zRun),
    new THREE.Vector3(hi.x, hi.y - 0.05, hi.z - 0.25),
    hi.clone(),
  ];
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
}

function CableTube({ cable, a, b, side, selected, onClick }: { cable: Cable; a: THREE.Vector3; b: THREE.Vector3; side: number; selected: boolean; onClick: (id: string) => void }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curveFor(a, b, side), 40, cable.type === 'cat6' ? 0.022 : 0.03, 6, false), [a.x, a.y, a.z, b.x, b.y, b.z, side, cable.type]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = cable.condition === 'damaged' ? '#7a2b2b' : CABLE_COLORS[cable.type] ?? '#111';
  return (
    <mesh
      geometry={geo}
      onClick={(e) => {
        e.stopPropagation();
        onClick(cable.id);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <meshStandardMaterial color={selected ? '#4fd1c5' : color} emissive={selected ? '#4fd1c5' : '#000'} emissiveIntensity={0.5} roughness={0.6} />
    </mesh>
  );
}

export function Cables({ w, originPos, rackIds, selCable, onCable }: { w: World; originPos: number; rackIds: Set<string>; selCable?: string; onCable: (id: string) => void }) {
  const items: Array<{ c: Cable; a: THREE.Vector3; b: THREE.Vector3; side: number }> = [];
  for (const c of Object.values(w.cables)) {
    const ends = [c.a, c.b].filter(Boolean) as NonNullable<Cable['a']>[];
    if (!ends.some((e) => rackIds.has(w.devices[e.deviceId]?.rackId ?? ''))) continue;
    const pa = c.a ? portWorld(w, c.a.deviceId, c.a.port, originPos) : null;
    const pb = c.b ? portWorld(w, c.b.deviceId, c.b.port, originPos) : null;
    if (pa && pb) {
      const rx = pa.x + (w.devices[c.a!.deviceId].role === 'server' ? 0 : 0);
      const isBmc = c.a!.port === 'bmc' || c.b!.port === 'bmc';
      const rackCenter = Math.round(rx / 6.15) * 6.15;
      items.push({ c, a: pa, b: pb, side: rackCenter + (isBmc ? -2.05 : -2.3) + (c.a!.port === 'nic0p1' ? 0.08 : 0) });
    } else if (pa || pb) {
      // one end dangling (e.g. fiber waiting to be plugged): short stub
      const p = (pa ?? pb)!;
      items.push({ c, a: p, b: p.clone().add(new THREE.Vector3(0.3, -1.2, -0.6)), side: p.x + 0.3 });
    }
  }
  // power cords
  const cords: Array<{ id: string; a: THREE.Vector3; b: THREE.Vector3; side: 'A' | 'B'; x: number }> = [];
  for (const d of Object.values(w.devices)) {
    if (!d.rackId || !rackIds.has(d.rackId)) continue;
    for (const [psu, o] of Object.entries(d.powerCords)) {
      if (!o) continue;
      const pa = d.role === 'server' ? portWorld(w, d.id, psu, originPos) : portWorld(w, d.id, 'swp1', originPos)?.add(new THREE.Vector3(psu === 'PSU1' ? 3.9 : 3.6, 0.1, 0));
      const pb = outletWorld(w, o, originPos);
      const side = parseOutlet(o)?.side ?? 'A';
      if (pa && pb) cords.push({ id: `${d.id}${psu}`, a: pa, b: pb, side, x: pb.x });
    }
  }
  return (
    <group>
      {items.map((it) => (
        <CableTube key={it.c.id} cable={it.c} a={it.a} b={it.b} side={it.side} selected={selCable === it.c.id} onClick={onCable} />
      ))}
      {cords.map((c) => (
        <PowerCord key={c.id} a={c.a} b={c.b} side={c.side} />
      ))}
    </group>
  );
}

function PowerCord({ a, b, side }: { a: THREE.Vector3; b: THREE.Vector3; side: 'A' | 'B' }) {
  const geo = useMemo(() => {
    const pts = [a.clone(), a.clone().add(new THREE.Vector3(0, -0.08, -0.35)), new THREE.Vector3(b.x - Math.sign(b.x - a.x) * 0.25, a.y - 0.12, b.z - 0.2), b.clone().add(new THREE.Vector3(0, 0, -0.18)), b.clone()];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 24, 0.03, 6, false);
  }, [a.x, a.y, a.z, b.x, b.y, b.z]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={side === 'A' ? '#2f6fe1' : '#d23b3b'} roughness={0.7} />
    </mesh>
  );
}
