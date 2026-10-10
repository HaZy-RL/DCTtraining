import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { memo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MODELS, type SlotLayout } from '../../../engine/catalog';
import { isTight } from '../../../engine/fasteners';
import { cpuTemp, hasAC, healthLed, powerLed, slotLed } from '../../../engine/projectors';
import type { Component, Device, Rack } from '../../../engine/types';
import { useStore } from '../../store';
import { driveLabelTex, serverFaceTex, barcodeTex, carrierTex, CHASSIS_D, deviceOrigin, dimmTex, grilleTex, GuideGlow, hoverCursor, ihsTex, Label, Led, lidTex, MAT, pcbTex, portLocal, SlideAnim } from './common';

export interface ServerMeshProps {
  dev: Device;
  rack: Rack;
  x: number;
  detail: boolean;
  /** Full front/rear detail (focus rack) vs. a cheap silhouette (neighbouring racks). */
  lod: 'full' | 'low';
  selected: boolean;
  selSlot?: string;
  highlightSlot?: string;
  /** Coach target key for this device (see CoachTarget.sel). */
  guide?: string;
  pendingPort?: string | null;
  onDevice: (id: string) => void;
  onSlot: (id: string, slot: string) => void;
  onPort: (id: string, port: string) => void;
  onFastener: (id: string, target: string, fastener: string) => void;
  onLatch: (id: string, slot: string) => void;
}

const H = 0.86; // 2U chassis height (minus gap)
const FZ = CHASSIS_D / 2;
const RZ = -CHASSIS_D / 2;

type Click = (e: ThreeEvent<MouseEvent>) => void;
const handler =
  (fn: () => void): Click =>
  (e) => {
    e.stopPropagation();
    fn();
  };

const blueMat = MAT.blueTouch;
const greenTab = new THREE.MeshStandardMaterial({ color: '#2fb35a', metalness: 0.1, roughness: 0.5 });
const greenTabPressed = new THREE.MeshStandardMaterial({ color: '#7dff9f', emissive: '#1d6f3a', emissiveIntensity: 0.6, roughness: 0.5 });
const screwMat = new THREE.MeshStandardMaterial({ color: '#d7dde3', metalness: 0.95, roughness: 0.2 });
const screwLooseMat = new THREE.MeshStandardMaterial({ color: '#ffe08a', metalness: 0.8, roughness: 0.3, emissive: '#5a4300', emissiveIntensity: 0.5 });
const wireMat = new THREE.MeshStandardMaterial({ color: '#c9d0d6', metalness: 0.95, roughness: 0.25 });
const blackPlastic = new THREE.MeshStandardMaterial({ color: '#141518', metalness: 0.1, roughness: 0.7 });
const chokeMat = new THREE.MeshStandardMaterial({ color: '#5d6168', metalness: 0.6, roughness: 0.4 });
const capMat = new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.7, roughness: 0.35 });

function Box({ l, mat, color, onClick, hover = true, emissive, opacity }: { l: SlotLayout; mat?: THREE.Material; color?: string; onClick?: Click; hover?: boolean; emissive?: string; opacity?: number }) {
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
          map={(mat as THREE.MeshStandardMaterial)?.map ?? null}
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

/** A clickable screw head: sits flush when tight, backed out (and gold) when loose. */
function Screw({ pos, tight, onClick, glow, r = 0.045, thumb = false, axis = 'y' }: { pos: [number, number, number]; tight: boolean; onClick: Click; glow?: boolean; r?: number; thumb?: boolean; axis?: 'y' | 'z' | '-z' }) {
  const lift = tight ? 0 : thumb ? 0.07 : 0.05;
  const off: [number, number, number] = axis === 'y' ? [0, lift, 0] : axis === 'z' ? [0, 0, lift] : [0, 0, -lift];
  const rot: [number, number, number] = axis === 'y' ? [0, 0, 0] : [Math.PI / 2, 0, 0];
  const h = thumb ? 0.07 : 0.03;
  return (
    <group position={[pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]]}>
      <mesh rotation={rot} onClick={onClick} {...hoverCursor()} material={thumb ? (tight ? blueMat : screwLooseMat) : tight ? screwMat : screwLooseMat}>
        <cylinderGeometry args={[r, r, h, thumb ? 10 : 14]} />
      </mesh>
      {!thumb && (
        <mesh rotation={rot} position={axis === 'y' ? [0, h / 2 + 0.002, 0] : [0, 0, (axis === 'z' ? 1 : -1) * (h / 2 + 0.002)]} raycast={() => null}>
          <boxGeometry args={axis === 'y' ? [r * 1.4, 0.004, r * 0.3] : [r * 1.4, r * 0.3, 0.004]} />
          <meshBasicMaterial color="#333" />
        </mesh>
      )}
      {glow && <GuideGlow position={[0, 0, 0]} size={[r * 2.4, axis === 'y' ? h + 0.06 : r * 2.4, axis === 'y' ? r * 2.4 : h + 0.06]} />}
    </group>
  );
}

