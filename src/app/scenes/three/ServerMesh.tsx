import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { memo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MODELS, type SlotLayout } from '../../../engine/catalog';
import { cpuTemp, hasAC, healthLed, powerLed, slotLed } from '../../../engine/projectors';
import type { Component, Device, Rack } from '../../../engine/types';
import { useStore } from '../../store';
import { CHASSIS_D, deviceOrigin, Label, Led, MAT, portLocal } from './common';

export interface ServerMeshProps {
  dev: Device;
  rack: Rack;
  x: number;
  detail: boolean;
  selected: boolean;
  selSlot?: string;
  highlightSlot?: string;
  pendingPort?: string | null;
  onDevice: (id: string) => void;
  onSlot: (id: string, slot: string) => void;
  onPort: (id: string, port: string) => void;
}

const H = 0.86; // 2U chassis height (minus gap)

function stop(e: ThreeEvent<MouseEvent>) {
  e.stopPropagation();
}

function Box({ l, mat, color, onClick, hover = true, emissive, opacity }: { l: SlotLayout; mat?: THREE.Material; color?: string; onClick?: (e: ThreeEvent<MouseEvent>) => void; hover?: boolean; emissive?: string; opacity?: number }) {
  const [hov, setHov] = useState(false);
  return (
    <mesh
      position={[l.x, l.y + l.h / 2, l.z]}
      onClick={onClick}
      onPointerOver={
        onClick && hover
          ? (e) => {
              e.stopPropagation();
              setHov(true);
              document.body.style.cursor = 'pointer';
            }
          : undefined
      }
      onPointerOut={
        onClick && hover
          ? () => {
              setHov(false);
              document.body.style.cursor = '';
            }
          : undefined
      }
      material={mat && !hov && !emissive ? mat : undefined}
    >
      <boxGeometry args={[l.w, l.h, l.d]} />
      {(!mat || hov || emissive) && (
        <meshStandardMaterial
          color={color ?? (mat as THREE.MeshStandardMaterial)?.color ?? '#555'}
          emissive={hov ? '#2a6f8f' : emissive ?? '#000'}
          emissiveIntensity={hov ? 0.6 : emissive ? 0.8 : 0}
          metalness={0.4}
          roughness={0.5}
          transparent={opacity !== undefined}
          opacity={opacity ?? 1}
        />
      )}
    </mesh>
  );
}

function Fan({ l, spinning, failed }: { l: SlotLayout; spinning: boolean; failed: boolean }) {
  const blade = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (blade.current && spinning) blade.current.rotation.z += dt * 30;
  });
  return (
    <group position={[l.x, l.y + l.h / 2, l.z]}>
      <mesh material={MAT.chassisDark}>
        <boxGeometry args={[l.w, l.h, l.d]} />
      </mesh>
      <mesh ref={blade} position={[0, 0, l.d / 2 + 0.005]}>
        <circleGeometry args={[l.w * 0.42, 5]} />
        <meshStandardMaterial color={failed ? '#4a2020' : '#2c3138'} />
      </mesh>
      <mesh position={[0, l.h / 2 + 0.01, 0]} material={MAT.orangeTouch}>
        <boxGeometry args={[l.w * 0.5, 0.04, 0.12]} />
      </mesh>
    </group>
  );
}

