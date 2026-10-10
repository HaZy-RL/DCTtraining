// Shared 3D primitives: LEDs, canvas-texture labels, rack geometry and world-space positions.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { MODELS } from '../../../engine/catalog';
import { parseOutlet, type Led as LedState } from '../../../engine/projectors';
import type { Device, Rack, World } from '../../../engine/types';

// ---------- dimensions (1 unit = 10 cm) ----------
export const U = 0.4445;
export const RACK_W = 6.0;
export const RACK_D = 10.7;
export const RACK_PITCH = 6.15;
export const PLINTH = 0.6;
export const FRONT_RAIL_Z = 4.9;
export const REAR_RAIL_Z = -4.9;
export const CHASSIS_D = 7.5;
export const SERVICE_OUT = 6.5;
export const PDU_X = { A: 2.72, B: -2.72 } as const;
export const PDU_Z = -5.05;

export const uBaseY = (u: number) => PLINTH + (u - 1) * U;

/** X offset of a rack in the row-relative scene. */
export function rackX(rack: Rack, originPos: number): number {
  return (rack.position - originPos) * RACK_PITCH;
}

/** Position of a device group (chassis-local origin = centre of chassis floor). */
export function deviceOrigin(dev: Device, rackXPos: number): THREE.Vector3 {
  const y = uBaseY(dev.u ?? 1);
  if (dev.role === 'switch' || dev.role === 'mgmt_switch') return new THREE.Vector3(rackXPos, y, REAR_RAIL_Z + 2.25);
  return new THREE.Vector3(rackXPos, y, FRONT_RAIL_Z - CHASSIS_D / 2 + (dev.servicePosition ? SERVICE_OUT : 0));
}

/** Chassis-local position of a port. */
export function portLocal(dev: Device, port: string): THREE.Vector3 {
  if (dev.role === 'switch' || dev.role === 'mgmt_switch') {
    const n = Number(port.replace(/\D/g, ''));
    if (dev.role === 'switch' && n > 48) return new THREE.Vector3(1.32 + (n - 49) * 0.1, 0.22, -2.26);
    const col = (n - 1) % 24;
    const row = n <= 24 ? 1 : 0;
    return new THREE.Vector3(-2.05 + col * 0.135, 0.12 + row * 0.15, -2.26);
  }
  const rz = -CHASSIS_D / 2 - 0.01;
  switch (port) {
    case 'nic0p0':
      return new THREE.Vector3(-1.85, 0.11, rz);
    case 'nic0p1':
      return new THREE.Vector3(-1.45, 0.11, rz);
    case 'bmc':
      return new THREE.Vector3(-0.95, 0.3, rz);
    case 'PSU1':
      return new THREE.Vector3(1.97, 0.2, rz);
    case 'PSU2':
      return new THREE.Vector3(1.97, 0.62, rz);
  }
  return new THREE.Vector3(0, 0.4, rz);
}

export function portWorld(w: World, devId: string, port: string, originPos: number): THREE.Vector3 | null {
  const d = w.devices[devId];
  if (!d?.rackId) return null;
  const r = w.racks[d.rackId];
  return deviceOrigin(d, rackX(r, originPos)).add(portLocal(d, port));
}

export function outletWorld(w: World, outlet: string, originPos: number): THREE.Vector3 | null {
  const p = parseOutlet(outlet);
  if (!p || !w.racks[p.rackId]) return null;
  const x = rackX(w.racks[p.rackId], originPos) + PDU_X[p.side];
  return new THREE.Vector3(x, 1.4 + (p.n - 1) * 0.72, PDU_Z + 0.12);
}

// ---------- LEDs ----------

const LED_COLORS: Record<string, string> = { green: '#2bff6a', amber: '#ffae2b', blue: '#3d8bff', red: '#ff3b3b', off: '#1a1a1a' };

export function Led({ state, position, size = 0.05, period = 1 }: { state: LedState | 'red' | 'blue'; position: [number, number, number]; size?: number; period?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const [color, blink] = useMemo(() => {
    if (state === 'off') return ['off', false];
    const [c, b] = state.split('_');
    return [c, b === 'blink'];
  }, [state]);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    if (!blink) {
      mat.current.opacity = 1;
      return;
    }
    mat.current.opacity = Math.floor(clock.elapsedTime / (period / 2)) % 2 === 0 ? 1 : 0.15;
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 10, 8]} />
      <meshBasicMaterial ref={mat} color={LED_COLORS[color]} transparent toneMapped={false} />
    </mesh>
  );
}

