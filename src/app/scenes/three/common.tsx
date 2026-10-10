// Shared 3D primitives: LEDs, canvas-texture labels, rack geometry and world-space positions.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
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
