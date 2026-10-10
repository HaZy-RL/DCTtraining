// The DCO workroom at the end of the hall: laptop desk, RMA station and the spare-parts shelving.
import { memo } from 'react';
import * as THREE from 'three';
import { KIND_LABEL } from '../../../engine/catalog';
import type { ComponentKind, SparePart } from '../../../engine/types';
import { canvasTex, GuideGlow, hoverCursor, Label, Led } from './common';

/** Room footprint relative to its west wall x0 (the wall facing the hall). */
export const ROOM = { depth: 30, z0: -12, z1: 14, door: [2, 11] as [number, number], wallH: 30 };

export const SHELF_KINDS: ComponentKind[] = ['psu', 'fan', 'hdd', 'nvme', 'dimm', 'cpu', 'm2', 'nic', 'gpu', 'cmos'];

export function roomSpots(x0: number) {
  return {
    desk: new THREE.Vector3(x0 + 8, 7.6, ROOM.z0 + 3.2),
    rma: new THREE.Vector3(x0 + 19, 7.6, ROOM.z0 + 3.2),
    shelf: (kind: ComponentKind) => {
      const i = SHELF_KINDS.indexOf(kind);
      const level = Math.floor(i / 3);
      const col = i % 3;
      return new THREE.Vector3(x0 + ROOM.depth - 3, 3 + level * 4.6, -3 + col * 4.2);
    },
  };
}

const wallMat = new THREE.MeshStandardMaterial({ color: '#d9dee4', roughness: 0.9 });
const steel = new THREE.MeshStandardMaterial({ color: '#8a939d', metalness: 0.8, roughness: 0.35 });
const darkSteel = new THREE.MeshStandardMaterial({ color: '#3a414b', metalness: 0.7, roughness: 0.4 });
const binBlue = new THREE.MeshStandardMaterial({ color: '#2f6fd6', roughness: 0.6 });
const esdMat = new THREE.MeshStandardMaterial({ color: '#2d6f8f', roughness: 0.85 });
const wood = new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 0.8 });
const bagMat = new THREE.MeshStandardMaterial({ color: '#b9c0c8', metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.85 });

function screenTex() {
  return canvasTex('laptopscreen', 512, 320, (g) => {
    g.fillStyle = '#0b0f19';
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#121a26';
    g.fillRect(0, 0, 512, 34);
    g.fillStyle = '#76b900';
    g.font = 'bold 18px monospace';
    g.fillText('Jira · DCO queue', 14, 23);
    const rows = ['P2  DCO-4  PSU1 redundancy lost', 'P3  DCO-4  DIMM_A1 UCE replace', 'P3  DCO-4  HDD bay 7 failed', 'P4  DCO-4  Label audit row C'];
    rows.forEach((r, i) => {
      g.fillStyle = i === 0 ? '#1d2a3c' : '#101724';
      g.fillRect(14, 50 + i * 44, 484, 36);
      g.fillStyle = '#c3cbdb';
      g.font = '15px monospace';
      g.fillText(r, 24, 74 + i * 44);
    });
    g.fillStyle = '#06b6d4';
    g.fillRect(14, 240, 150, 30);
    g.fillStyle = '#0b0f19';
    g.font = 'bold 14px sans-serif';
    g.fillText('→ In Progress', 30, 260);
  });
}

function signTex(text: string, bg: string) {
  return canvasTex(`rsign${text}`, 512, 96, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#fff';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 50);
  });
}