// ---------- labels ----------

const texCache = new Map<string, THREE.CanvasTexture>();

export function labelTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string; align?: CanvasTextAlign } = {}): THREE.CanvasTexture {
  const key = JSON.stringify([text, opts]);
  const hit = texCache.get(key);
  if (hit) return hit;
  const w = opts.w ?? 256;
  const h = opts.h ?? 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg ?? '#111111';
  g.font = opts.font ?? `bold ${Math.round(h * 0.55)}px ui-monospace, Menlo, monospace`;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => g.fillText(l, opts.align === 'left' ? 8 : w / 2, (h / (lines.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

export function Label({ text, position, rotation, size, opts }: { text: string; position: [number, number, number]; rotation?: [number, number, number]; size: [number, number]; opts?: Parameters<typeof labelTexture>[1] }) {
  const tex = useMemo(() => labelTexture(text, opts), [text, opts]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={tex} toneMapped={false} transparent />
    </mesh>
  );
}

// ---------- materials ----------

export const MAT = {
  chassis: new THREE.MeshStandardMaterial({ color: '#3a414b', metalness: 0.6, roughness: 0.45 }),
  chassisDark: new THREE.MeshStandardMaterial({ color: '#23282f', metalness: 0.5, roughness: 0.55 }),
  bezel: new THREE.MeshStandardMaterial({ color: '#181c22', metalness: 0.3, roughness: 0.6 }),
  rack: new THREE.MeshStandardMaterial({ color: '#15181d', metalness: 0.5, roughness: 0.6 }),
  post: new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.7, roughness: 0.4 }),
  pcb: new THREE.MeshStandardMaterial({ color: '#0f4d2c', metalness: 0.2, roughness: 0.7 }),
  pcbDark: new THREE.MeshStandardMaterial({ color: '#0b2e1d', metalness: 0.2, roughness: 0.8 }),
  chip: new THREE.MeshStandardMaterial({ color: '#111111', metalness: 0.3, roughness: 0.5 }),
  silver: new THREE.MeshStandardMaterial({ color: '#b9c0c8', metalness: 0.9, roughness: 0.25 }),
  copper: new THREE.MeshStandardMaterial({ color: '#c98a4b', metalness: 0.9, roughness: 0.35 }),
  plastic: new THREE.MeshStandardMaterial({ color: '#0e0f11', metalness: 0.1, roughness: 0.8, transparent: true, opacity: 0.85 }),
  blueTouch: new THREE.MeshStandardMaterial({ color: '#2f7de1', metalness: 0.1, roughness: 0.6 }),
  orangeTouch: new THREE.MeshStandardMaterial({ color: '#e57a22', metalness: 0.1, roughness: 0.6 }),
  port: new THREE.MeshStandardMaterial({ color: '#0a0a0a', metalness: 0.2, roughness: 0.6 }),
  floor: new THREE.MeshStandardMaterial({ color: '#2a3038', metalness: 0.1, roughness: 0.9 }),
};

export function chassisLen(dev: Device): number {
  return dev.role === 'server' ? CHASSIS_D : 4.5;
}

export function modelOf(dev: Device) {
  return MODELS[dev.model];
}

// ---------- interaction helpers ----------

/** Set by the walk controller when the pointer was dragged to look around, so the release isn't treated as a click. */
export const pointerGuard = { dragged: false };

export function hoverCursor(cursor = 'pointer') {
  return {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      document.body.style.cursor = cursor;
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
    },
  };
}

const guideMat = new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
const guideEdgeMat = new THREE.LineBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, toneMapped: false });
let guidePulseFrame = -1;

