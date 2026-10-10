import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { MODELS } from '../../engine/catalog';
import type { PortRef } from '../../engine/types';
import { useStore } from '../store';
import { deviceOrigin, MAT, RACK_PITCH, rackX, uBaseY } from './three/common';
import { Cables, DummyRack, RackFrame, SwitchMesh } from './three/RackParts';
import { ServerMesh } from './three/ServerMesh';

function CameraRig({ goal }: { goal: { pos: THREE.Vector3; target: THREE.Vector3; key: string } }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null;
  const anim = useRef<{ key: string; t: number }>({ key: '', t: 0 });
  const reduced = useStore((s) => s.progress.settings.reducedMotion);
  useFrame((_, dt) => {
    if (!controls) return;
    if (anim.current.key !== goal.key) anim.current = { key: goal.key, t: 0 };
    if (anim.current.t >= 1) return;
    anim.current.t = reduced ? 1 : Math.min(1, anim.current.t + dt * 1.6);
    const k = reduced ? 1 : Math.min(1, dt * 4.5);
    camera.position.lerp(goal.pos, anim.current.t >= 1 ? 1 : k);
    controls.target.lerp(goal.target, anim.current.t >= 1 ? 1 : k);
    controls.update();
  });
  return null;
}

function Floor({ minX, maxX }: { minX: number; maxX: number }) {
  const tiles = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b3139';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#1b1f25';
    g.lineWidth = 6;
    g.strokeRect(0, 0, 256, 256);
    g.fillStyle = '#20252c';
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if ((x + y) % 2 === 0) g.fillRect(24 + x * 13, 24 + y * 13, 6, 6);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set((maxX - minX + 40) / 6, 8);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [minX, maxX]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(minX + maxX) / 2, 0, 6]} receiveShadow>
      <planeGeometry args={[maxX - minX + 40, 48]} />
      <meshStandardMaterial map={tiles} roughness={0.95} metalness={0.05} />
    </mesh>
  );
}