function Fan({ l, spinning, failed }: { l: SlotLayout; spinning: boolean; failed: boolean }) {
  const blade = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (blade.current && spinning) blade.current.rotation.z += dt * 30;
  });
  return (
    <group position={[l.x, l.y + l.h / 2, l.z]}>
      <mesh material={MAT.chassisDark}>
        <boxGeometry args={[l.w, l.h, l.d]} />
      </mesh>
      <mesh position={[0, 0, l.d / 2 + 0.003]} raycast={() => null}>
        <ringGeometry args={[l.w * 0.4, l.w * 0.46, 28]} />
        <meshStandardMaterial color="#0b0c0e" />
      </mesh>
      <group ref={blade} position={[0, 0, l.d / 2 + 0.01]}>
        <mesh>
          <circleGeometry args={[l.w * 0.12, 16]} />
          <meshStandardMaterial color={failed ? '#3a1d1d' : '#22262c'} />
        </mesh>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} rotation={[0, 0, (i / 7) * Math.PI * 2]} position={[Math.cos((i / 7) * Math.PI * 2) * l.w * 0.24, Math.sin((i / 7) * Math.PI * 2) * l.w * 0.24, 0]}>
            <boxGeometry args={[l.w * 0.24, l.w * 0.09, 0.01]} />
            <meshStandardMaterial color={failed ? '#4a2020' : '#2c3138'} />
          </mesh>
        ))}
      </group>
      {/* finger guard */}
      {[0.2, 0.32].map((r) => (
        <mesh key={r} position={[0, 0, l.d / 2 + 0.025]} raycast={() => null}>
          <torusGeometry args={[l.w * r, 0.006, 4, 24]} />
          <meshStandardMaterial color="#555b63" metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Interior({ dev, ac, selSlot, highlightSlot, guide, onSlot, onFastener, onLatch }: { dev: Device; ac: boolean; selSlot?: string; highlightSlot?: string; guide?: string; onSlot: (slot: string) => void; onFastener: (target: string, id: string) => void; onLatch: (slot: string) => void }) {
  const m = MODELS[dev.model];
  const L = m.layout;
  const click = (slot: string) => handler(() => onSlot(slot));
  const fclick = (target: string, id: string) => handler(() => onFastener(target, id));
  const glow = (slot: string) => (slot === selSlot ? '#1d6f8f' : slot === highlightSlot ? '#8f5a1d' : undefined);
  const g = (key: string) => guide === key;
  const running = dev.power === 'on' || dev.power === 'posting';
  return (
    <group>
      {/* motherboard with traces */}
      <mesh position={[0, 0.03, -0.4]}>
        <boxGeometry args={[4.2, 0.02, 5.6]} />
        <meshStandardMaterial map={pcbTex()} roughness={0.8} />
      </mesh>
      {/* VRM chokes + caps beside each socket */}
      {[-1.1, 1.1].map((cx) =>
        [-1, 1].map((side) => (
          <group key={`${cx}${side}`}>
            {Array.from({ length: 6 }, (_, i) => (
              <mesh key={i} position={[cx + side * 0.52, 0.075, 0.18 + i * 0.16]} material={chokeMat} raycast={() => null}>
                <boxGeometry args={[0.09, 0.07, 0.11]} />
              </mesh>
            ))}
            {Array.from({ length: 4 }, (_, i) => (
              <mesh key={`c${i}`} position={[cx + side * 0.4, 0.08, 0.05 - i * 0.07 + (side > 0 ? 1.2 : 0)]} material={capMat} raycast={() => null}>
                <cylinderGeometry args={[0.025, 0.025, 0.09, 10]} />
              </mesh>
            ))}
          </group>
        )),
      )}
      <Label text="CPU0" position={[-1.1, 0.045, -0.05]} rotation={[-Math.PI / 2, 0, 0]} size={[0.3, 0.08]} opts={{ bg: '#0b3a24', fg: '#e9edf0', w: 128, h: 34 }} />
      <Label text="CPU1" position={[1.1, 0.045, -0.05]} rotation={[-Math.PI / 2, 0, 0]} size={[0.3, 0.08]} opts={{ bg: '#0b3a24', fg: '#e9edf0', w: 128, h: 34 }} />
      {/* PCH with heatsink, BMC chip */}
      <mesh position={[0.2, 0.07, -0.95]} material={MAT.chip} raycast={() => null}>
        <boxGeometry args={[0.32, 0.04, 0.32]} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[0.07 + i * 0.05, 0.13, -0.95]} material={MAT.silver} raycast={() => null}>
          <boxGeometry args={[0.015, 0.09, 0.3]} />
        </mesh>
      ))}
      <mesh position={[-0.45, 0.06, -2.0]} material={MAT.chip} raycast={() => null}>
        <boxGeometry args={[0.18, 0.025, 0.18]} />
      </mesh>
      <Label text="BMC" position={[-0.45, 0.075, -2.0]} rotation={[-Math.PI / 2, 0, 0]} size={[0.12, 0.05]} opts={{ bg: '#111', fg: '#9fb4c9', w: 64, h: 26 }} />
      {/* fan board + backplane */}
      <mesh position={[0, 0.08, 1.95]} material={MAT.pcb} raycast={() => null}>
        <boxGeometry args={[4.2, 0.1, 0.1]} />
      </mesh>
      <mesh position={[0, 0.45, 2.42]} material={MAT.pcb}>
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
            const lift = c && !c.seated ? 0.05 : 0;
            return (
              <group key={s.id}>
                <Box l={{ ...l, y: 0.04, h: 0.06, w: 0.07 }} color={Number(s.label.slice(1)) % 2 ? '#e8e8e8' : '#111'} onClick={click(s.id)} emissive={glow(s.id)} />
                <SlideAnim item={c} dir={[0, 1, 0]} dist={0.9}>
                  {() => (
                  <mesh position={[l.x, 0.1 + lift + 0.15, l.z]} onClick={click(s.id)} {...hoverCursor()}>
                    <boxGeometry args={[l.w, 0.3, l.d]} />
                    <meshStandardMaterial attach="material-0" map={dimmTex()} emissive={glow(s.id) ?? '#000'} emissiveIntensity={0.6} />
                    <meshStandardMaterial attach="material-1" map={dimmTex()} emissive={glow(s.id) ?? '#000'} emissiveIntensity={0.6} />
                    <meshStandardMaterial attach="material-2" color="#0f5a32" />
                    <meshStandardMaterial attach="material-3" color="#0f5a32" />
                    <meshStandardMaterial attach="material-4" color="#0f5a32" />
                    <meshStandardMaterial attach="material-5" color="#0f5a32" />
                  </mesh>
                  )}
                </SlideAnim>
                {/* ejector latches: click either end */}
                {[1, -1].map((end) => (
                  <mesh
                    key={end}
                    position={[l.x, 0.14, l.z + end * (l.d / 2 + 0.03)]}
                    rotation={[latchOpen ? -0.6 * end : 0, 0, 0]}
                    onClick={handler(() => onLatch(s.id))}
                    {...hoverCursor()}
                  >
                    <boxGeometry args={[0.07, 0.17, 0.05]} />
                    <meshStandardMaterial color={latchOpen ? '#ffe08a' : '#d9dde2'} metalness={0.3} roughness={0.5} />
                  </mesh>
                ))}
                <Led state={led ? 'amber' : 'off'} position={[l.x, 0.06, l.z + l.d / 2 + 0.1]} size={0.025} />
                {g(s.id) && <GuideGlow position={[l.x, 0.25, l.z]} size={[0.1, 0.36, l.d + 0.1]} />}
              </group>
            );
          }
          case 'cpu': {
            const hs = dev.heatsinks[s.id];
            const frameOpen = !isTight(dev, s.id, 'frame');
            const hsT = `heatsink:${s.id}`;
            const corners: Array<[number, number]> = [
              [-1, 1],
              [1, -1],
              [1, 1],
              [-1, -1],
            ];
            return (
              <group key={s.id}>
                <Box l={{ ...l, y: 0.04, h: 0.04, w: l.w + 0.1, d: l.d + 0.1 }} color="#3a3f46" onClick={click(s.id)} emissive={glow(s.id)} />
                <SlideAnim item={c} dir={[0, 1, 0]} dist={0.8}>
                  {() => (
                  <mesh position={[l.x, 0.105, l.z]} onClick={click(s.id)} {...hoverCursor()}>
                    <boxGeometry args={[l.w * 0.8, 0.05, l.d * 0.8]} />
                    <meshStandardMaterial attach="material-2" map={ihsTex()} metalness={0.7} roughness={0.3} emissive={glow(s.id) ?? '#000'} emissiveIntensity={0.5} />
                    {[0, 1, 3, 4, 5].map((i) => (
                      <meshStandardMaterial key={i} attach={`material-${i}`} color="#aab2bb" metalness={0.8} roughness={0.3} />
                    ))}
                  </mesh>
                  )}
                </SlideAnim>
                {!hs && (
                  <>
                    {/* load frame + lever */}
                    <group position={[l.x, 0.09, l.z]} rotation={[frameOpen ? -0.9 : 0, 0, 0]}>
                      {[
                        [0, l.d / 2, l.w, 0.06],
                        [0, -l.d / 2, l.w, 0.06],
                      ].map(([fx, fz, fw, fd], i) => (
                        <mesh key={i} position={[fx, 0, fz]} material={MAT.silver} raycast={() => null}>
                          <boxGeometry args={[fw, 0.02, fd]} />
                        </mesh>
                      ))}
                    </group>
                    <mesh position={[l.x + l.w / 2 + 0.06, frameOpen ? 0.22 : 0.1, l.z]} rotation={[0, 0, frameOpen ? 1.2 : 0]} onClick={fclick(s.id, 'frame')} {...hoverCursor()}>
                      <boxGeometry args={[0.04, 0.04, l.d * 0.9]} />
                      <meshStandardMaterial color={frameOpen ? '#ffe08a' : '#c9d0d6'} metalness={0.9} roughness={0.25} />
                    </mesh>
                    {g(`fastener:${s.id}:frame`) && <GuideGlow position={[l.x + l.w / 2 + 0.06, 0.12, l.z]} size={[0.1, 0.1, l.d]} />}
                    {c && <Label text="◤ PIN 1" position={[l.x - l.w / 2 + 0.2, 0.135, l.z + l.d / 2 - 0.16]} rotation={[-Math.PI / 2, 0, 0]} size={[0.28, 0.08]} opts={{ bg: '#b9c0c8', fg: '#111', w: 128, h: 36 }} />}
                  </>
                )}
                <SlideAnim item={hs} dir={[0, 1, 0]} dist={1.4} speed={1.2}>
                  {() => (
                  <group>
                    <Box l={{ x: l.x, y: 0.13, z: l.z, w: 1.0, h: 0.08, d: 1.05 }} mat={MAT.copper} onClick={click(hsT)} emissive={glow(hsT)} />
                    {Array.from({ length: 12 }, (_, i) => (
                      <mesh key={i} position={[l.x - 0.39 + i * 0.071, 0.47, l.z]} material={MAT.silver} onClick={click(hsT)}>
                        <boxGeometry args={[0.018, 0.56, 0.78]} />
                      </mesh>
                    ))}
                    {[-0.24, -0.08, 0.08, 0.24].map((dx) => (
                      <mesh key={dx} position={[l.x + dx, 0.45, l.z]} rotation={[Math.PI / 2, 0, 0]} material={MAT.copper} raycast={() => null}>
                        <cylinderGeometry args={[0.03, 0.03, 0.9, 8]} />
                      </mesh>
                    ))}
                    {corners.map(([dx, dz], i) => {
                      const n = i + 1;
                      const tight = isTight(dev, hsT, `s${n}`);
                      const pos: [number, number, number] = [l.x + dx * 0.45, 0.23, l.z + dz * 0.47];
                      return (
                        <group key={n}>
                          <Screw pos={pos} tight={tight} r={0.05} onClick={fclick(hsT, `s${n}`)} glow={g(`fastener:${hsT}:s${n}`)} />
                          <Label text={String(n)} position={[pos[0] - dx * 0.0, 0.215, pos[2] - dz * 0.09]} rotation={[-Math.PI / 2, 0, 0]} size={[0.07, 0.07]} opts={{ bg: '#222', fg: '#ffd166', w: 32, h: 32 }} />
                        </group>
                      );
                    })}
                    {g(hsT) && <GuideGlow position={[l.x, 0.45, l.z]} size={[1.0, 0.65, 1.05]} />}
                  </group>
                  )}
                </SlideAnim>
                {g(s.id) && <GuideGlow position={[l.x, 0.12, l.z]} size={[l.w, 0.08, l.d]} />}
              </group>
            );
          }
          case 'fan': {
            const latchLoose = c && !isTight(dev, s.id, 'latch');
            return (
              <group key={s.id}>
                <Box l={{ ...l, h: 0.04 }} color="#1a1d22" onClick={click(s.id)} emissive={glow(s.id)} />
                <SlideAnim item={c} dir={[0, 1, 0]} dist={1.2}>
                  {(fc) => (
                    <group onClick={click(s.id)}>
                      <Fan l={l} spinning={running && fc.health === 'ok'} failed={fc.health === 'failed'} />
                      {glow(s.id) && <Box l={{ ...l, h: 0.04, y: l.h + 0.05 }} color="#1d6f8f" emissive={glow(s.id)} hover={false} />}
                      <mesh position={[l.x, l.h + 0.07 + (latchLoose ? 0.05 : 0), l.z - l.d * 0.2]} material={latchLoose ? screwLooseMat : MAT.orangeTouch} onClick={fclick(s.id, 'latch')} {...hoverCursor()}>
                        <boxGeometry args={[l.w * 0.45, 0.05, 0.14]} />
                      </mesh>
                      <Label text="FAN-60X56-HP" position={[l.x, l.y + l.h + 0.002, l.z + 0.08]} rotation={[-Math.PI / 2, 0, 0]} size={[l.w * 0.8, 0.07]} opts={{ bg: '#1b1f25', fg: '#cbd5e0', w: 192, h: 24 }} />
                      <Led state={ac && fc.health === 'failed' ? 'amber' : 'off'} position={[l.x + l.w / 2 - 0.06, l.h + 0.08, l.z]} size={0.025} />
                    </group>
                  )}
                </SlideAnim>
                {g(s.id) && <GuideGlow position={[l.x, l.y + l.h / 2, l.z]} size={[l.w, l.h, l.d]} />}
                {g(`fastener:${s.id}:latch`) && <GuideGlow position={[l.x, l.h + 0.08, l.z - l.d * 0.2]} size={[l.w * 0.5, 0.08, 0.18]} />}
              </group>
            );
          }
          case 'm2': {
            const tight = c ? isTight(dev, s.id, 'screw') : true;
            return (
              <group key={s.id}>
                <mesh position={[l.x, 0.06, l.z - 0.12]} material={blackPlastic} raycast={() => null}>
                  <boxGeometry args={[l.w + 0.04, 0.04, 0.06]} />
                </mesh>
                <SlideAnim item={c} dir={[0, 1, 0]} dist={0.6}>
                  {() => (
                  <group>
                  <group position={[l.x, 0.07, l.z]} rotation={[tight ? 0 : 0.18, 0, 0]}>
                    <mesh onClick={click(s.id)} {...hoverCursor()}>
                      <boxGeometry args={[l.w, 0.02, l.d]} />
                      <meshStandardMaterial color="#0f4d2c" emissive={glow(s.id) ?? '#000'} emissiveIntensity={0.7} />
                    </mesh>
                    {[-0.3, 0, 0.3].map((dz) => (
                      <mesh key={dz} position={[0, 0.02, dz]} material={MAT.chip} raycast={() => null}>
                        <boxGeometry args={[l.w * 0.8, 0.02, 0.2]} />
                      </mesh>
                    ))}
                    <Label text="960G" position={[0, 0.035, 0.42]} rotation={[-Math.PI / 2, 0, 0]} size={[0.16, 0.06]} opts={{ bg: '#e9edf0', fg: '#111', w: 64, h: 24 }} />
                  </group>
                  <Screw pos={[l.x, 0.08, l.z + l.d / 2 - 0.03]} tight={tight} r={0.035} onClick={fclick(s.id, 'screw')} glow={g(`fastener:${s.id}:screw`)} />
                  </group>
                  )}
                </SlideAnim>
                {!c && <Box l={{ ...l, h: 0.02 }} color="#222" onClick={click(s.id)} emissive={glow(s.id)} />}
                {g(s.id) && <GuideGlow position={[l.x, 0.08, l.z]} size={[l.w, 0.06, l.d]} />}
              </group>
            );
          }
          case 'cmos': {
            if (dev.layers.riser2) return null;
            const tight = c ? isTight(dev, s.id, 'clip') : true;
            return (
              <group key={s.id}>
                <mesh position={[l.x, 0.05, l.z]} material={blackPlastic} onClick={click(s.id)}>
                  <cylinderGeometry args={[0.125, 0.125, 0.02, 20]} />
                </mesh>
                <SlideAnim item={c} dir={[0, 1, 0]} dist={0.5}>
                  {() => (
                  <mesh position={[l.x, 0.075 + (tight ? 0 : 0.03), l.z]} rotation={[tight ? 0 : 0.3, 0, 0]} onClick={click(s.id)} {...hoverCursor()}>
                    <cylinderGeometry args={[0.1, 0.1, 0.032, 24]} />
                    <meshStandardMaterial color="#cfd6dc" metalness={0.9} roughness={0.2} emissive={glow(s.id) ?? '#000'} emissiveIntensity={glow(s.id) ? 0.8 : 0} />
                  </mesh>
                  )}
                </SlideAnim>
                {c && (
                  <mesh position={[l.x + 0.11, 0.09, l.z]} rotation={[0, 0, tight ? 0 : 0.5]} onClick={fclick(s.id, 'clip')} {...hoverCursor()}>
                    <boxGeometry args={[0.03, 0.05, 0.08]} />
                    <meshStandardMaterial color={tight ? '#b9c0c8' : '#ffe08a'} metalness={0.9} roughness={0.3} />
                  </mesh>
                )}
                {g(s.id) && <GuideGlow position={[l.x, 0.08, l.z]} size={[0.25, 0.06, 0.25]} />}
                {g(`fastener:${s.id}:clip`) && <GuideGlow position={[l.x + 0.11, 0.09, l.z]} size={[0.06, 0.08, 0.1]} />}
              </group>
            );
          }
          case 'gpu': {
            if (dev.layers.riser1) return null;
            const tight = c ? isTight(dev, s.id, 'bracket') : true;
            return (
              <group key={s.id}>
                {/* the riser sits on the ESD mat once lifted out; the card is worked on there */}
                {!c && <Box l={{ ...l, y: 0.05, h: 0.04, w: 0.2 }} color="#333" onClick={click(s.id)} emissive={glow(s.id)} />}
                <SlideAnim item={c} dir={[0, 1, 0]} dist={1.0}>
                  {() => (
                  <group>
                    <Box l={{ ...l, y: 0.12 }} color="#1f2a1f" onClick={click(s.id)} emissive={glow(s.id)} />
                    <mesh position={[l.x, 0.12 + l.h + 0.04, l.z + 0.1]} material={blackPlastic} raycast={() => null}>
                      <boxGeometry args={[l.w * 0.95, 0.08, l.d * 0.75]} />
                    </mesh>
                    <Label text="GPU 24G" position={[l.x, 0.12 + l.h + 0.085, l.z + 0.1]} rotation={[-Math.PI / 2, 0, 0]} size={[0.4, 0.1]} opts={{ bg: '#141518', fg: '#7dff9f', w: 128, h: 32 }} />
                    <mesh position={[l.x, 0.22, l.z - l.d / 2 - 0.02]} material={MAT.silver} raycast={() => null}>
                      <boxGeometry args={[l.w, 0.25, 0.02]} />
                    </mesh>
                    <Screw pos={[l.x + l.w / 2 - 0.08, 0.36, l.z - l.d / 2 - 0.02]} tight={tight} r={0.035} axis="-z" onClick={fclick(s.id, 'bracket')} glow={g(`fastener:${s.id}:bracket`)} />
                  </group>
                  )}
                </SlideAnim>
                {g(s.id) && <GuideGlow position={[l.x, 0.2, l.z]} size={[l.w, 0.2, l.d]} />}
              </group>
            );
          }
          default:
            return null;
        }
      })}
      {/* risers: metal cage, PCIe card inside, two blue thumbscrews on top */}
      {(['riser1', 'riser2'] as const).map((r) => {
        const rx = r === 'riser1' ? -0.55 : 0.6;
        const key = `layer:${r}`;
        return (
          <SlideAnim key={r} item={dev.layers[r]} dir={[0, 1, 0]} dist={1.6} speed={1.3}>
          {() => (
          <group>
            <Box l={{ x: rx, y: 0.05, z: -2.85, w: 0.95, h: 0.72, d: 1.75 }} color="#59616c" opacity={0.6} onClick={click(key)} emissive={glow(key)} />
            {r === 'riser1' && dev.slots.PCIE1 && (
              <mesh position={[rx, 0.42, -2.85]} raycast={() => null}>
                <boxGeometry args={[0.7, 0.06, 1.5]} />
                <meshStandardMaterial color="#1f2a1f" />
              </mesh>
            )}
            {[0.25, -0.25].map((dx) => (
              <mesh key={dx} position={[rx + dx, 0.79, -2.1]} material={blueMat} onClick={click(key)}>
                <boxGeometry args={[0.16, 0.04, 0.1]} />
              </mesh>
            ))}
            <Screw pos={[rx - 0.32, 0.79, -3.6]} tight={isTight(dev, r, 'ts1')} thumb r={0.05} onClick={fclick(r, 'ts1')} glow={g(`fastener:${r}:ts1`)} />
            <Screw pos={[rx + 0.32, 0.79, -2.1]} tight={isTight(dev, r, 'ts2')} thumb r={0.05} onClick={fclick(r, 'ts2')} glow={g(`fastener:${r}:ts2`)} />
            <Label text={r === 'riser1' ? 'RISER 1' : 'RISER 2'} position={[rx, 0.775, -2.85]} rotation={[-Math.PI / 2, 0, 0]} size={[0.45, 0.1]} opts={{ bg: '#59616c', fg: '#e9edf0', w: 160, h: 36 }} />
            {g(key) && <GuideGlow position={[rx, 0.42, -2.85]} size={[0.95, 0.72, 1.75]} />}
          </group>
          )}
          </SlideAnim>
        );
      })}
      {/* air shroud */}
      <SlideAnim item={dev.layers.shroud} dir={[0, 1, 0]} dist={1.8} speed={1.3}>
        {() => (
        <group>
          <Box l={{ x: 0, y: 0.04, z: 0.6, w: 4.3, h: 0.72, d: 1.75 }} mat={MAT.plastic} onClick={click('layer:shroud')} emissive={glow('layer:shroud')} opacity={0.82} color="#0d0f12" />
          {[-1.6, -0.6, 0.6, 1.6].map((x) => (
            <mesh key={x} position={[x, 0.77, 0.6]} material={blackPlastic} raycast={() => null}>
              <boxGeometry args={[0.05, 0.02, 1.7]} />
            </mesh>
          ))}
          <Label text="AIR SHROUD · DO NOT OPERATE WITHOUT" position={[0, 0.775, 1.2]} rotation={[-Math.PI / 2, 0, 0]} size={[1.6, 0.12]} opts={{ bg: '#0d0f12', fg: '#ffd166', w: 512, h: 40 }} />
          {g('layer:shroud') && <GuideGlow position={[0, 0.4, 0.6]} size={[4.3, 0.72, 1.75]} />}
        </group>
        )}
      </SlideAnim>
      {running && cpuTemp(dev, 0) >= 85 && <pointLight position={[-1.1, 0.8, 0.6]} color="#ff4b2b" intensity={2} distance={2} />}
    </group>
  );
}