/** Pulsing gold highlight around whatever the coach wants you to touch next. */
export function GuideGlow({ position, size, rotation }: { position: [number, number, number] | THREE.Vector3; size: [number, number, number]; rotation?: [number, number, number] }) {
  const geo = useMemo(() => new THREE.BoxGeometry(size[0] + 0.05, size[1] + 0.05, size[2] + 0.05), [size[0], size[1], size[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useFrame(({ clock }, _dt, frame) => {
    void frame;
    if (guidePulseFrame === Math.floor(clock.elapsedTime * 60)) return;
    guidePulseFrame = Math.floor(clock.elapsedTime * 60);
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5);
    guideMat.opacity = 0.12 + 0.3 * k;
    guideEdgeMat.opacity = 0.5 + 0.5 * k;
  });
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geo} material={guideMat} renderOrder={10} raycast={() => null} />
      <lineSegments geometry={edges} material={guideEdgeMat} renderOrder={11} raycast={() => null} />
    </group>
  );
}

/** Bouncing arrow over a device, visible from across the hall. */
export function GuideBeacon({ position }: { position: THREE.Vector3 }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    g.current.position.y = position.y + 0.9 + Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.5;
    g.current.rotation.y = clock.elapsedTime * 1.5;
  });
  return (
    <group ref={g} position={[position.x, position.y + 1, position.z]}>
      <mesh rotation={[Math.PI, 0, 0]} raycast={() => null}>
        <coneGeometry args={[0.35, 0.7, 4]} />
        <meshBasicMaterial color="#ffd166" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------- procedural textures ----------

const canvasCache = new Map<string, THREE.CanvasTexture>();

export function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  canvasCache.set(key, t);
  return t;
}

/** Perforated honeycomb grille (PSU and drive faces, rear vents). */
export function grilleTex(base = '#2b3038', hole = '#07090b'): THREE.CanvasTexture {
  return canvasTex(`grille${base}${hole}`, 128, 128, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = hole;
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        g.beginPath();
        g.arc(7 + x * 14 + (y % 2 ? 7 : 0), 7 + y * 14, 4.6, 0, Math.PI * 2);
        g.fill();
      }
  });
}

/** DDR5 RDIMM side: green PCB, memory packages, label, gold fingers. */
export function dimmTex(): THREE.CanvasTexture {
  return canvasTex('dimm', 512, 96, (g) => {
    g.fillStyle = '#0f5a32';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#d4a63a';
    for (let x = 4; x < 508; x += 6) g.fillRect(x, 84, 4, 12);
    g.fillStyle = '#16181b';
    for (let i = 0; i < 10; i++) g.fillRect(14 + i * 49 + (i >= 5 ? 6 : 0), 14, 38, 30);
    g.fillStyle = '#e9edf0';
    g.fillRect(180, 50, 150, 26);
    g.fillStyle = '#222';
    g.font = 'bold 13px monospace';
    g.fillText('64GB 2Rx4 DDR5-5600', 186, 68);
    g.fillStyle = '#111';
    g.fillRect(238, 82, 8, 14); // key notch
  });
}

/** CPU integrated heat spreader with laser-etched marking. */
export function ihsTex(): THREE.CanvasTexture {
  return canvasTex('ihs', 256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#cfd5db');
    grad.addColorStop(1, '#9aa3ad');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#5b636c';
    g.font = 'bold 22px monospace';
    g.fillText('SP-X5', 24, 60);
    g.font = '16px monospace';
    g.fillText('64C 2.4GHz 350W', 24, 92);
    g.fillText('CPU-X5-64C-2.4', 24, 120);
    g.fillText('Q3 2025  ▣▣▣', 24, 148);
    g.fillStyle = '#d4a63a';
    g.beginPath();
    g.moveTo(8, 248);
    g.lineTo(40, 248);
    g.lineTo(8, 216);
    g.fill();
  });
}

export function pcbTex(): THREE.CanvasTexture {
  return canvasTex('pcb', 512, 512, (g) => {
    g.fillStyle = '#0b3a24';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#12573a';
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % 512;
      const y = (i * 53) % 512;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + ((i * 31) % 120) - 60, y);
      g.lineTo(x + ((i * 31) % 120) - 60, y + ((i * 17) % 90));
      g.stroke();
    }
    g.fillStyle = '#e9edf0';
    g.font = 'bold 18px monospace';
    g.fillText('HX-MB-2S  REV C', 20, 490);
  });
}