function Interior({ dev, ac, selSlot, highlightSlot, onSlot }: { dev: Device; ac: boolean; selSlot?: string; highlightSlot?: string; onSlot: (slot: string) => void }) {
  const m = MODELS[dev.model];
  const L = m.layout;
  const click = (slot: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSlot(slot);
  };
  const glow = (slot: string) => (slot === selSlot ? '#1d6f8f' : slot === highlightSlot ? '#8f5a1d' : undefined);
  const running = dev.power === 'on' || dev.power === 'posting';
  return (
    <group>
      {/* motherboard */}
      <mesh position={[0, 0.03, -0.4]} material={MAT.pcbDark}>
        <boxGeometry args={[4.2, 0.02, 5.6]} />
      </mesh>
      {/* backplane */}
      <mesh position={[0, 0.45, 2.35]} material={MAT.pcb}>
        <boxGeometry args={[4.3, 0.8, 0.04]} />
      </mesh>
      {m.slots.map((s) => {
        const l = L[s.id];
        if (!l) return null;
        const c = dev.slots[s.id];
        switch (s.kind) {
          case 'dimm': {
            const latchOpen = dev.latches[s.id] === 'open';
            const led = ac && c && c.health !== 'ok';
            return (
              <group key={s.id}>
                <Box l={{ ...l, y: 0.04, h: 0.06, w: 0.07 }} color={Number(s.label.slice(1)) % 2 ? '#e8e8e8' : '#111'} onClick={click(s.id)} emissive={glow(s.id)} />
                {c && <Box l={{ ...l, y: 0.1 + (c.seated ? 0 : 0.05), h: 0.3 }} mat={MAT.pcb} onClick={click(s.id)} emissive={glow(s.id) ?? (c.health === 'failed' ? undefined : undefined)} />}
                {c && <Box l={{ ...l, y: 0.18 + (c.seated ? 0 : 0.05), h: 0.14, w: l.w + 0.01, d: l.d * 0.85 }} mat={MAT.chip} hover={false} />}
                {/* latches */}
                <mesh position={[l.x, 0.14, l.z + l.d / 2 + 0.03]} rotation={[latchOpen ? -0.6 : 0, 0, 0]} material={MAT.silver}>
                  <boxGeometry args={[0.06, 0.16, 0.04]} />
                </mesh>
                <mesh position={[l.x, 0.14, l.z - l.d / 2 - 0.03]} rotation={[latchOpen ? 0.6 : 0, 0, 0]} material={MAT.silver}>
                  <boxGeometry args={[0.06, 0.16, 0.04]} />
                </mesh>
                <Led state={led ? 'amber' : 'off'} position={[l.x, 0.06, l.z + l.d / 2 + 0.1]} size={0.025} />
              </group>
            );
          }
          case 'cpu': {
            const hs = dev.heatsinks[s.id];
            return (
              <group key={s.id}>
                <Box l={{ ...l, y: 0.04, h: 0.04, w: l.w + 0.1, d: l.d + 0.1 }} color="#444a52" onClick={click(s.id)} emissive={glow(s.id)} />
                {c && <Box l={{ ...l, y: 0.08, h: 0.05 }} mat={MAT.silver} onClick={click(s.id)} emissive={glow(s.id)} />}
                {c && !hs && <Label text="◤ PIN 1" position={[l.x - l.w / 2 + 0.15, 0.14, l.z + l.d / 2 - 0.12]} rotation={[-Math.PI / 2, 0, 0]} size={[0.28, 0.08]} opts={{ bg: '#b9c0c8', fg: '#111', w: 128, h: 36 }} />}
                {hs && (
                  <group onClick={click(`heatsink:${s.id}`)}>
                    <Box l={{ x: l.x, y: 0.13, z: l.z, w: 0.9, h: 0.08, d: 0.95 }} mat={MAT.copper} onClick={click(`heatsink:${s.id}`)} emissive={glow(`heatsink:${s.id}`)} />
                    {Array.from({ length: 12 }, (_, i) => (
                      <mesh key={i} position={[l.x - 0.42 + i * 0.077, 0.45, l.z]} material={MAT.silver}>
                        <boxGeometry args={[0.02, 0.58, 0.95]} />
                      </mesh>
                    ))}
                    {[
                      [-1, 1],
                      [1, -1],
                      [1, 1],
                      [-1, -1],
                    ].map(([dx, dz], i) => (
                      <Label key={i} text={String(i + 1)} position={[l.x + dx * 0.4, 0.75, l.z + dz * 0.42]} rotation={[-Math.PI / 2, 0, 0]} size={[0.1, 0.1]} opts={{ bg: '#222', fg: '#ffd166', w: 32, h: 32 }} />
                    ))}
                  </group>
                )}
              </group>
            );
          }
          case 'fan':
            return c ? (
              <group key={s.id} onClick={click(s.id)}>
                <Fan l={l} spinning={running && c.health === 'ok'} failed={c.health === 'failed'} />
                {glow(s.id) && <Box l={{ ...l, h: 0.04, y: l.h + 0.05 }} color="#1d6f8f" emissive={glow(s.id)} hover={false} />}
                <Led state={ac && c.health === 'failed' ? 'amber' : 'off'} position={[l.x + l.w / 2 - 0.06, l.h + 0.08, l.z]} size={0.025} />
              </group>
            ) : (
              <Box key={s.id} l={{ ...l, h: 0.04 }} color="#1a1d22" onClick={click(s.id)} emissive={glow(s.id)} />
            );
          case 'm2':
            return <Box key={s.id} l={l} mat={c ? MAT.pcb : MAT.chassisDark} color={c ? undefined : '#222'} onClick={click(s.id)} emissive={glow(s.id)} />;
          case 'cmos':
            return dev.layers.riser2 ? null : (
              <mesh key={s.id} position={[l.x, 0.07, l.z]} onClick={click(s.id)}>
                <cylinderGeometry args={[0.1, 0.1, 0.03, 20]} />
                <meshStandardMaterial color={c ? '#cfd6dc' : '#2a2a2a'} metalness={0.9} roughness={0.2} emissive={glow(s.id) ?? '#000'} emissiveIntensity={glow(s.id) ? 0.8 : 0} />
              </mesh>
            );
          case 'gpu':
            return dev.layers.riser1 && c ? <Box key={s.id} l={l} color="#1f2a1f" onClick={click(s.id)} emissive={glow(s.id)} /> : !dev.layers.riser1 ? <Box key={s.id} l={{ ...l, y: 0.05, h: 0.04, w: 0.2 }} color="#333" onClick={click(s.id)} emissive={glow(s.id)} /> : null;
          default:
            return null;
        }
      })}
      {/* risers */}
      {dev.layers.riser1 && (
        <group onClick={click('layer:riser1')}>
          <Box l={{ x: -0.55, y: 0.05, z: -2.85, w: 0.95, h: 0.72, d: 1.75 }} color="#30363e" opacity={0.55} onClick={click('layer:riser1')} emissive={glow('layer:riser1')} />
        </group>
      )}
      {dev.layers.riser2 && <Box l={{ x: 0.6, y: 0.05, z: -2.85, w: 0.95, h: 0.72, d: 1.75 }} color="#30363e" opacity={0.55} onClick={click('layer:riser2')} emissive={glow('layer:riser2')} />}
      {/* air shroud */}
      {dev.layers.shroud && <Box l={{ x: 0, y: 0.04, z: 0.6, w: 4.3, h: 0.72, d: 1.75 }} mat={MAT.plastic} onClick={click('layer:shroud')} emissive={glow('layer:shroud')} opacity={0.82} color="#0d0f12" />}
      {/* temperature hint glow on CPUs when overheating */}
      {running && cpuTemp(dev, 0) >= 85 && (
        <pointLight position={[-1.1, 0.8, 0.6]} color="#ff4b2b" intensity={2} distance={2} />
      )}
    </group>
  );
}