/** A spare as it sits on the shelf: roughly the real part's shape, in an ESD bag where it would be. */
function SpareModel({ kind, label }: { kind: ComponentKind; label: string }) {
  const size: Record<ComponentKind, [number, number, number]> = {
    psu: [0.73, 0.39, 1.85],
    fan: [0.62, 0.62, 0.38],
    hdd: [1.02, 0.26, 1.47],
    nvme: [0.7, 0.15, 1.0],
    dimm: [1.33, 0.32, 0.05],
    cpu: [0.75, 0.08, 0.75],
    m2: [1.1, 0.04, 0.22],
    nic: [0.76, 0.12, 1.15],
    gpu: [1.68, 0.25, 0.75],
    cmos: [0.2, 0.03, 0.2],
    heatsink: [0.9, 0.6, 0.95],
  };
  const [w, h, d] = size[kind];
  const bagged = kind === 'dimm' || kind === 'cpu' || kind === 'm2' || kind === 'nic' || kind === 'gpu' || kind === 'hdd' || kind === 'nvme';
  return (
    <group>
      <mesh position={[0, h / 2 + 0.02, 0]} material={bagged ? bagMat : undefined}>
        <boxGeometry args={[w + (bagged ? 0.12 : 0), h + (bagged ? 0.06 : 0), d + (bagged ? 0.12 : 0)]} />
        {!bagged && <meshStandardMaterial color={kind === 'psu' ? '#30363e' : '#22262c'} metalness={0.6} roughness={0.4} />}
      </mesh>
      {kind === 'psu' && (
        <mesh position={[w / 2 - 0.05, h / 2, d / 2 + 0.02]}>
          <boxGeometry args={[0.05, 0.22, 0.05]} />
          <meshStandardMaterial color="#2fb35a" />
        </mesh>
      )}
      <Label text={label} position={[0, h + 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} size={[Math.max(0.6, Math.min(w, 1.4)), 0.16]} opts={{ bg: '#f4f4f2', fg: '#111', w: 256, h: 40, font: 'bold 18px monospace' }} />
    </group>
  );
}

function WorkroomInner({ x0, spares, guide, onSelect }: { x0: number; spares: SparePart[]; guide?: string; onSelect: (room: string) => void }) {
  const { depth, z0, z1, door, wallH } = ROOM;
  const x1 = x0 + depth;
  const zc = (z0 + z1) / 2;
  const spots = roomSpots(x0);
  const click = (room: string) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect(room);
  };
  const shelfX = x1 - 3;
  return (
    <group>
      {/* floor (white epoxy) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.02, zc]} receiveShadow>
        <planeGeometry args={[depth, z1 - z0]} />
        <meshStandardMaterial color="#e6e9ec" roughness={0.35} metalness={0.05} />
      </mesh>
      {/* walls: hall-side wall with a doorway, back wall, two side walls */}
      <mesh position={[x0, wallH / 2, (z0 + door[0]) / 2]} material={wallMat}>
        <boxGeometry args={[0.4, wallH, door[0] - z0]} />
      </mesh>
      <mesh position={[x0, wallH / 2, (door[1] + z1) / 2]} material={wallMat}>
        <boxGeometry args={[0.4, wallH, z1 - door[1]]} />
      </mesh>
      <mesh position={[x0, (wallH + 21) / 2, (door[0] + door[1]) / 2]} material={wallMat}>
        <boxGeometry args={[0.4, wallH - 21, door[1] - door[0]]} />
      </mesh>
      <mesh position={[x1, wallH / 2, zc]} material={wallMat}>
        <boxGeometry args={[0.4, wallH, z1 - z0]} />
      </mesh>
      {[z0, z1].map((z) => (
        <mesh key={z} position={[(x0 + x1) / 2, wallH / 2, z]} material={wallMat}>
          <boxGeometry args={[depth, wallH, 0.4]} />
        </mesh>
      ))}
      {/* door frame + sign over it (hall side) */}
      <mesh position={[x0 - 0.25, 21.2, (door[0] + door[1]) / 2]} material={darkSteel}>
        <boxGeometry args={[0.2, 0.4, door[1] - door[0]]} />
      </mesh>
      <mesh position={[x0 - 0.25, 23.5, (door[0] + door[1]) / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[8, 1.5]} />
        <meshBasicMaterial map={signTex('DCO WORKROOM · PARTS · RMA', '#1d2a3c')} toneMapped={false} />
      </mesh>
      <pointLight position={[(x0 + x1) / 2, 26, zc]} intensity={60} distance={45} color="#f4f8ff" />

      {/* ---- laptop desk ---- */}
      <group onClick={click('laptop')} {...hoverCursor()}>
        <mesh position={[spots.desk.x, 7.3, spots.desk.z]} material={wood}>
          <boxGeometry args={[12, 0.35, 5.5]} />
        </mesh>
        {[-5.5, 5.5].map((dx) =>
          [-2.3, 2.3].map((dz) => (
            <mesh key={`${dx}${dz}`} position={[spots.desk.x + dx, 3.6, spots.desk.z + dz]} material={darkSteel}>
              <boxGeometry args={[0.3, 7.2, 0.3]} />
            </mesh>
          )),
        )}
        {/* laptop */}
        <mesh position={[spots.desk.x, 7.55, spots.desk.z + 0.6]} material={darkSteel}>
          <boxGeometry args={[3.4, 0.14, 2.3]} />
        </mesh>
        <group position={[spots.desk.x, 7.6, spots.desk.z - 0.55]} rotation={[-0.25, 0, 0]}>
          <mesh position={[0, 1.1, 0]} material={darkSteel}>
            <boxGeometry args={[3.4, 2.2, 0.1]} />
          </mesh>
          <mesh position={[0, 1.12, 0.06]}>
            <planeGeometry args={[3.1, 1.9]} />
            <meshBasicMaterial map={screenTex()} toneMapped={false} />
          </mesh>
        </group>
        {/* second monitor + phone + coffee */}
        <mesh position={[spots.desk.x - 4, 9.4, spots.desk.z - 1.6]} material={darkSteel}>
          <boxGeometry args={[3.6, 2.2, 0.15]} />
        </mesh>
        <mesh position={[spots.desk.x - 4, 9.4, spots.desk.z - 1.51]}>
          <planeGeometry args={[3.4, 2]} />
          <meshBasicMaterial map={canvasTex('dashscreen', 256, 160, (g) => {
            g.fillStyle = '#0b0f19';
            g.fillRect(0, 0, 256, 160);
            g.strokeStyle = '#76b900';
            g.lineWidth = 3;
            g.beginPath();
            for (let i = 0; i < 25; i++) g.lineTo(10 + i * 10, 110 - Math.sin(i / 2) * 25 - i);
            g.stroke();
            g.fillStyle = '#06b6d4';
            g.font = 'bold 14px monospace';
            g.fillText('PHX1 hall H2 · 42.1 kW', 10, 20);
          })} toneMapped={false} />
        </mesh>
        <mesh position={[spots.desk.x + 4.5, 7.9, spots.desk.z + 1]}>
          <cylinderGeometry args={[0.25, 0.22, 0.8, 16]} />
          <meshStandardMaterial color="#f2f2f2" roughness={0.5} />
        </mesh>
        {guide === 'room:laptop' && <GuideGlow position={[spots.desk.x, 8.5, spots.desk.z]} size={[3.6, 2.4, 2.6]} />}
      </group>
      <mesh position={[spots.desk.x, 4.6, spots.desk.z + 5.5]} material={darkSteel}>
        <boxGeometry args={[2.2, 0.3, 2.2]} />
      </mesh>
      <mesh position={[spots.desk.x, 6.5, spots.desk.z + 6.5]} material={darkSteel}>
        <boxGeometry args={[2.2, 3.6, 0.3]} />
      </mesh>
      <mesh position={[spots.desk.x, 25, z0 + 0.25]} rotation={[0, 0, 0]}>
        <planeGeometry args={[8, 1.5]} />
        <meshBasicMaterial map={signTex('💻 DCO DESK', '#244b2a')} toneMapped={false} />
      </mesh>

      {/* ---- RMA station ---- */}
      <group onClick={click('rma')} {...hoverCursor()}>
        <mesh position={[spots.rma.x, 7.3, spots.rma.z]} material={darkSteel}>
          <boxGeometry args={[10, 0.35, 5.5]} />
        </mesh>
        <mesh position={[spots.rma.x, 7.5, spots.rma.z]} material={esdMat}>
          <boxGeometry args={[9.6, 0.06, 5.1]} />
        </mesh>
        {[-4.6, 4.6].map((dx) => (
          <mesh key={dx} position={[spots.rma.x + dx, 3.6, spots.rma.z]} material={darkSteel}>
            <boxGeometry args={[0.3, 7.2, 5]} />
          </mesh>
        ))}
        {/* label printer + ESD bag roll */}
        <mesh position={[spots.rma.x - 3, 8.1, spots.rma.z - 1]}>
          <boxGeometry args={[1.4, 1, 1.6]} />
          <meshStandardMaterial color="#e9edf0" roughness={0.5} />
        </mesh>
        <mesh position={[spots.rma.x + 2.5, 8, spots.rma.z - 1.4]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.45, 0.45, 3, 20]} />
          <meshStandardMaterial color="#c0c6cd" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* bins on the floor in front of the bench */}
        {([
          { dx: -3.2, color: '#2f6fd6', name: 'RMA', label: '#2f6fd6' },
          { dx: 0, color: '#59616c', name: '🔒 SHRED', label: '#c0392b' },
          { dx: 3.2, color: '#2f9e55', name: 'E-WASTE', label: '#2f9e55' },
        ] as const).map((b) => (
          <group key={b.name} position={[spots.rma.x + b.dx, 0, spots.rma.z + 4.2]}>
            <mesh position={[0, 1.8, 0]}>
              <boxGeometry args={[2.8, 3.6, 2.6]} />
              <meshStandardMaterial color={b.color} roughness={0.6} />
            </mesh>
            {b.name.includes('SHRED') && (
              <mesh position={[0, 3.62, 0]}>
                <boxGeometry args={[1.6, 0.05, 0.25]} />
                <meshBasicMaterial color="#0a0a0a" />
              </mesh>
            )}
            <mesh position={[0, 2.4, 1.31]}>
              <planeGeometry args={[2.4, 0.7]} />
              <meshBasicMaterial map={signTex(b.name, b.label)} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {guide === 'room:rma' && <GuideGlow position={[spots.rma.x, 4, spots.rma.z + 2]} size={[10, 8, 9]} />}
      </group>
      <mesh position={[spots.rma.x, 25, z0 + 0.25]}>
        <planeGeometry args={[8, 1.5]} />
        <meshBasicMaterial map={signTex('♻ RMA STATION', '#1d3a5c')} toneMapped={false} />
      </mesh>

      {/* ---- spare-parts shelving along the back wall ---- */}
      <group>
        {[-5.2, 7.8].map((dz) =>
          [-2.2, 2.2].map((dx) => (
            <mesh key={`${dz}${dx}`} position={[shelfX + dx, 9.5, dz]} material={steel}>
              <boxGeometry args={[0.25, 19, 0.25]} />
            </mesh>
          )),
        )}
        {[0, 1, 2, 3].map((lvl) => (
          <mesh key={lvl} position={[shelfX, 1.9 + lvl * 4.6, 1.3]} material={steel}>
            <boxGeometry args={[4.6, 0.15, 13.2]} />
          </mesh>
        ))}
        <mesh position={[shelfX - 2.4, 20.5, 1.3]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[9, 1.4]} />
          <meshBasicMaterial map={signTex('📦 SPARES · CHECK THE PN', '#4a3a12')} toneMapped={false} />
        </mesh>
        {SHELF_KINDS.map((kind) => {
          const p = spots.shelf(kind);
          const onShelf = spares.filter((s) => s.location === 'cage' && s.component.kind === kind);
          const room = `shelf:${kind}`;
          return (
            <group key={kind} onClick={click(room)} {...hoverCursor()}>
              {/* open-front bin */}
              <mesh position={[p.x, p.y - 0.85 + 0.6, p.z]} material={binBlue}>
                <boxGeometry args={[4, 1.2, 3.8]} />
              </mesh>
              <Label text={KIND_LABEL[kind].toUpperCase()} position={[p.x - 2.02, p.y - 0.15, p.z]} rotation={[0, -Math.PI / 2, 0]} size={[2.6, 0.45]} opts={{ bg: '#f4f4f2', fg: '#111', w: 256, h: 44, font: 'bold 26px system-ui' }} />
              {onShelf.map((s, i) => (
                <group key={s.component.uid} position={[p.x - 0.6 + (i % 2) * 1.2, p.y + 0.4 + Math.floor(i / 2) * 0.55, p.z - 1 + (i % 3) * 1]} rotation={[0, (i * 0.37) % 0.6, 0]}>
                  <SpareModel kind={kind} label={s.component.partNumber} />
                </group>
              ))}
              {onShelf.length > 0 && <Led state="green" position={[p.x - 2.05, p.y - 0.55, p.z + 1.6]} size={0.08} />}
              {guide === room && <GuideGlow position={[p.x, p.y + 0.8, p.z]} size={[4.2, 2.6, 4]} />}
            </group>
          );
        })}
      </group>
    </group>
  );
}

export const Workroom = memo(WorkroomInner);