/** Asset-tag sticker: Code-128-style bars (deterministic per tag) with the human-readable tag under it. */
export function barcodeTex(text: string): THREE.CanvasTexture {
  return canvasTex(`bc${text}`, 160, 320, (g) => {
    g.fillStyle = '#f7f7f2';
    g.fillRect(0, 0, 160, 320);
    // bars run across the sticker; the sticker sits vertically on the rack ear
    g.save();
    g.translate(160, 0);
    g.rotate(Math.PI / 2);
    let h = 7;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    g.fillStyle = '#111';
    let x = 18;
    g.fillRect(x, 20, 4, 96);
    x += 7;
    while (x < 290) {
      h = (h * 1103515245 + 12345) >>> 0;
      const wbar = 2 + (h % 4) * 1.6;
      g.fillRect(x, 20, wbar, 96);
      x += wbar + 2 + ((h >> 5) % 3) * 1.6;
    }
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.fillText(text, 160, 148);
    g.restore();
  });
}

/** Drive-carrier faceplate: perforated upper section, label window, release button recess. */
export function carrierTex(kind: 'hdd' | 'nvme'): THREE.CanvasTexture {
  return canvasTex(`carrier${kind}`, 256, kind === 'hdd' ? 64 : 256, (g) => {
    const W = 256;
    const Hh = kind === 'hdd' ? 64 : 256;
    g.fillStyle = '#3d444e';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#0d1014';
    const cols = kind === 'hdd' ? 20 : 7;
    const rows = kind === 'hdd' ? 3 : 18;
    const x0 = kind === 'hdd' ? 70 : 30;
    const y0 = kind === 'hdd' ? 10 : 40;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        g.beginPath();
        g.arc(x0 + c * 8 + (r % 2 ? 4 : 0), y0 + r * 8, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    g.strokeStyle = '#59616c';
    g.lineWidth = 3;
    g.strokeRect(2, 2, W - 4, Hh - 4);
  });
}

/** Chassis lid / top: brushed panel with a vent row and seams. */
export function lidTex(): THREE.CanvasTexture {
  return canvasTex('lid', 512, 512, (g) => {
    g.fillStyle = '#6b7480';
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 3) {
      g.fillStyle = `rgba(255,255,255,${0.02 + ((y * 7919) % 13) / 400})`;
      g.fillRect(0, y, 512, 1);
    }
    g.fillStyle = '#2b3038';
    for (let i = 0; i < 26; i++) g.fillRect(40 + i * 17, 26, 9, 46);
    g.fillStyle = '#4e5661';
    g.fillRect(0, 300, 512, 3);
  });
}

/**
 * Animates a part sliding into its slot when it appears and out of it when it is removed.
 * `item` is the part (or `true` for a cover/layer); while it slides out, the last value is still rendered.
 */
export function SlideAnim<T>({ item, dir, dist = 1, speed = 1.6, children }: { item: T | null | undefined | false; dir: [number, number, number]; dist?: number; speed?: number; children: (it: T) => ReactNode }) {
  const [shown, setShown] = useState<T | null>(item || null);
  const st = useRef<{ phase: 'idle' | 'in' | 'out'; t: number; first: boolean }>({ phase: 'idle', t: 1, first: true });
  const g = useRef<THREE.Group>(null);
  const idOf = (x: unknown) => (x && typeof x === 'object' && 'uid' in x ? (x as { uid: string }).uid : !!x);
  useEffect(() => {
    const s = st.current;
    if (s.first) {
      s.first = false;
      return;
    }
    if (item) {
      if (!shown || idOf(shown) !== idOf(item) || s.phase === 'out') {
        s.phase = 'in';
        s.t = 0;
      }
      setShown(item);
    } else if (shown && s.phase !== 'out') {
      s.phase = 'out';
      s.t = 0;
    }
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const s = st.current;
    if (!g.current) return;
    if (s.phase === 'idle') {
      g.current.position.set(0, 0, 0);
      return;
    }
    s.t = Math.min(1, s.t + dt * speed);
    const e = s.t < 0.5 ? 2 * s.t * s.t : 1 - Math.pow(-2 * s.t + 2, 2) / 2;
    const off = s.phase === 'in' ? dist * (1 - e) : dist * e;
    g.current.position.set(dir[0] * off, dir[1] * off, dir[2] * off);
    if (s.t >= 1) {
      if (s.phase === 'out') setShown(null);
      s.phase = 'idle';
    }
  });
  if (!shown) return null;
  return <group ref={g}>{children(shown)}</group>;
}