export function RackScene({ buildMode = false }: { buildMode?: boolean }) {
  const w = useStore((s) => s.world!);
  const inst = useStore((s) => s.inst!);
  const sel = useStore((s) => s.sel);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const pendingPort = useStore((s) => s.pendingPort);
  const quality = useStore((s) => s.progress.settings.quality);

  const focusRackId = sel.rackId ?? inst.focusRackId ?? (w.trainee.location && w.racks[w.trainee.location] ? w.trainee.location : Object.keys(w.racks)[0]);
  const focusRack = w.racks[focusRackId] ?? Object.values(w.racks)[0];
  const row = focusRack.row;
  const origin = useMemo(() => w.racks[inst.focusRackId ?? focusRack.id]?.position ?? focusRack.position, [inst.focusRackId, focusRack.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const racks = useMemo(() => Object.values(w.racks).filter((r) => r.row === row).sort((a, b) => a.position - b.position), [w.racks, row]);
  const rackIds = useMemo(() => new Set(racks.map((r) => r.id)), [racks]);
  const positions = racks.map((r) => r.position);
  const minP = Math.min(...positions) - 3;
  const maxP = Math.max(...positions) + 3;
  const dummies: number[] = [];
  for (let p = minP; p <= maxP; p++) if (!positions.includes(p)) dummies.push(p);

  const devices = useMemo(() => Object.values(w.devices).filter((d) => d.rackId && rackIds.has(d.rackId)), [w.devices, rackIds]);
  const cablesSig = useMemo(() => Object.values(w.cables).map((c) => `${c.a?.port}${c.b?.port}${c.condition}`).join() + devices.map((d) => d.power + d.os).join(), [w.cables, devices]);

  const store = useStore.getState;
  const onRack = useCallback((id: string) => store().select({ rackId: id }), [store]);
  const onDevice = useCallback(
    (id: string) => {
      const d = store().world!.devices[id];
      store().select({ deviceId: id, rackId: d.rackId ?? undefined });
    },
    [store],
  );
  const onSlot = useCallback(
    (id: string, slot: string) => {
      const d = store().world!.devices[id];
      store().select({ deviceId: id, slot, rackId: d.rackId ?? undefined });
      const def = MODELS[d.model].slots.find((s) => s.id === slot);
      if (def) store().unlockCodex(`kind:${def.kind}`);
      if (slot === 'PSU1' || slot === 'PSU2') store().unlockCodex('tool:pdu');
    },
    [store],
  );
  const onPort = useCallback(
    (id: string, port: string) => {
      const st = store();
      const p: PortRef = { deviceId: id, port };
      const pend = st.pendingPort;
      if (!pend) {
        st.setPendingPort(p);
        st.select({ deviceId: id, rackId: st.world!.devices[id].rackId ?? undefined });
      } else if (pend.deviceId === id && pend.port === port) st.setPendingPort(null);
      else {
        useStore.setState({ cableDraft: { a: pend, b: p }, pendingPort: null });
      }
    },
    [store],
  );
  const onCable = useCallback((id: string) => store().select({ cableId: id, rackId: store().sel.rackId }), [store]);
  const onU = useCallback((u: number) => store().select({ rackId: focusRack.id, u }), [store, focusRack.id]);

  // camera goal
  const goal = useMemo(() => {
    const rx = rackX(focusRack, origin);
    const rear = view === 'rear';
    const dz = rear ? -1 : 1;
    const dev = sel.deviceId ? w.devices[sel.deviceId] : undefined;
    if (dev?.rackId && rackIds.has(dev.rackId)) {
      const o = deviceOrigin(dev, rackX(w.racks[dev.rackId], origin));
      if (dev.servicePosition && !rear) {
        const t = o.clone().add(new THREE.Vector3(0, 0.4, 0.3));
        return { target: t, pos: t.clone().add(new THREE.Vector3(0.6, 7.5, 6.5)), key: `${dev.id}-svc-${view}` };
      }
      const t = o.clone().add(new THREE.Vector3(0, 0.4, rear ? -3.4 : 3.6));
      return { target: t, pos: t.clone().add(new THREE.Vector3(1.6, 1.8, 6.5 * dz)), key: `${dev.id}-${view}` };
    }
    if (sel.u) {
      const t = new THREE.Vector3(rx, uBaseY(sel.u), 4.9);
      return { target: t, pos: t.clone().add(new THREE.Vector3(2, 1.5, 7)), key: `u${sel.u}` };
    }
    const t = new THREE.Vector3(rx, 9.5, 0);
    return { target: t, pos: new THREE.Vector3(rx + 3, 11, 24 * dz), key: `${focusRack.id}-${view}` };
  }, [sel.deviceId, sel.u, focusRack, origin, view, w.devices, w.racks, rackIds]);

  const hl = mode === 'learn' && typeof w.meta.hlDevice === 'string' ? { dev: w.meta.hlDevice as string, slot: w.meta.hlSlot as string } : null;
  const xs = racks.map((r) => rackX(r, origin));

  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={quality === 'high' ? [1, 2] : 1}
      camera={{ position: [3, 11, 24], fov: 45, near: 0.1, far: 400 }}
      onPointerMissed={() => {
        const st = store();
        if (st.sel.slot || st.sel.cableId) st.select({ deviceId: st.sel.deviceId, rackId: st.sel.rackId });
      }}
      gl={{ antialias: quality === 'high' }}
    >
      <color attach="background" args={['#0a0e13']} />
      <fog attach="fog" args={['#0a0e13', 40, 120]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#cfe3ff', '#1a1f26', 0.5]} />
      <directionalLight position={[10, 30, 20]} intensity={1.1} castShadow={quality === 'high'} />
      <directionalLight position={[-10, 20, -20]} intensity={0.6} />
      {xs.map((x) => (
        <pointLight key={x} position={[x, 22, 10]} intensity={30} distance={30} color="#e6f0ff" />
      ))}
      <Floor minX={(minP - origin) * RACK_PITCH} maxX={(maxP - origin) * RACK_PITCH} />
      {/* overhead cable trays */}
      <mesh position={[((minP + maxP) / 2 - origin) * RACK_PITCH, 21.8, -3]} material={MAT.post}>
        <boxGeometry args={[(maxP - minP + 1) * RACK_PITCH, 0.15, 1.5]} />
      </mesh>
      <mesh position={[((minP + maxP) / 2 - origin) * RACK_PITCH, 22.4, 2.5]}>
        <boxGeometry args={[(maxP - minP + 1) * RACK_PITCH, 0.12, 1.0]} />
        <meshStandardMaterial color="#c9a227" metalness={0.5} roughness={0.5} />
      </mesh>
      {racks.map((r) => (
        <RackFrame key={r.id} rack={r} x={rackX(r, origin)} here={w.trainee.location === r.id} selected={focusRack.id === r.id} onRack={onRack} buildMode={buildMode && r.id === focusRack.id} onU={onU} hoverU={sel.u ?? null} />
      ))}
      {dummies.map((p) => (
        <DummyRack key={p} x={(p - origin) * RACK_PITCH} />
      ))}
      {devices.map((d) => {
        const r = w.racks[d.rackId!];
        const x = rackX(r, origin);
        if (d.role === 'server')
          return (
            <ServerMesh
              key={d.id}
              dev={d}
              rack={r}
              x={x}
              detail={sel.deviceId === d.id}
              selected={sel.deviceId === d.id}
              selSlot={sel.deviceId === d.id ? sel.slot : undefined}
              highlightSlot={hl && hl.dev === d.id ? hl.slot : undefined}
              pendingPort={pendingPort?.deviceId === d.id ? pendingPort.port : null}
              onDevice={onDevice}
              onSlot={onSlot}
              onPort={onPort}
            />
          );
        return <SwitchMesh key={d.id} dev={d} x={x} selected={sel.deviceId === d.id} pendingPort={pendingPort?.deviceId === d.id ? pendingPort.port : null} onDevice={onDevice} onPort={onPort} cablesSig={cablesSig} />;
      })}
      <Cables w={w} originPos={origin} rackIds={rackIds} selCable={sel.cableId} onCable={onCable} />
      {/* trainee marker */}
      {w.trainee.location && w.racks[w.trainee.location] && rackIds.has(w.trainee.location) && (
        <mesh position={[rackX(w.racks[w.trainee.location], origin), 0.05, view === 'rear' ? -7.5 : 7.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 0.85, 32]} />
          <meshBasicMaterial color="#4fd1c5" toneMapped={false} />
        </mesh>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={70} />
      <CameraRig goal={goal} />
    </Canvas>
  );
}