/** A drive in its carrier: rails with screws, the drive casting, PCB, top label and the backplane connector. */
function DriveBody({ l, isHdd, zFront }: { l: SlotLayout; isHdd: boolean; zFront: number }) {
  const zc = zFront - 0.06 - l.d / 2;
  const yc = l.y + l.h / 2;
  // HDDs lie flat (wide); U.2 SSDs stand on edge (tall)
  const bw = l.w * 0.82;
  const bh = l.h * 0.8;
  return (
    <group raycast={() => null}>
      {/* casting */}
      <mesh position={[l.x, yc, zc]}>
        <boxGeometry args={[bw, bh, l.d * 0.96]} />
        <meshStandardMaterial color={isHdd ? '#b7bec6' : '#3a3f47'} metalness={0.85} roughness={0.3} />
      </mesh>
      {/* label on the wide face */}
      {isHdd ? (
        <mesh position={[l.x, yc + bh / 2 + 0.002, zc]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[bw * 0.8, l.d * 0.6]} />
          <meshStandardMaterial map={driveLabelTex('hdd')} roughness={0.7} />
        </mesh>
      ) : (
        <mesh position={[l.x + bw / 2 + 0.002, yc, zc]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[l.d * 0.6, bh * 0.85]} />
          <meshStandardMaterial map={driveLabelTex('nvme')} roughness={0.6} />
        </mesh>
      )}
      {/* NVMe heat-spreader fins */}
      {!isHdd &&
        [-0.3, -0.15, 0, 0.15, 0.3].map((dz) => (
          <mesh key={dz} position={[l.x - bw / 2 - 0.006, yc, zc + dz * l.d]} material={MAT.silver}>
            <boxGeometry args={[0.012, bh * 0.85, 0.03]} />
          </mesh>
        ))}
      {/* HDD PCB on the underside */}
      {isHdd && (
        <mesh position={[l.x, yc - bh / 2 - 0.006, zc - l.d * 0.1]}>
          <boxGeometry args={[bw * 0.85, 0.01, l.d * 0.6]} />
          <meshStandardMaterial color="#0f4d2c" />
        </mesh>
      )}
      {/* carrier rails + mounting screws */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[l.x + side * (bw / 2 + (isHdd ? 0.05 : 0.01)), yc, zc]} material={MAT.chassisDark}>
            <boxGeometry args={[isHdd ? 0.06 : 0.02, bh * (isHdd ? 0.9 : 1.04), l.d * 0.98]} />
          </mesh>
          {(isHdd ? [-0.3, 0.3] : [-0.25, 0.25]).map((dz) => (
            <mesh key={dz} position={[l.x + side * (bw / 2 + (isHdd ? 0.085 : 0.025)), yc, zc + dz * l.d]} rotation={[0, 0, Math.PI / 2]} material={MAT.silver}>
              <cylinderGeometry args={[0.022, 0.022, 0.012, 10]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* SATA / SFF-8639 connector at the back */}
      <mesh position={[l.x + (isHdd ? -bw * 0.2 : 0), yc - bh * 0.3, zc - l.d * 0.49]}>
        <boxGeometry args={[isHdd ? bw * 0.45 : 0.05, 0.05, 0.03]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    </group>
  );
}

/** Barcode asset-tag sticker on the left rack ear. With the scanner in hand, clicking it scans it. */
function AssetTag({ dev, glow }: { dev: Device; glow: boolean }) {
  const scanAt = useStore((s) => (s.scanFx?.deviceId === dev.id ? s.scanFx.at : 0));
  const scanner = useStore((s) => s.scanner);
  const beam = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!beam.current) return;
    const age = performance.now() - scanAt;
    beam.current.visible = age < 700;
    if (age < 700) beam.current.position.y = 0.45 + Math.sin(age / 50) * 0.13;
  });
  return (
    <group>
      <mesh
        position={[-2.12, 0.45, FZ + 0.066]}
        onClick={handler(() => {
          const st = useStore.getState();
          if (st.scanner) st.scanTag(dev.id);
          else st.select({ deviceId: dev.id, rackId: dev.rackId ?? undefined });
        })}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = scanner ? 'crosshair' : 'pointer';
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <planeGeometry args={[0.18, 0.36]} />
        <meshBasicMaterial map={barcodeTex(dev.assetTag)} toneMapped={false} />
      </mesh>
      <mesh ref={beam} position={[-2.12, 0.45, FZ + 0.07]} visible={false} raycast={() => null}>
        <planeGeometry args={[0.24, 0.012]} />
        <meshBasicMaterial color="#ff2a2a" toneMapped={false} />
      </mesh>
      {glow && <GuideGlow position={[-2.12, 0.45, FZ + 0.07]} size={[0.2, 0.38, 0.04]} />}
    </group>
  );
}

function FrontPanel({ dev, ac, lod, guide, onSlot, onDevice, onFastener, selSlot }: { dev: Device; ac: boolean; lod: 'full' | 'low'; guide?: string; onSlot: (s: string) => void; onDevice: () => void; onFastener: (target: string, id: string) => void; selSlot?: string }) {
  const w = useStore.getState().world!;
  const m = MODELS[dev.model];
  const bays = m.slots.filter((s) => s.access === 'front');
  const g = (key: string) => guide === key;
  return (
    <group>
      {bays.map((s) => {
        const l = m.layout[s.id];
        const c = dev.slots[s.id];
        const led = slotLed(w, dev, s.id);
        const open = dev.latches[s.id] === 'open';
        const isHdd = s.kind === 'hdd';
        const zFront = FZ + 0.01 + (c && !c.seated ? 0.25 : 0);
        return (
          <group key={s.id} onClick={handler(() => onSlot(s.id))}>
            {/* empty bay: dark opening with guide rails */}
            <mesh position={[l.x, l.y + l.h / 2, FZ - 0.01]}>
              <boxGeometry args={[l.w * 0.96, l.h * 0.92, 0.04]} />
              <meshStandardMaterial color="#07080a" emissive={selSlot === s.id ? '#1d6f8f' : '#000'} emissiveIntensity={0.7} />
            </mesh>
            <SlideAnim item={c} dir={[0, 0, 1]} dist={l.d + 0.6} speed={1.1}>
              {() => (
                <group>
                  {/* the drive itself, hidden inside the chassis until it slides out */}
                  <DriveBody l={l} isHdd={isHdd} zFront={zFront} />
                  {/* carrier faceplate */}
                  <mesh position={[l.x, l.y + l.h / 2, zFront - 0.02]}>
                    <boxGeometry args={[l.w * 0.96, l.h * 0.92, 0.06]} />
                    <meshStandardMaterial color="#3d444e" map={lod === 'full' ? carrierTex(isHdd ? 'hdd' : 'nvme') : null} emissive={selSlot === s.id ? '#1d6f8f' : '#000'} emissiveIntensity={0.7} metalness={0.5} roughness={0.5} />
                  </mesh>
                  {/* hinged handle (orange = hot-swap) */}
                  <group position={isHdd ? [l.x + l.w * 0.46, l.y + l.h / 2, zFront + 0.02] : [l.x, l.y + l.h * 0.05, zFront + 0.02]} rotation={isHdd ? [0, open ? -0.9 : 0, 0] : [open ? 0.9 : 0, 0, 0]}>
                    <mesh position={isHdd ? [-l.w * 0.17, 0, 0.02] : [0, l.h * 0.13, 0.02]} material={MAT.orangeTouch}>
                      <boxGeometry args={isHdd ? [l.w * 0.34, l.h * 0.62, 0.035] : [l.w * 0.72, l.h * 0.26, 0.035]} />
                    </mesh>
                  </group>
                  {lod === 'full' && (
                    <mesh position={isHdd ? [l.x + l.w * 0.04, l.y + l.h / 2, zFront + 0.015] : [l.x, l.y + l.h * 0.36, zFront + 0.015]} rotation={[Math.PI / 2, 0, 0]} material={MAT.orangeTouch}>
                      <cylinderGeometry args={[0.022, 0.022, 0.025, 12]} />
                    </mesh>
                  )}
                </group>
              )}
            </SlideAnim>
            <Led state={led} position={isHdd ? [l.x - l.w * 0.42, l.y + l.h / 2, zFront + 0.03] : [l.x, l.y + l.h * 0.92, zFront + 0.03]} size={0.022} period={led === 'blue_blink' ? 0.5 : led === 'green_blink' ? 0.25 : 1} />
            {g(s.id) && <GuideGlow position={[l.x, l.y + l.h / 2, zFront]} size={[l.w, l.h, 0.1]} />}
          </group>
        );
      })}
      {/* compute nodes: perforated intake bezel + model badge beside the 8 NVMe bays */}
      {m.id === 'hx-2208c' && (
        <group>
          <mesh position={[1.0, 0.43, FZ + 0.012]} raycast={() => null}>
            <planeGeometry args={[1.8, 0.76]} />
            <meshStandardMaterial map={grilleTex('#30363e', '#06080a')} metalness={0.6} roughness={0.45} />
          </mesh>
          {lod === 'full' && <Label text="HX-2208C" position={[1.0, 0.78, FZ + 0.016]} size={[0.5, 0.07]} opts={{ bg: '#30363e', fg: '#c9d0d6', w: 200, h: 28 }} />}
        </group>
      )}
      {/* control panel ear */}
      <group onClick={handler(onDevice)}>
        <mesh position={[2.1, 0.43, FZ + 0.03]} material={MAT.bezel}>
          <boxGeometry args={[0.26, 0.84, 0.06]} />
        </mesh>
        <Led state={powerLed(w, dev) === 'green' ? 'green' : powerLed(w, dev) === 'amber' ? 'amber' : 'off'} position={[2.1, 0.72, FZ + 0.07]} size={0.035} />
        <Led state={healthLed(w, dev) === 'off' ? 'off' : healthLed(w, dev) === 'green' ? 'green' : healthLed(w, dev)} position={[2.1, 0.55, FZ + 0.07]} size={0.035} />
        <Led state={dev.locateLed && ac ? 'blue_blink' : 'off'} position={[2.1, 0.38, FZ + 0.07]} size={0.035} period={0.6} />
        {/* power button */}
        <mesh position={[2.1, 0.18, FZ + 0.07]} rotation={[Math.PI / 2, 0, 0]} {...hoverCursor()}>
          <cylinderGeometry args={[0.05, 0.05, 0.03, 16]} />
          <meshStandardMaterial color="#1d2025" metalness={0.6} roughness={0.4} emissive={dev.power === 'on' ? '#1a6b2f' : '#000'} emissiveIntensity={0.6} />
        </mesh>
        {g('power') && <GuideGlow position={[2.1, 0.18, FZ + 0.07]} size={[0.14, 0.14, 0.06]} />}
      </group>
      {/* left ear with labels + pull-out asset tag */}
      <mesh position={[-2.12, 0.43, FZ + 0.03]} material={MAT.bezel}>
        <boxGeometry args={[0.22, 0.84, 0.06]} />
      </mesh>
      {lod === 'full' && (
        <>
          <AssetTag dev={dev} glow={g('assettag')} />
          <Label text={dev.hostname.split('-').slice(-1)[0]} position={[-2.12, 0.12, FZ + 0.065]} size={[0.2, 0.07]} opts={{ w: 160, h: 56, bg: '#ffffff' }} />
          {[0.06, 0.8].map((y) => (
            <mesh key={y} position={[-2.12, y, FZ + 0.065]} rotation={[Math.PI / 2, 0, 0]} material={MAT.silver} raycast={() => null}>
              <cylinderGeometry args={[0.022, 0.022, 0.02, 10]} />
            </mesh>
          ))}
        </>
      )}
      {/* pull handles + rack-ear slam latches */}
      {([
        [-2.25, 'earL'],
        [2.25, 'earR'],
      ] as const).map(([x, id]) => {
        const tight = isTight(dev, 'chassis', id);
        return (
          <group key={x}>
            <mesh position={[x, 0.43, FZ + 0.12]} material={MAT.silver}>
              <boxGeometry args={[0.05, 0.5, 0.06]} />
            </mesh>
            {dev.rackId && lod === 'full' && (
              <mesh position={[x + Math.sign(x) * 0.07, 0.74 + (tight ? 0 : 0.05), FZ + 0.08]} rotation={[0, 0, tight ? 0 : Math.sign(x) * 0.5]} onClick={handler(() => onFastener('chassis', id))} {...hoverCursor()}>
                <boxGeometry args={[0.1, 0.07, 0.1]} />
                <meshStandardMaterial color={tight ? '#2f7de1' : '#ffe08a'} roughness={0.5} />
              </mesh>
            )}
            {g(`fastener:chassis:${id}`) && <GuideGlow position={[x + Math.sign(x) * 0.07, 0.76, FZ + 0.08]} size={[0.14, 0.12, 0.14]} />}
          </group>
        );
      })}
      {g('chassis') && <GuideGlow position={[0, H / 2, FZ + 0.05]} size={[4.6, H, 0.15]} />}
    </group>
  );
}

function Psu({ dev, slot, lod, guide, selected, onSlot, onFastener }: { dev: Device; slot: string; lod: 'full' | 'low'; guide?: string; selected: boolean; onSlot: () => void; onFastener: (id: string) => void }) {
  const l = MODELS[dev.model].layout[slot];
  const c = dev.slots[slot];
  const g = (key: string) => guide === key;
  return (
    <group>
      {/* the empty bay behind the PSU */}
      <mesh position={[l.x, l.y + l.h / 2, RZ + 0.03]} onClick={handler(onSlot)}>
        <boxGeometry args={[l.w, l.h, 0.04]} />
        <meshStandardMaterial color="#050505" emissive={!c && selected ? '#1d6f8f' : '#000'} />
      </mesh>
      {!c && g(slot) && <GuideGlow position={[l.x, l.y + l.h / 2, RZ]} size={[l.w, l.h, 0.1]} />}
      <SlideAnim item={c} dir={[0, 0, -1]} dist={l.d + 0.7} speed={0.9}>
        {(pc) => <PsuBody dev={dev} slot={slot} c={pc} lod={lod} guide={guide} selected={selected} onSlot={onSlot} onFastener={onFastener} />}
      </SlideAnim>
    </group>
  );
}

function PsuBody({ dev, slot, c, lod, guide, selected, onSlot, onFastener }: { dev: Device; slot: string; c: Component; lod: 'full' | 'low'; guide?: string; selected: boolean; onSlot: () => void; onFastener: (id: string) => void }) {
  const w = useStore.getState().world!;
  const l = MODELS[dev.model].layout[slot];
  const g = (key: string) => guide === key;
  const tabPressed = !isTight(dev, slot, 'tab');
  const bailOn = isTight(dev, slot, 'bail');
  const out = (c.seated ? 0 : -0.3) + (tabPressed ? -0.08 : 0);
  const yc = l.y + l.h / 2;
  const face = RZ - 0.005 + out;
  const dc = c.partNumber.includes('48VDC');
  return (
    <group>
      <mesh position={[l.x, yc, l.z + out]} onClick={handler(onSlot)} {...hoverCursor()}>
        <boxGeometry args={[l.w, l.h, l.d]} />
        <meshStandardMaterial color={dc ? '#4a3b2a' : '#30363e'} emissive={selected ? '#1d6f8f' : '#000'} emissiveIntensity={0.7} metalness={0.6} roughness={0.4} />
      </mesh>
      {/* spec label on top: only visible once it's pulled out */}
      <Label text={`${c.partNumber}\nS/N ${c.serial}\n100-240V~ 10A  ${dc ? '' : '80+ TITANIUM'}`} position={[l.x, yc + l.h / 2 + 0.003, l.z + out]} rotation={[-Math.PI / 2, 0, Math.PI]} size={[l.w * 0.85, l.d * 0.45]} opts={{ bg: '#e9edf0', fg: '#111', w: 256, h: 160, font: 'bold 18px monospace' }} />
      {lod === 'full' && (
        <>
          {/* fan behind the grille */}
          <mesh position={[l.x - 0.14, yc, face + 0.004]} rotation={[0, Math.PI, 0]} raycast={() => null}>
            <ringGeometry args={[0.04, 0.16, 20]} />
            <meshStandardMaterial color="#15181c" />
          </mesh>
          {/* honeycomb exhaust grille */}
          <mesh position={[l.x - 0.14, yc, face - 0.002]} rotation={[0, Math.PI, 0]} raycast={() => null}>
            <planeGeometry args={[0.36, l.h * 0.86]} />
            <meshStandardMaterial map={grilleTex()} metalness={0.5} roughness={0.5} />
          </mesh>
          {/* handle */}
          {[-0.3, 0.02].map((dx) => (
            <mesh key={dx} position={[l.x + dx, yc - 0.12, face - 0.06]} material={blackPlastic} raycast={() => null}>
              <boxGeometry args={[0.04, 0.05, 0.12]} />
            </mesh>
          ))}
          <mesh position={[l.x - 0.14, yc - 0.12, face - 0.12]} material={blackPlastic} onClick={handler(onSlot)}>
            <boxGeometry args={[0.36, 0.05, 0.04]} />
          </mesh>
          {/* C14 inlet (or DC terminal block) */}
          <mesh position={[l.x + 0.19, yc + 0.02, face - 0.02]} material={blackPlastic} raycast={() => null}>
            <boxGeometry args={[0.17, 0.13, 0.04]} />
          </mesh>
          {/* wire retention bail: hinged under the inlet, flips up over the plug */}
          {!dc && (
            <group position={[l.x + 0.19, yc - 0.06, face - 0.03]} rotation={[bailOn ? 2.0 : 0.25, 0, 0]}>
              {[-0.1, 0.1].map((dx) => (
                <mesh key={dx} position={[dx, -0.09, 0]} material={wireMat} onClick={handler(() => onFastener('bail'))} {...hoverCursor()}>
                  <boxGeometry args={[0.018, 0.18, 0.018]} />
                </mesh>
              ))}
              <mesh position={[0, -0.18, 0]} material={wireMat} onClick={handler(() => onFastener('bail'))} {...hoverCursor()}>
                <boxGeometry args={[0.22, 0.018, 0.018]} />
              </mesh>
            </group>
          )}
          {g(`fastener:${slot}:bail`) && <GuideGlow position={[l.x + 0.19, yc - 0.06, face - 0.12]} size={[0.26, 0.2, 0.2]} />}
          {/* green release tab */}
          <mesh position={[l.x + 0.32, yc - 0.03, face - 0.03 + (tabPressed ? 0.025 : 0)]} material={tabPressed ? greenTabPressed : greenTab} onClick={handler(() => onFastener('tab'))} {...hoverCursor()}>
            <boxGeometry args={[0.05, 0.22, 0.06]} />
          </mesh>
          {g(`fastener:${slot}:tab`) && <GuideGlow position={[l.x + 0.32, yc - 0.03, face - 0.03]} size={[0.08, 0.26, 0.1]} />}
          <Label text={dc ? '-48V DC' : c.partNumber.includes('1100') ? '1100W' : '1600W'} position={[l.x - 0.14, yc + l.h / 2 - 0.035, face - 0.004]} rotation={[0, Math.PI, 0]} size={[0.2, 0.05]} opts={{ bg: '#e9edf0', fg: dc ? '#a3361d' : '#111', w: 96, h: 24 }} />
        </>
      )}
      <Led state={slotLed(w, dev, slot)} position={[l.x + 0.32, yc + 0.13, face - 0.02]} size={0.03} />
      {g(slot) && <GuideGlow position={[l.x, yc, face + 0.3]} size={[l.w, l.h, 0.7]} />}
      {g(`cord:${slot}`) && <GuideGlow position={[l.x + 0.19, yc + 0.02, face - 0.12]} size={[0.22, 0.2, 0.25]} />}
    </group>
  );
}

function RearPanel({ dev, lod, guide, onSlot, onPort, onFastener, pendingPort, selSlot }: { dev: Device; lod: 'full' | 'low'; guide?: string; onSlot: (s: string) => void; onPort: (p: string) => void; onFastener: (target: string, id: string) => void; pendingPort?: string | null; selSlot?: string }) {
  const m = MODELS[dev.model];
  const g = (key: string) => guide === key;
  const l = m.layout.OCP0;
  const nic = dev.slots.OCP0;
  return (
    <group>
      {['PSU1', 'PSU2'].map((p) => (
        <Psu key={p} dev={dev} slot={p} lod={lod} guide={guide} selected={selSlot === p} onSlot={() => onSlot(p)} onFastener={(id) => onFastener(p, id)} />
      ))}
      {/* rear exhaust vents + PCIe slot brackets */}
      {lod === 'full' && (
        <>
          <mesh position={[0.6, 0.62, RZ - 0.006]} rotation={[0, Math.PI, 0]} raycast={() => null}>
            <planeGeometry args={[0.9, 0.36]} />
            <meshStandardMaterial map={grilleTex('#2f353d')} metalness={0.5} roughness={0.5} />
          </mesh>
          {[-0.55, 0.6].map((x) => (
            <mesh key={x} position={[x, 0.22, RZ - 0.008]} rotation={[0, Math.PI, 0]} material={MAT.silver} raycast={() => null}>
              <planeGeometry args={[0.6, 0.3]} />
            </mesh>
          ))}
        </>
      )}
      {/* OCP NIC: faceplate, SFP cages, pull tab, captive thumbscrew */}
      <group onClick={handler(() => onSlot('OCP0'))}>
        <mesh position={[l.x, l.y + l.h / 2, RZ + 0.03]}>
          <boxGeometry args={[l.w, l.h + 0.05, 0.03]} />
          <meshStandardMaterial color="#050505" emissive={!nic && selSlot === 'OCP0' ? '#1d6f8f' : '#000'} />
        </mesh>
        <SlideAnim item={nic} dir={[0, 0, -1]} dist={l.d + 0.6} speed={1}>
          {() => (
            <group>
              <mesh position={[l.x, l.y + l.h / 2, RZ + 0.01]}>
                <boxGeometry args={[l.w, l.h + 0.05, 0.03]} />
                <meshStandardMaterial color="#596270" metalness={0.7} roughness={0.35} emissive={selSlot === 'OCP0' ? '#1d6f8f' : '#000'} />
              </mesh>
              {/* the card itself, inside the chassis */}
              <mesh position={[l.x, l.y + l.h / 2, RZ + 0.03 + l.d / 2]} raycast={() => null}>
                <boxGeometry args={[l.w * 0.92, 0.03, l.d]} />
                <meshStandardMaterial color="#0f4d2c" />
              </mesh>
              <mesh position={[l.x + 0.1, l.y + l.h / 2 + 0.04, RZ + 0.03 + l.d * 0.6]} material={MAT.silver} raycast={() => null}>
                <boxGeometry args={[0.3, 0.06, 0.3]} />
              </mesh>
              {lod === 'full' && (
                <mesh position={[l.x - l.w / 2 + 0.03, l.y + l.h / 2, RZ - 0.06]} material={MAT.orangeTouch}>
                  <boxGeometry args={[0.04, 0.1, 0.1]} />
                </mesh>
              )}
              {lod === 'full' && <Screw pos={[l.x + l.w / 2 - 0.05, l.y + l.h / 2, RZ - 0.02]} tight={isTight(dev, 'OCP0', 'thumb')} thumb r={0.035} axis="-z" onClick={handler(() => onFastener('OCP0', 'thumb'))} glow={g('fastener:OCP0:thumb')} />}
            </group>
          )}
        </SlideAnim>
      </group>
      {g('OCP0') && <GuideGlow position={[l.x, l.y + l.h / 2, RZ]} size={[l.w, l.h + 0.05, 0.1]} />}
      {(['nic0p0', 'nic0p1', 'bmc'] as const).map((p) => {
        const pos = portLocal(dev, p);
        const pending = pendingPort === p;
        if (p !== 'bmc' && !nic) return null;
        return (
          <group key={p}>
          {/* SFP28 cage / RJ45 jack shell around the port opening */}
          <mesh position={[pos.x, pos.y, pos.z + 0.012]} material={p === 'bmc' ? MAT.chassisDark : MAT.silver} raycast={() => null}>
            <boxGeometry args={p === 'bmc' ? [0.19, 0.16, 0.03] : [0.18, 0.13, 0.03]} />
          </mesh>
          <mesh position={pos} onClick={handler(() => onPort(p))} {...hoverCursor('crosshair')}>
            <boxGeometry args={p === 'bmc' ? [0.16, 0.13, 0.04] : [0.15, 0.1, 0.04]} />
            <meshStandardMaterial color={pending ? '#4fd1c5' : '#050505'} emissive={pending ? '#4fd1c5' : '#000'} emissiveIntensity={0.8} />
          </mesh>
          </group>
        );
      })}
      {lod === 'full' && (
        <>
          <Label text="P0  P1" position={[-1.65, 0.24, RZ - 0.02]} rotation={[0, Math.PI, 0]} size={[0.5, 0.07]} opts={{ bg: '#1b1f25', fg: '#cbd5e0', w: 200, h: 28 }} />
          <Label text="BMC" position={[-0.95, 0.45, RZ - 0.02]} rotation={[0, Math.PI, 0]} size={[0.2, 0.07]} opts={{ bg: '#1b1f25', fg: '#63b3ed', w: 100, h: 34 }} />
        </>
      )}
    </group>
  );
}

function Lid({ dev, guide, selected, onSlot, onFastener }: { dev: Device; guide?: string; selected: boolean; onSlot: () => void; onFastener: (id: string) => void }) {
  const latchUp = !isTight(dev, 'lid', 'latch');
  const screwTight = isTight(dev, 'lid', 'screw');
  const back = latchUp ? -0.25 : 0;
  const g = (key: string) => guide === key;
  return (
    <group position={[0, 0, back]}>
      <mesh position={[0, H + 0.01, 0]} onClick={handler(onSlot)} {...hoverCursor()}>
        <boxGeometry args={[4.42, 0.02, CHASSIS_D * 0.98]} />
        <meshStandardMaterial color="#ffffff" map={lidTex()} metalness={0.6} roughness={0.4} emissive={selected ? '#1d6f8f' : '#000'} />
      </mesh>
      <Label text="⇦ LIFT LATCH · SLIDE BACK ⇨" position={[0, H + 0.025, 1.5]} rotation={[-Math.PI / 2, 0, 0]} size={[1.4, 0.2]} opts={{ bg: '#6b7480', fg: '#1d2025', w: 340, h: 50 }} />
      {/* service label */}
      <Label text={'SERVICE: 1 LID  2 SHROUD  3 DIMM / CPU\nHOT-SWAP = ORANGE · COLD = BLUE'} position={[-1.1, H + 0.025, -0.6]} rotation={[-Math.PI / 2, 0, 0]} size={[1.6, 0.4]} opts={{ bg: '#e9edf0', fg: '#1d2025', w: 512, h: 128, font: 'bold 22px monospace' }} />
      {/* cam latch */}
      <group position={[0.9, H + 0.03, -0.9]} rotation={[latchUp ? -0.7 : 0, 0, 0]}>
        <mesh position={[0, 0, 0.18]} onClick={handler(() => onFastener('latch'))} {...hoverCursor()}>
          <boxGeometry args={[0.55, 0.04, 0.36]} />
          <meshStandardMaterial color={latchUp ? '#ffe08a' : '#2f7de1'} roughness={0.5} />
        </mesh>
      </group>
      {g('fastener:lid:latch') && <GuideGlow position={[0.9, H + 0.08, -0.72]} size={[0.6, 0.12, 0.4]} />}
      <Screw pos={[0.9, H + 0.03, -3.4]} tight={screwTight} r={0.05} onClick={handler(() => onFastener('screw'))} glow={g('fastener:lid:screw')} />
      {g('layer:lid') && <GuideGlow position={[0, H, 0]} size={[4.42, 0.06, CHASSIS_D]} />}
    </group>
  );
}

/** One textured box + live LEDs: how every server you are not working on is drawn. */
function LowServer({ dev, ac, groupRef, target, onDevice }: { dev: Device; ac: boolean; groupRef: React.RefObject<THREE.Group | null>; target: THREE.Vector3; onDevice: () => void }) {
  const w = useStore.getState().world!;
  return (
    <group ref={groupRef} position={target}>
      <mesh position={[0, H / 2, 0]} onClick={handler(onDevice)} {...hoverCursor()}>
        <boxGeometry args={[4.4, H, CHASSIS_D]} />
        <meshStandardMaterial attach="material-0" color="#3a414b" metalness={0.55} roughness={0.45} />
        <meshStandardMaterial attach="material-1" color="#3a414b" metalness={0.55} roughness={0.45} />
        <meshStandardMaterial attach="material-2" color="#ffffff" map={lidTex()} metalness={0.55} roughness={0.45} />
        <meshStandardMaterial attach="material-3" color="#3a414b" metalness={0.55} roughness={0.45} />
        <meshStandardMaterial attach="material-4" map={serverFaceTex(dev.model, false)} metalness={0.5} roughness={0.5} />
        <meshStandardMaterial attach="material-5" map={serverFaceTex(dev.model, true)} metalness={0.5} roughness={0.5} />
      </mesh>
      <Led state={powerLed(w, dev) === 'green' ? 'green' : powerLed(w, dev) === 'amber' ? 'amber' : 'off'} position={[2.1, 0.72, FZ + 0.02]} size={0.035} />
      <Led state={healthLed(w, dev) === 'off' ? 'off' : healthLed(w, dev) === 'green' ? 'green' : healthLed(w, dev)} position={[2.1, 0.55, FZ + 0.02]} size={0.035} />
      {dev.locateLed && ac && <Led state="blue_blink" position={[2.1, 0.38, FZ + 0.02]} size={0.035} period={0.6} />}
      {['PSU1', 'PSU2'].map((psu) => {
        const l = MODELS[dev.model].layout[psu];
        return dev.slots[psu] ? <Led key={psu} state={slotLed(w, dev, psu)} position={[l.x + 0.32, l.y + l.h / 2 + 0.13, RZ - 0.02]} size={0.03} /> : null;
      })}
    </group>
  );
}

function ServerMeshInner(p: ServerMeshProps) {
  const { dev, x, detail, lod } = p;
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
  const onSlot = (s: string) => p.onSlot(dev.id, s);
  if (lod === 'low') return <LowServer dev={dev} ac={ac} groupRef={g} target={target} onDevice={() => p.onDevice(dev.id)} />;
  const onFastener = (t: string, id: string) => p.onFastener(dev.id, t, id);
  return (
    <group ref={g} position={target}>
      {/* body */}
      <mesh position={[0, H / 2, 0]} onClick={handler(() => p.onDevice(dev.id))} {...hoverCursor()} visible={!showInside}>
        <boxGeometry args={[4.4, H, CHASSIS_D]} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <meshStandardMaterial key={i} attach={`material-${i}`} color={i === 2 ? (p.selected ? '#c9d6e3' : '#ffffff') : p.selected ? '#4b5563' : '#3a414b'} map={i === 2 && lod === 'full' ? lidTex() : null} metalness={0.55} roughness={0.45} emissive={p.selected ? '#103040' : '#000'} />
        ))}
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
          <Interior dev={dev} ac={ac} selSlot={p.selSlot} highlightSlot={p.highlightSlot} guide={p.guide} onSlot={onSlot} onFastener={onFastener} onLatch={(s) => p.onLatch(dev.id, s)} />
        </>
      )}
      {detail && (dev.servicePosition || !dev.rackId) && (
        <SlideAnim item={dev.layers.lid} dir={[0, 0.45, -1]} dist={3.2} speed={1}>
          {() => <Lid dev={dev} guide={p.guide} selected={p.selSlot === 'layer:lid'} onSlot={() => onSlot('layer:lid')} onFastener={(id) => onFastener('lid', id)} />}
        </SlideAnim>
      )}
      <FrontPanel dev={dev} ac={ac} lod={lod} guide={p.guide} onSlot={onSlot} onDevice={() => p.onDevice(dev.id)} onFastener={onFastener} selSlot={p.selSlot} />
      <RearPanel dev={dev} lod={lod} guide={p.guide} onSlot={onSlot} onPort={(port) => p.onPort(dev.id, port)} onFastener={onFastener} pendingPort={p.pendingPort} selSlot={p.selSlot} />
    </group>
  );
}

export const ServerMesh = memo(ServerMeshInner);

export function componentLabel(c: Component | null | undefined): string {
  return c ? `${c.partNumber} · ${c.serial}` : 'empty';
}