function FrontPanel({ dev, ac, onSlot, onDevice, selSlot }: { dev: Device; ac: boolean; onSlot: (s: string) => void; onDevice: () => void; selSlot?: string }) {
  const w = useStore.getState().world!;
  const m = MODELS[dev.model];
  const fz = CHASSIS_D / 2;
  const bays = m.slots.filter((s) => s.access === 'front');
  return (
    <group>
      {bays.map((s) => {
        const l = m.layout[s.id];
        const c = dev.slots[s.id];
        const led = slotLed(w, dev, s.id);
        const open = dev.latches[s.id] === 'open';
        const isHdd = s.kind === 'hdd';
        const zFront = fz + 0.01 + (c && !c.seated ? 0.25 : 0);
        return (
          <group
            key={s.id}
            onClick={(e) => {
              e.stopPropagation();
              onSlot(s.id);
            }}
          >
            <mesh position={[l.x, l.y + l.h / 2, zFront - 0.02]}>
              <boxGeometry args={[l.w * 0.96, l.h * 0.92, 0.06]} />
              <meshStandardMaterial color={c ? '#2d333b' : '#0a0b0d'} emissive={selSlot === s.id ? '#1d6f8f' : '#000'} emissiveIntensity={0.7} metalness={0.5} roughness={0.5} />
            </mesh>
            {c && (
              <mesh position={isHdd ? [l.x + l.w * 0.3, l.y + l.h / 2, zFront + 0.03] : [l.x, l.y + l.h * 0.25, zFront + 0.03]} rotation={[open ? -0.5 : 0, 0, 0]} material={MAT.orangeTouch}>
                <boxGeometry args={isHdd ? [l.w * 0.3, l.h * 0.5, 0.04] : [l.w * 0.6, l.h * 0.22, 0.04]} />
              </mesh>
            )}
            <Led state={led} position={isHdd ? [l.x - l.w * 0.4, l.y + l.h / 2, zFront + 0.04] : [l.x, l.y + l.h * 0.9, zFront + 0.04]} size={0.022} period={led === 'blue_blink' ? 0.5 : led === 'green_blink' ? 0.25 : 1} />
          </group>
        );
      })}
      {/* control panel ear */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          onDevice();
        }}
      >
        <mesh position={[2.1, 0.43, fz + 0.03]} material={MAT.bezel}>
          <boxGeometry args={[0.26, 0.84, 0.06]} />
        </mesh>
        <Led state={powerLed(w, dev) === 'green' ? 'green' : powerLed(w, dev) === 'amber' ? 'amber' : 'off'} position={[2.1, 0.72, fz + 0.07]} size={0.035} />
        <Led state={healthLed(w, dev) === 'off' ? 'off' : healthLed(w, dev) === 'green' ? 'green' : healthLed(w, dev)} position={[2.1, 0.55, fz + 0.07]} size={0.035} />
        <Led state={dev.locateLed && ac ? 'blue_blink' : 'off'} position={[2.1, 0.38, fz + 0.07]} size={0.035} period={0.6} />
      </group>
      {/* left ear with labels */}
      <mesh position={[-2.12, 0.43, fz + 0.03]} material={MAT.bezel}>
        <boxGeometry args={[0.22, 0.84, 0.06]} />
      </mesh>
      <Label text={dev.assetTag} position={[-2.12, 0.62, fz + 0.065]} size={[0.2, 0.08]} opts={{ w: 160, h: 64, bg: '#f4f4f4' }} />
      <Label text={dev.hostname.split('-').slice(-1)[0]} position={[-2.12, 0.28, fz + 0.065]} size={[0.2, 0.07]} opts={{ w: 160, h: 56, bg: '#ffffff' }} />
      {/* pull handles */}
      {[-2.25, 2.25].map((x) => (
        <mesh key={x} position={[x, 0.43, fz + 0.12]} material={MAT.silver}>
          <boxGeometry args={[0.05, 0.5, 0.06]} />
        </mesh>
      ))}
    </group>
  );
}

