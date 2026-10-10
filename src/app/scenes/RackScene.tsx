import { OrbitControls } from '@react-three/drei';
import { Look } from './three/Look';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { MODELS } from '../../engine/catalog';
import { isTight } from '../../engine/fasteners';
import type { PortRef, Rack } from '../../engine/types';
import { useCoach } from '../play/guide';
import { useStore } from '../store';
import { blankTex, canvasTex, deviceOrigin, FRONT_RAIL_Z, GuideBeacon, MAT, pointerGuard, RACK_D, RACK_PITCH, RACK_W, rackX, U, uBaseY, ventTileTex } from './three/common';
import { Cables, DummyRack, RackFrame, SwitchMesh } from './three/RackParts';
import { ServerMesh } from './three/ServerMesh';
import { ROOM, roomSpots, Workroom, SHELF_KINDS } from './three/Workroom';
import type { ComponentKind } from '../../engine/types';
import { notifyWalker, walker, useWalker } from './three/walker';

const EYE = 16.5; // 1.65 m
const AISLE_Z = 8; // where you stand in front of / behind a rack
const ROW_HALF = RACK_D / 2 + 0.05;
const OPPOSITE_Z = ROW_HALF * 2 + 12; // the next row over, across a 1.2 m aisle
const WALL_Z = OPPOSITE_Z - ROW_HALF - 0.7;

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

function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** First-person walking: WASD/arrows to move, drag to look, Shift to run. Reports rack/aisle zones to the sim. */
function WalkController({ racks, origin, rowMinX, rowMaxX, hallMinX, roomX0 }: { racks: Rack[]; origin: number; rowMinX: number; rowMaxX: number; hallMinX: number; roomX0: number }) {
  const hallMaxX = roomX0 + ROOM.depth;
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const lastNotify = useRef(0);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 62;
    cam.updateProjectionMatrix();
    return () => {
      cam.fov = 45;
      cam.updateProjectionMatrix();
    };
  }, [camera]);
  useEffect(() => {
    let drag: { x: number; y: number; moved: number } | null = null;
    const down = (e: KeyboardEvent) => {
      if (typingInField()) return;
      if (e.ctrlKey || e.altKey || e.metaKey) {
        keys.current.clear();
        return;
      }
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        keys.current.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    // Anything that can swallow a keyup (context menu, alt-tab, a dialog) must stop you walking.
    const blur = () => {
      keys.current.clear();
      drag = null;
    };
    const vis = () => document.hidden && blur();
    const anyCtx = (e: Event) => {
      blur();
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('contextmenu', anyCtx, true);
    // drag to look
    const el = gl.domElement;
    const pd = (e: PointerEvent) => {
      pointerGuard.dragged = false;
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 5) pointerGuard.dragged = true;
      walker.yaw -= dx * 0.0045;
      walker.pitch = Math.max(-1.2, Math.min(1.0, walker.pitch - dy * 0.0035));
    };
    const pu = () => {
      drag = null;
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    el.addEventListener('contextmenu', ctx);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('contextmenu', anyCtx, true);
      keys.current.clear();
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      el.removeEventListener('contextmenu', ctx);
      pointerGuard.dragged = false;
    };
  }, [gl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const k = keys.current;
    const turn = (k.has('q') || k.has('arrowleft') ? 1 : 0) - (k.has('e') || k.has('arrowright') ? 1 : 0);
    walker.yaw += turn * dt * 1.8;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const moving = fwd !== 0 || strafe !== 0;
    if (moving) {
      const speed = (k.has('shift') ? 30 : 15) * dt;
      const sin = Math.sin(walker.yaw);
      const cos = Math.cos(walker.yaw);
      let nx = walker.x + (-sin * fwd + cos * strafe) * speed;
      let nz = walker.z + (-cos * fwd - sin * strafe) * speed;
      nx = Math.max(hallMinX, Math.min(hallMaxX, nx));
      nz = Math.max(-WALL_Z, Math.min(WALL_Z, nz));
      const r = 0.7;
      // the workroom wall: you can only pass through the doorway
      const inDoor = nz > ROOM.door[0] + r && nz < ROOM.door[1] - r;
      if (walker.x < roomX0 && nx > roomX0 - r && !inDoor) nx = roomX0 - r;
      if (walker.x >= roomX0 && nx < roomX0 + r && !inDoor) nx = roomX0 + r;
      if (nx >= roomX0) {
        nz = Math.max(ROOM.z0 + r, Math.min(ROOM.z1 - r, nz));
        nx = Math.min(roomX0 + ROOM.depth - 5.6, nx); // shelving along the back wall
        const desk = roomSpots(roomX0).desk;
        if (Math.abs(nz - desk.z) < 3.4 && nx > desk.x - 7 && nx < roomX0 + 25) nz = desk.z + 3.4; // desk + RMA bench
      }
      // the row of racks is solid: slide along it instead of walking through
      if (nx > rowMinX - r && nx < rowMaxX + r && Math.abs(nz) < ROW_HALF + r) {
        const penX = Math.min(nx - (rowMinX - r), rowMaxX + r - nx);
        const penZ = ROW_HALF + r - Math.abs(nz);
        if (penZ < penX) nz = Math.sign(walker.z || nz || 1) * (ROW_HALF + r);
        else nx = nx - (rowMinX - r) < rowMaxX + r - nx ? rowMinX - r : rowMaxX + r;
      }
      walker.x = nx;
      walker.z = nz;
    }
    camera.position.set(walker.x, EYE + (moving ? Math.sin(performance.now() / 120) * 0.08 : 0), walker.z);
    camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
    // which rack face am I standing at?
    let zone = `aisle:${walker.z >= 0 ? 'front' : 'rear'}`;
    if (walker.x >= roomX0) zone = walker.x < roomX0 + 13 ? 'noc:front' : 'cage:front';
    else for (const rk of racks) {
      const rx = rackX(rk, origin);
      if (Math.abs(walker.x - rx) <= RACK_W / 2 + 0.4 && Math.abs(walker.z) >= ROW_HALF && Math.abs(walker.z) <= ROW_HALF + 6) {
        zone = `${rk.id}:${walker.z >= 0 ? 'front' : 'rear'}`;
        break;
      }
    }
    if (zone !== walker.zone) {
      walker.zone = zone;
      const [to, side] = zone.split(':') as [string, 'front' | 'rear'];
      const st = useStore.getState();
      if (st.world && (st.world.trainee.location !== to || st.world.trainee.side !== side)) st.dispatch({ type: 'arrive', to, side });
    }
    const now = performance.now();
    if (now - lastNotify.current > 150) {
      lastNotify.current = now;
      notifyWalker();
    }
  });
  return null;
}