function RearPanel({ dev, onSlot, onPort, pendingPort, selSlot }: { dev: Device; onSlot: (s: string) => void; onPort: (p: string) => void; pendingPort?: string | null; selSlot?: string }) {
  const w = useStore.getState().world!;
  const m = MODELS[dev.model];
  const rz = -CHASSIS_D / 2;
  return (
    <group>
      {['PSU1', 'PSU2'].map((p) => {
        const l = m.layout[p];
        const c = dev.slots[p];
        const out = c && !c.seated ? -0.3 : 0;
        return (
          <group
            key={p}
            onClick={(e) => {
              e.stopPropagation();
              onSlot(p);
            }}
          >
            {c ? (
              <>
                <mesh position={[l.x, l.y + l.h / 2, l.z + out]}>
                  <boxGeometry args={[l.w, l.h, l.d]} />
                  <meshStandardMaterial color={c.partNumber.includes('48VDC') ? '#4a3b2a' : '#30363e'} emissive={selSlot === p ? '#1d6f8f' : '#000'} emissiveIntensity={0.7} metalness={0.6} roughness={0.4} />
                </mesh>
                <mesh position={[l.x - 0.15, l.y + l.h / 2, rz - 0.06 + out]} material={MAT.chassisDark}>
                  <boxGeometry args={[0.35, 0.22, 0.08]} />
                </mesh>
                <mesh position={[l.x - 0.25, l.y + l.h / 2, rz - 0.12 + out]} material={MAT.orangeTouch}>
                  <boxGeometry args={[0.06, 0.25, 0.08]} />
                </mesh>
                <Led state={slotLed(w, dev, p)} position={[l.x + 0.28, l.y + l.h * 0.75, rz - 0.02 + out]} size={0.03} />
              </>
            ) : (
              <mesh position={[l.x, l.y + l.h / 2, rz + 0.02]}>
                <boxGeometry args={[l.w, l.h, 0.04]} />
                <meshStandardMaterial color="#050505" emissive={selSlot === p ? '#1d6f8f' : '#000'} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* OCP NIC */}
      {(() => {
        const l = m.layout.OCP0;
        const c = dev.slots.OCP0;
        return (
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSlot('OCP0');
            }}
          >
            <mesh position={[l.x, l.y + l.h / 2, rz + 0.01]}>
              <boxGeometry args={[l.w, l.h + 0.05, 0.03]} />
              <meshStandardMaterial color={c ? '#596270' : '#050505'} emissive={selSlot === 'OCP0' ? '#1d6f8f' : '#000'} />
            </mesh>
          </group>
        );
      })()}
      {(['nic0p0', 'nic0p1', 'bmc'] as const).map((p) => {
        const pos = portLocal(dev, p);
        const pending = pendingPort === p;
        if (p !== 'bmc' && !dev.slots.OCP0) return null;
        return (
          <mesh
            key={p}
            position={pos}
            onClick={(e) => {
              e.stopPropagation();
              onPort(p);
            }}
            onPointerOver={() => (document.body.style.cursor = 'crosshair')}
            onPointerOut={() => (document.body.style.cursor = '')}
          >
            <boxGeometry args={p === 'bmc' ? [0.16, 0.13, 0.04] : [0.15, 0.1, 0.04]} />
            <meshStandardMaterial color={pending ? '#4fd1c5' : '#050505'} emissive={pending ? '#4fd1c5' : '#000'} emissiveIntensity={0.8} />
          </mesh>
        );
      })}
      <Label text="P0  P1" position={[-1.65, 0.24, rz - 0.02]} rotation={[0, Math.PI, 0]} size={[0.5, 0.07]} opts={{ bg: '#1b1f25', fg: '#cbd5e0', w: 200, h: 28 }} />
      <Label text="BMC" position={[-0.95, 0.45, rz - 0.02]} rotation={[0, Math.PI, 0]} size={[0.2, 0.07]} opts={{ bg: '#1b1f25', fg: '#63b3ed', w: 100, h: 34 }} />
    </group>
  );
}

function ServerMeshInner(p: ServerMeshProps) {
  const { dev, x, detail } = p;
  const w = useStore.getState().world!;
  const ac = hasAC(w, dev);
  const target = deviceOrigin(dev, x);
  const g = useRef<THREE.Group>(null);
  const reduced = useStore.getState().progress.settings.reducedMotion;
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.position.lerp(target, reduced ? 1 : Math.min(1, dt * 6));
  });
  const showInside = detail && !dev.layers.lid;
  return (
    <group ref={g} position={target}>
      {/* body */}
      <mesh
        position={[0, H / 2, 0]}
        onClick={(e) => {
          stop(e);
          p.onDevice(dev.id);
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
        visible={!showInside}
      >
        <boxGeometry args={[4.4, H, CHASSIS_D]} />
        <meshStandardMaterial color={p.selected ? '#4b5563' : '#3a414b'} metalness={0.55} roughness={0.45} emissive={p.selected ? '#103040' : '#000'} />
      </mesh>
      {showInside && (
        <>
          {/* tray floor + side walls */}
          <mesh position={[0, 0.01, 0]} material={MAT.chassis}>
            <boxGeometry args={[4.4, 0.02, CHASSIS_D]} />
          </mesh>
          {[-2.19, 2.19].map((sx) => (
            <mesh key={sx} position={[sx, H / 2, 0]} material={MAT.chassis}>
              <boxGeometry args={[0.02, H, CHASSIS_D]} />
            </mesh>
          ))}
          <Interior dev={dev} ac={ac} selSlot={p.selSlot} highlightSlot={p.highlightSlot} onSlot={(s) => p.onSlot(dev.id, s)} />
        </>
      )}
      {detail && !dev.layers.lid && null}
      {detail && dev.layers.lid && dev.servicePosition && (
        <mesh
          position={[0, H + 0.01, 0]}
          onClick={(e) => {
            stop(e);
            p.onSlot(dev.id, 'layer:lid');
          }}
        >
          <boxGeometry args={[4.42, 0.02, CHASSIS_D * 0.98]} />
          <meshStandardMaterial color="#59626e" metalness={0.7} roughness={0.35} emissive={p.selSlot === 'layer:lid' ? '#1d6f8f' : '#000'} />
        </mesh>
      )}
      {detail && dev.layers.lid && dev.servicePosition && <Label text="⇦ PUSH · SLIDE ⇨" position={[0, H + 0.025, 1.5]} rotation={[-Math.PI / 2, 0, 0]} size={[1.2, 0.2]} opts={{ bg: '#59626e', fg: '#1d2025', w: 300, h: 50 }} />}
      <FrontPanel dev={dev} ac={ac} onSlot={(s) => p.onSlot(dev.id, s)} onDevice={() => p.onDevice(dev.id)} selSlot={p.selSlot} />
      <RearPanel dev={dev} onSlot={(s) => p.onSlot(dev.id, s)} onPort={(port) => p.onPort(dev.id, port)} pendingPort={p.pendingPort} selSlot={p.selSlot} />
    </group>
  );
}

export const ServerMesh = memo(ServerMeshInner);

export function componentLabel(c: Component | null | undefined): string {
  return c ? `${c.partNumber} · ${c.serial}` : 'empty';
}