/** You, seen from the orbit camera. */
function Avatar() {
  const wk = useWalker();
  const g = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (g.current) g.current.visible = camera.position.distanceTo(g.current.position) > 14;
  });
  if (!wk.init) return null;
  return (
    <group ref={g} position={[wk.x, 0, wk.z]} rotation={[0, wk.yaw, 0]}>
      <mesh position={[0, 8.5, 0]} castShadow>
        <capsuleGeometry args={[1.5, 9, 6, 12]} />
        <meshStandardMaterial color="#2bb3a3" roughness={0.6} />
      </mesh>
      <mesh position={[0, 16, 0]} castShadow>
        <sphereGeometry args={[1.3, 16, 12]} />
        <meshStandardMaterial color="#f2c9a0" roughness={0.7} />
      </mesh>
      {/* hard-hat-ish cap + badge so you can tell which way you face */}
      <mesh position={[0, 16.9, -0.4]}>
        <sphereGeometry args={[1.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ffd166" roughness={0.5} />
      </mesh>
      <mesh position={[0, 11.5, -1.55]}>
        <boxGeometry args={[0.9, 1.2, 0.1]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.2, 2.6, 32]} />
        <meshBasicMaterial color="#2bb3a3" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Hall({ minX, maxX, minP, maxP, origin }: { minX: number; maxX: number; minP: number; maxP: number; origin: number }) {
  const tiles = useMemo(
    () =>
      canvasTex(
        `floor`,
        256,
        256,
        (g) => {
          g.fillStyle = '#c3c9d0';
          g.fillRect(0, 0, 256, 256);
          g.strokeStyle = '#9aa3ad';
          g.lineWidth = 5;
          g.strokeRect(0, 0, 256, 256);
          g.fillStyle = '#b3bac2';
          for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if ((x + y) % 2 === 0) g.fillRect(24 + x * 13, 24 + y * 13, 5, 5);
        },
        [1, 1],
      ),
    [],
  );
  const tex = useMemo(() => {
    const t = tiles.clone();
    t.needsUpdate = true;
    t.repeat.set((maxX - minX + 60) / 6, (WALL_Z * 2 + 24) / 6);
    return t;
  }, [tiles, minX, maxX]);
  const dummyRow = [];
  for (let p = minP - 4; p <= maxP + 4; p++) dummyRow.push(p);
  const midX = (minX + maxX) / 2;
  const len = maxX - minX + 60;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[midX, 0, 0]} receiveShadow>
        <planeGeometry args={[len, WALL_Z * 2 + 24]} />
        <meshStandardMaterial map={tex} roughness={0.9} metalness={0.05} />
      </mesh>
      {/* perforated cold-aisle tiles in front of every rack */}
      {dummyRow.map((p) => (
        <mesh key={`vt${p}`} rotation={[-Math.PI / 2, 0, 0]} position={[(p - origin) * RACK_PITCH, 0.012, ROW_HALF + 3.2]} receiveShadow>
          <planeGeometry args={[5.9, 5.9]} />
          <meshStandardMaterial map={ventTileTex()} roughness={0.8} metalness={0.2} />
        </mesh>
      ))}
      {/* yellow safety lines along the aisles */}
      {[ROW_HALF + 0.6, -(ROW_HALF + 0.6)].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[midX, 0.02, z]}>
          <planeGeometry args={[len, 0.12]} />
          <meshBasicMaterial color="#f2c230" />
        </mesh>
      ))}
      {/* ceiling with light panels */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[midX, 31, 0]}>
        <planeGeometry args={[len, WALL_Z * 2 + 24]} />
        <meshStandardMaterial color="#eef1f4" roughness={1} />
      </mesh>
      {Array.from({ length: Math.ceil(len / 12) }, (_, i) =>
        [-OPPOSITE_Z / 2 - 3, OPPOSITE_Z / 2 + 3].map((z) => (
          <mesh key={`${i}${z}`} position={[midX - len / 2 + 6 + i * 12, 30.9, z]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[7, 1.4]} />
            <meshBasicMaterial color={[1.6, 1.65, 1.7]} toneMapped={false} />
          </mesh>
        )),
      )}
      {/* neighbouring rows across the cold and hot aisles */}
      {dummyRow.map((p) => (
        <group key={p}>
          <DummyRack x={(p - origin) * RACK_PITCH} z={OPPOSITE_Z} flip />
          <DummyRack x={(p - origin) * RACK_PITCH} z={-OPPOSITE_Z} flip />
        </group>
      ))}
      {/* aisle signs */}
      {[
        { z: WALL_Z * 0.5, text: '❄ COLD AISLE · FRONT OF RACKS', bg: '#2f7de1' },
        { z: -WALL_Z * 0.5, text: '🔥 HOT AISLE · REAR OF RACKS', bg: '#e1442f' },
      ].map((s) => (
        <mesh key={s.z} position={[midX, 26, s.z]}>
          <planeGeometry args={[9, 1.1]} />
          <meshBasicMaterial
            map={canvasTex(`sign${s.text}`, 512, 64, (g) => {
              g.fillStyle = s.bg;
              g.fillRect(0, 0, 512, 64);
              g.fillStyle = '#fff';
              g.font = 'bold 30px system-ui, sans-serif';
              g.textAlign = 'center';
              g.textBaseline = 'middle';
              g.fillText(s.text, 256, 34);
            })}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Perforated blanking panels in every empty U so a full rack looks (and breathes) like a real one. */
function BlankingPanels({ racks, origin, buildRackId }: { racks: Rack[]; origin: number; buildRackId?: string }) {
  const devices = useStore((s) => s.world!.devices);
  const rails = racks.map((r) => r.rails);
  const panels = useMemo(() => {
    const out: Array<{ key: string; x: number; y: number }> = [];
    for (const r of racks) {
      if (r.id === buildRackId) continue;
      const used = new Set<number>();
      for (const d of Object.values(devices)) if (d.rackId === r.id && d.u != null) for (let i = 0; i < d.heightU; i++) used.add(d.u + i);
      for (const [uStr, rl] of Object.entries(r.rails)) for (let i = 0; i < rl.heightU; i++) used.add(Number(uStr) + i);
      for (let u = 1; u <= r.heightU; u++) if (!used.has(u)) out.push({ key: `${r.id}${u}`, x: rackX(r, origin), y: uBaseY(u) + U / 2 });
    }
    return out;
  }, [racks, devices, origin, buildRackId, rails]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {panels.map((p) => (
        <mesh key={p.key} position={[p.x, p.y, FRONT_RAIL_Z + 0.06]} raycast={() => null}>
          <planeGeometry args={[4.6, U * 0.96]} />
          <meshStandardMaterial map={blankTex()} metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

export function RackScene({ buildMode = false }: { buildMode?: boolean }) {
  const w = useStore((s) => s.world!);
  const inst = useStore((s) => s.inst!);
  const sel = useStore((s) => s.sel);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const camMode = useStore((s) => s.camMode);
  const pendingPort = useStore((s) => s.pendingPort);
  const quality = useStore((s) => s.progress.settings.quality);
  const coach = useCoach();

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
  const rowMinX = (minP - origin) * RACK_PITCH - RACK_W / 2;
  const rowMaxX = (maxP - origin) * RACK_PITCH + RACK_W / 2;
  const roomX0 = rowMaxX + 26;

  const devices = useMemo(() => Object.values(w.devices).filter((d) => d.rackId && rackIds.has(d.rackId)), [w.devices, rackIds]);
  const cablesSig = useMemo(() => Object.values(w.cables).map((c) => `${c.a?.port}${c.b?.port}${c.condition}`).join() + devices.map((d) => d.power + d.os).join(), [w.cables, devices]);

  // Put the walker where the sim says you are (start of scenario, "Walk here" buttons, aisle switches).
  const loc = w.trainee.location;
  const side = w.trainee.side;
  useEffect(() => {
    const key = `${loc}:${side}`;
    const r = loc ? w.racks[loc] : undefined;
    if (walker.init && walker.zone === key) return;
    if (r && rackIds.has(r.id)) {
      walker.x = rackX(r, origin);
      walker.z = side === 'rear' ? -AISLE_Z : AISLE_Z;
      walker.yaw = side === 'rear' ? Math.PI : 0;
      walker.pitch = -0.12;
      walker.zone = key;
      walker.init = true;
    } else if (loc === 'noc' || loc === 'cage') {
      // In the DCO workroom: at the laptop desk, or in front of the shelves.
      const sp = roomSpots(roomX0);
      if (loc === 'noc') {
        walker.x = sp.desk.x;
        walker.z = sp.desk.z + 5.2;
        walker.yaw = 0;
      } else {
        walker.x = roomX0 + 18;
        walker.z = 2;
        walker.yaw = -Math.PI / 2;
      }
      walker.pitch = -0.2;
      walker.zone = `${loc}:front`;
      walker.init = true;
    } else if (!walker.init) {
      walker.x = rowMaxX + 8;
      walker.z = WALL_Z - 2;
      walker.yaw = Math.PI / 2 - 0.3;
      walker.pitch = -0.1;
      walker.zone = 'aisle:front';
      walker.init = true;
    }
    notifyWalker();
  }, [loc, side, origin, rackIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const store = useStore.getState;
  const guard = () => pointerGuard.dragged;
  const onRack = useCallback((id: string) => !guard() && store().select({ rackId: id }), [store]);
  const onDevice = useCallback(
    (id: string) => {
      if (guard()) return;
      const d = store().world!.devices[id];
      store().select({ deviceId: id, rackId: d.rackId ?? undefined });
      store().setCamMode('inspect');
    },
    [store],
  );
  const onSlot = useCallback(
    (id: string, slot: string) => {
      if (guard()) return;
      const d = store().world!.devices[id];
      store().select({ deviceId: id, slot, rackId: d.rackId ?? undefined });
      store().setCamMode('inspect');
      const def = MODELS[d.model].slots.find((s) => s.id === slot);
      if (def) store().unlockCodex(`kind:${def.kind}`);
      if (slot === 'PSU1' || slot === 'PSU2') store().unlockCodex('tool:pdu');
    },
    [store],
  );
  const onFastener = useCallback(
    (id: string, target: string, fid: string) => {
      if (guard()) return;
      const st = store();
      const d = st.world!.devices[id];
      const parent = target === 'chassis' ? undefined : target === 'lid' || target === 'riser1' || target === 'riser2' ? `layer:${target}` : target;
      st.select({ deviceId: id, slot: parent, rackId: d.rackId ?? undefined });
      st.dispatch({ type: 'fastener', deviceId: id, target, id: fid, secure: !isTight(d, target, fid) });
    },
    [store],
  );
  const onLatch = useCallback(
    (id: string, slot: string) => {
      if (guard()) return;
      const st = store();
      const d = st.world!.devices[id];
      st.select({ deviceId: id, slot, rackId: d.rackId ?? undefined });
      st.dispatch({ type: 'latch', deviceId: id, slot, state: d.latches[slot] === 'open' ? 'closed' : 'open' });
    },
    [store],
  );
  const onPort = useCallback(
    (id: string, port: string) => {
      if (guard()) return;
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
  // Keep the camera on the server the cable plugs into (instead of flying back to the whole rack).
  const onCable = useCallback(
    (id: string) => {
      if (guard()) return;
      const st = store();
      const c = st.world!.cables[id];
      const ends = [c?.a, c?.b].filter(Boolean).map((e) => st.world!.devices[e!.deviceId]);
      const srv = ends.find((d) => d?.role === 'server') ?? ends[0];
      st.select({ cableId: id, deviceId: srv?.id ?? st.sel.deviceId, rackId: srv?.rackId ?? st.sel.rackId });
      st.setCamMode('inspect');
      if (st.view !== 'rear') st.setView('rear');
    },
    [store],
  );
  const onRoom = useCallback(
    (room: string) => {
      if (guard()) return;
      store().select({ room });
      store().setCamMode('inspect');
    },
    [store],
  );
  const onU = useCallback((u: number) => !guard() && store().select({ rackId: focusRack.id, u }), [store, focusRack.id]);

  // camera goal (inspect mode)
  const goal = useMemo(() => {
    const rx = rackX(focusRack, origin);
    const rear = view === 'rear';
    const dz = rear ? -1 : 1;
    const dev = sel.deviceId ? w.devices[sel.deviceId] : undefined;
    const k = `${camMode}`;
    if (dev?.rackId && rackIds.has(dev.rackId)) {
      const o = deviceOrigin(dev, rackX(w.racks[dev.rackId], origin));
      // Panels cover the left of the screen, so aim a little to the left of the part: it lands right of centre.
      const left = new THREE.Vector3(rear ? 1.3 : -1.3, 0, 0);
      const lay = sel.slot ? MODELS[dev.model].layout[sel.slot] : undefined;
      if (dev.servicePosition && !rear) {
        const t = o.clone().add(new THREE.Vector3(0, 0.4, 0.3)).add(left);
        return { target: t, pos: t.clone().add(new THREE.Vector3(0.6, 7.5, 6.5)), key: `${dev.id}-svc-${view}${k}` };
      }
      const t = o.clone().add(new THREE.Vector3(lay && !dev.servicePosition ? lay.x : 0, 0.4, rear ? -3.4 : 3.6)).add(left);
      return { target: t, pos: t.clone().add(new THREE.Vector3(rear ? -1.2 : 1.2, 1.6, 6.2 * dz)), key: `${dev.id}-${view}${k}-${lay ? sel.slot : ''}` };
    }
    if (sel.room) {
      const sp = roomSpots(roomX0);
      if (sel.room.startsWith('shelf:')) {
        const t = sp.shelf(sel.room.slice(6) as ComponentKind).clone().add(new THREE.Vector3(0, 0.5, 0));
        return { target: t.add(new THREE.Vector3(0, 0, -1.5)), pos: t.clone().add(new THREE.Vector3(-13, 4.5, 4)), key: `${sel.room}${k}` };
      }
      const t = (sel.room === 'rma' ? sp.rma.clone().add(new THREE.Vector3(0, -1, 2)) : sp.desk.clone().add(new THREE.Vector3(0, 1, 0))).add(new THREE.Vector3(-1.5, 0, 0));
      return { target: t, pos: t.clone().add(new THREE.Vector3(1, 5, 11)), key: `${sel.room}${k}` };
    }
    if (sel.u) {
      const t = new THREE.Vector3(rx, uBaseY(sel.u), 4.9);
      return { target: t, pos: t.clone().add(new THREE.Vector3(2, 1.5, 7)), key: `u${sel.u}${k}` };
    }
    const t = new THREE.Vector3(rx, 9.5, 0);
    return { target: t, pos: new THREE.Vector3(rx + 3, 11, 24 * dz), key: `${focusRack.id}-${view}${k}` };
  }, [sel.deviceId, sel.slot, sel.u, sel.room, focusRack, origin, view, w.devices, w.racks, rackIds, camMode, roomX0]);

  const hl = mode === 'learn' && typeof w.meta.hlDevice === 'string' ? { dev: w.meta.hlDevice as string, slot: w.meta.hlSlot as string } : null;
  const xs = racks.map((r) => rackX(r, origin));
  // Coach marker: what to touch next (learn mode, or practice after "Show me how")
  const gt = coach.visible ? coach.current?.target : undefined;
  const guideDev = gt?.deviceId && w.devices[gt.deviceId]?.rackId && rackIds.has(w.devices[gt.deviceId].rackId!) ? w.devices[gt.deviceId] : undefined;
  const beacon = useMemo(() => {
    if (!guideDev) return null;
    const o = deviceOrigin(guideDev, rackX(w.racks[guideDev.rackId!], origin));
    const rear = gt?.side === 'rear';
    return o.add(new THREE.Vector3(0, 0.9, rear ? -4.3 : guideDev.servicePosition ? 0 : 4.3));
  }, [guideDev, gt?.side, origin, w.racks]);

  const roomBeacon = useMemo(() => {
    if (!gt?.room) return null;
    const sp = roomSpots(roomX0);
    const p = gt.room.startsWith('shelf:') ? sp.shelf(gt.room.slice(6) as ComponentKind) : gt.room === 'rma' ? sp.rma : sp.desk;
    return p.clone().add(new THREE.Vector3(0, 2.5, 0));
  }, [gt?.room, roomX0]);
  void SHELF_KINDS;

  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={quality === 'high' ? [1, 2] : 1}
      camera={{ position: [3, 11, 24], fov: 45, near: 0.1, far: 400 }}
      onPointerMissed={() => {
        if (pointerGuard.dragged) return;
        const st = store();
        if (st.sel.slot || st.sel.cableId) st.select({ deviceId: st.sel.deviceId, rackId: st.sel.rackId });
      }}
      gl={{ antialias: quality === 'high' }}
    >
      <color attach="background" args={['#dfe6ec']} />
      <fog attach="fog" args={['#dfe6ec', 70, 190]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#ffffff', '#9aa3ad', 0.7]} />
      <directionalLight position={[10, 30, 20]} intensity={1.1} castShadow={quality === 'high'} />
      <directionalLight position={[-10, 20, -20]} intensity={0.7} />
      {xs.map((x) => (
        <pointLight key={x} position={[x, 24, 10]} intensity={30} distance={30} color="#f4f8ff" />
      ))}
      <Look />
      <BlankingPanels racks={racks} origin={origin} buildRackId={buildMode ? focusRack.id : undefined} />
      <Hall minX={(minP - origin) * RACK_PITCH} maxX={(maxP - origin) * RACK_PITCH} minP={minP} maxP={maxP} origin={origin} />
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
              lod={sel.deviceId === d.id || guideDev?.id === d.id || pendingPort?.deviceId === d.id || hl?.dev === d.id ? 'full' : 'low'}
              detail={sel.deviceId === d.id}
              selected={sel.deviceId === d.id}
              selSlot={sel.deviceId === d.id ? sel.slot : undefined}
              highlightSlot={hl && hl.dev === d.id ? hl.slot : undefined}
              guide={guideDev?.id === d.id ? gt?.sel : undefined}
              pendingPort={pendingPort?.deviceId === d.id ? pendingPort.port : null}
              onDevice={onDevice}
              onSlot={onSlot}
              onPort={onPort}
              onFastener={onFastener}
              onLatch={onLatch}
            />
          );
        return <SwitchMesh key={d.id} lod={r.id === focusRack.id ? 'full' : 'low'} dev={d} x={x} selected={sel.deviceId === d.id} pendingPort={pendingPort?.deviceId === d.id ? pendingPort.port : null} onDevice={onDevice} onPort={onPort} cablesSig={cablesSig} />;
      })}
      <Cables w={w} originPos={origin} rackIds={rackIds} selCable={sel.cableId} onCable={onCable} detailRack={focusRack.id} />
      {beacon && <GuideBeacon position={beacon} />}
      {roomBeacon && <GuideBeacon position={roomBeacon} />}
      <Workroom x0={roomX0} spares={w.spares} guide={gt?.room ? `room:${gt.room}`.replace('room:shelf', 'shelf') : undefined} onSelect={onRoom} />
      {camMode === 'inspect' && !sel.deviceId && !sel.cableId && !sel.room && <Avatar />}
      {camMode === 'inspect' ? (
        <>
          <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={70} />
          <CameraRig goal={goal} />
        </>
      ) : (
        <WalkController racks={racks} origin={origin} rowMinX={rowMinX} rowMaxX={rowMaxX} hallMinX={rowMinX - 26} roomX0={roomX0} />
      )}
    </Canvas>
  );
}
