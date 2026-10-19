// Vendor front panels for the 2U nodes: logo plate, rack-ear control panels and LEDs styled after
// Dell PowerEdge 16G, HPE ProLiant Gen11, Lenovo ThinkSystem V3 and Supermicro X13 systems.
// Close recreations for training; DCT Training is not affiliated with any of these vendors.
import * as THREE from 'three';
import { MODELS } from '../../../engine/catalog';
import { healthLed, healthRollup, powerLed } from '../../../engine/projectors';
import type { Device, World } from '../../../engine/types';
import type { VendorId } from '../../../engine/vendors';
import { drawLogo } from '../../brand';
import { bevelBox, canvasTex, CHASSIS_D, GuideGlow, hoverCursor, Led } from './common';
import { VSTYLE } from './vendorStyle';

export { VSTYLE };

const FZ = CHASSIS_D / 2;
const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(key: string, make: () => THREE.MeshStandardMaterial) {
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = make()));
  return m;
}
export const vMat = (color: string, metal = 0.35, rough = 0.55) => mat(`c${color}${metal}${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));

// ---------- textures (high resolution, cached per vendor/model) ----------

/** Perforated intake plate beside the 8 NVMe bays, with the vendor logo and model badge. */
function plateTex(v: VendorId, modelId: string): THREE.CanvasTexture {
  const st = VSTYLE[v];
  return canvasTex(`vplate${v}${modelId}`, 2048, 864, (g) => {
    g.fillStyle = st.plate;
    g.fillRect(0, 0, 2048, 864);
    // perforation: Dell's hex mesh, HPE's slotted vents, Lenovo's square grid, Supermicro's round holes
    g.fillStyle = '#07080a';
    if (v === 'dell') {
      for (let r = 0; r < 26; r++)
        for (let c = 0; c < 70; c++) {
          const x = 40 + c * 28 + (r % 2 ? 14 : 0);
          const y = 40 + r * 24;
          g.beginPath();
          for (let k = 0; k < 6; k++) g.lineTo(x + 10 * Math.cos((k * Math.PI) / 3), y + 10 * Math.sin((k * Math.PI) / 3));
          g.fill();
        }
    } else if (v === 'hpe') {
      for (let r = 0; r < 14; r++) for (let c = 0; c < 30; c++) g.fillRect(50 + c * 66, 40 + r * 46, 50, 16);
    } else if (v === 'lenovo') {
      for (let r = 0; r < 22; r++) for (let c = 0; c < 60; c++) g.fillRect(44 + c * 33, 40 + r * 29, 20, 20);
    } else {
      for (let r = 0; r < 22; r++)
        for (let c = 0; c < 62; c++) {
          g.beginPath();
          g.arc(50 + c * 32 + (r % 2 ? 16 : 0), 46 + r * 28, 10, 0, Math.PI * 2);
          g.fill();
        }
    }
    // solid band for the badge
    g.fillStyle = st.plate;
    g.fillRect(0, 610, 2048, 254);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 610, 2048, 3);
    const m = MODELS[modelId];
    if (v === 'hpe') {
      drawLogo(g, 'hpe', 70, 640, 360, 200);
      g.fillStyle = st.text;
      g.font = `600 64px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(`ProLiant ${m.badge}`, 470, 740);
    } else if (v === 'lenovo') {
      drawLogo(g, 'lenovo', 60, 660, 380, 150);
      g.fillStyle = st.text;
      g.font = `600 64px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(`ThinkSystem ${m.badge}`, 470, 740);
    } else if (v === 'supermicro') {
      drawLogo(g, 'supermicro', 60, 650, 760, 170);
      g.fillStyle = st.text;
      g.font = `600 52px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(m.badge ?? '', 880, 740);
    } else {
      drawLogo(g, 'dell', 70, 640, 420, 200, '#d9dde1');
      g.fillStyle = st.text;
      g.font = `600 64px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(`PowerEdge ${m.badge}`, 540, 740);
    }
  });
}

/** Printed legends on the rack ears (icons, labels, logo). `side` L/R, `w`×`h` in chassis units. */
function earTex(v: VendorId, side: 'L' | 'R', storage: boolean): THREE.CanvasTexture {
  const st = VSTYLE[v];
  return canvasTex(`vear${v}${side}${storage}`, 256, 1024, (g) => {
    g.fillStyle = st.ear;
    g.fillRect(0, 0, 256, 1024);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, 6, 1024);
    g.fillRect(250, 0, 6, 1024);
    g.strokeStyle = st.text;
    g.fillStyle = st.text;
    g.lineWidth = 6;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // y in texture = (0.86 - chassisY) / 0.84 * 1024
    const ty = (y: number) => ((0.85 - y) / 0.84) * 1024;
    const icon = (kind: string, cx: number, cy: number, s: number) => {
      g.save();
      g.translate(cx, cy);
      g.lineWidth = 5;
      g.beginPath();
      if (kind === 'drive') {
        g.strokeRect(-s, -s * 0.6, s * 2, s * 1.2);
        g.moveTo(-s * 0.6, s * 0.2);
        g.lineTo(s * 0.6, s * 0.2);
      } else if (kind === 'temp') {
        g.arc(0, s * 0.55, s * 0.4, 0, Math.PI * 2);
        g.moveTo(0, s * 0.15);
        g.lineTo(0, -s);
      } else if (kind === 'power') {
        g.moveTo(s * 0.2, -s);
        g.lineTo(-s * 0.5, s * 0.1);
        g.lineTo(s * 0.1, s * 0.1);
        g.lineTo(-s * 0.2, s);
      } else if (kind === 'memory') {
        g.strokeRect(-s, -s * 0.4, s * 2, s * 0.8);
        for (let i = -2; i <= 2; i++) {
          g.moveTo(i * s * 0.4, s * 0.4);
          g.lineTo(i * s * 0.4, s * 0.75);
        }
      } else if (kind === 'pcie') {
        g.strokeRect(-s, -s * 0.5, s * 2, s);
        g.moveTo(-s * 0.6, s * 0.5);
        g.lineTo(-s * 0.6, s);
        g.moveTo(s * 0.2, s * 0.5);
        g.lineTo(s * 0.2, s);
      } else if (kind === 'id') {
        g.font = `800 ${s * 1.4}px ${FONT}`;
        g.fillText('i', 0, 0);
      } else if (kind === 'onoff') {
        g.arc(0, s * 0.1, s * 0.8, -Math.PI * 0.32, Math.PI * 1.32);
        g.moveTo(0, -s);
        g.lineTo(0, s * 0.1);
      } else if (kind === 'net') {
        g.strokeRect(-s * 0.35, -s, s * 0.7, s * 0.6);
        g.strokeRect(-s, s * 0.3, s * 0.7, s * 0.6);
        g.strokeRect(s * 0.3, s * 0.3, s * 0.7, s * 0.6);
        g.moveTo(0, -s * 0.4);
        g.lineTo(0, s * 0.05);
        g.moveTo(-s * 0.65, s * 0.3);
        g.lineTo(-s * 0.65, s * 0.05);
        g.lineTo(s * 0.65, s * 0.05);
        g.lineTo(s * 0.65, s * 0.3);
      } else if (kind === 'usb') {
        g.moveTo(0, s);
        g.lineTo(0, -s);
        g.moveTo(-s * 0.4, -s * 0.5);
        g.lineTo(0, -s);
        g.lineTo(s * 0.4, -s * 0.5);
        g.moveTo(0, s * 0.2);
        g.lineTo(s * 0.5, -s * 0.2);
      } else if (kind === 'reset') {
        g.arc(0, 0, s * 0.8, 0.3, Math.PI * 1.8);
      } else if (kind === 'error') {
        g.moveTo(0, -s);
        g.lineTo(s, s * 0.8);
        g.lineTo(-s, s * 0.8);
        g.closePath();
        g.moveTo(0, -s * 0.3);
        g.lineTo(0, s * 0.3);
      }
      g.stroke();
      g.restore();
    };
    for (const el of EARS[v][side]) {
      if (el.icon) icon(el.icon, el.iconX ?? 60, ty(el.y), 22);
      if (el.text) {
        g.font = `600 ${el.textSize ?? 34}px ${FONT}`;
        g.fillText(el.text, el.textX ?? 128, ty(el.textY ?? el.y));
      }
    }
    if (side === 'L' && (v === 'hpe' || v === 'lenovo' || v === 'supermicro')) {
      // vertical logo at the top of the left ear
      g.save();
      g.translate(128, 120);
      g.rotate(-Math.PI / 2);
      drawLogo(g, v, -110, -70, 220, 140, v === 'hpe' ? undefined : v === 'lenovo' ? undefined : st.text);
      g.restore();
    }
    if (side === 'R' && storage && v === 'dell') {
      g.save();
      g.translate(128, 930);
      g.rotate(-Math.PI / 2);
      drawLogo(g, 'dell', -90, -50, 180, 100, st.text);
      g.restore();
    }
  });
}

// ---------- ear layouts ----------

type EarRole = 'power' | 'health' | 'id' | 'uid' | 'nic' | 'error' | 'reset' | 'hdd' | 'info' | 'port' | 'status';
interface EarEl {
  y: number;
  role?: EarRole;
  /** for status LEDs: which health area lights it */
  area?: 'storage' | 'temperature' | 'power' | 'memory' | 'gpu';
  icon?: string;
  iconX?: number;
  text?: string;
  textX?: number;
  textY?: number;
  textSize?: number;
}

const EARS: Record<VendorId, { L: EarEl[]; R: EarEl[] }> = {
  // Dell 16G: left = status LED indicators + system health/ID button + information tag; right = power + iDRAC Direct
  dell: {
    L: [
      { y: 0.8, role: 'status', area: 'storage', icon: 'drive', iconX: 70 },
      { y: 0.755, role: 'status', area: 'temperature', icon: 'temp', iconX: 70 },
      { y: 0.71, role: 'status', area: 'power', icon: 'power', iconX: 70 },
      { y: 0.665, role: 'status', area: 'memory', icon: 'memory', iconX: 70 },
      { y: 0.62, role: 'status', area: 'gpu', icon: 'pcie', iconX: 70 },
      { y: 0.215, role: 'id', icon: 'id', iconX: 64 },
    ],
    R: [
      { y: 0.7, role: 'power', icon: 'onoff', iconX: 128, text: '', textY: 0.6 },
      { y: 0.46, role: 'port', icon: 'usb', iconX: 70, text: 'iDRAC', textY: 0.4, textSize: 30 },
      { y: 0.25, role: 'port', icon: 'usb', iconX: 70 },
    ],
  },
  // HPE Gen11: right = power, UID, health, NIC status, iLO service port
  hpe: {
    L: [{ y: 0.2, role: 'info', text: 'S/N', textY: 0.2, textSize: 28 }],
    R: [
      { y: 0.74, role: 'power', icon: 'onoff', iconX: 70 },
      { y: 0.6, role: 'uid', icon: 'id', iconX: 70, text: 'UID', textX: 170, textSize: 28 },
      { y: 0.48, role: 'health', icon: 'error', iconX: 70 },
      { y: 0.38, role: 'nic', icon: 'net', iconX: 70 },
      { y: 0.2, role: 'port', icon: 'usb', iconX: 70, text: 'iLO', textY: 0.13, textSize: 28 },
    ],
  },
  // Lenovo V3: right latch = power, ID, system error, network activity, USB + XCC port
  lenovo: {
    L: [{ y: 0.18, role: 'info', text: 'XCC', textY: 0.18, textSize: 28 }],
    R: [
      { y: 0.74, role: 'power', icon: 'onoff', iconX: 70 },
      { y: 0.6, role: 'uid', icon: 'id', iconX: 70 },
      { y: 0.49, role: 'error', icon: 'error', iconX: 70 },
      { y: 0.39, role: 'nic', icon: 'net', iconX: 70 },
      { y: 0.22, role: 'port', icon: 'usb', iconX: 70 },
    ],
  },
  // Supermicro: right ear control panel = power, reset, UID buttons; power, HDD, NIC, info LEDs
  supermicro: {
    L: [],
    R: [
      { y: 0.76, role: 'power', icon: 'onoff', iconX: 70 },
      { y: 0.65, role: 'reset', icon: 'reset', iconX: 70 },
      { y: 0.55, role: 'uid', icon: 'id', iconX: 70 },
      { y: 0.44, role: 'hdd', icon: 'drive', iconX: 70 },
      { y: 0.35, role: 'nic', icon: 'net', iconX: 70, text: '1', textX: 200, textSize: 30 },
      { y: 0.27, role: 'nic', icon: 'net', iconX: 70, text: '2', textX: 200, textSize: 30 },
      { y: 0.16, role: 'info', icon: 'error', iconX: 70, text: 'i', textX: 200, textSize: 34 },
    ],
  },
};

// ---------- components ----------

export function VendorPlate({ v, modelId }: { v: VendorId; modelId: string }) {
  return (
    <group raycast={() => null}>
      <mesh position={[1.0, 0.43, FZ + 0.006]} geometry={bevelBox(1.82, 0.78, 0.02, 0.008, 2)} material={vMat(VSTYLE[v].plate, 0.45, 0.5)} />
      <mesh position={[1.0, 0.43, FZ + 0.017]}>
        <planeGeometry args={[1.8, 0.76]} />
        <meshStandardMaterial map={plateTex(v, modelId)} metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

const btnGeo = new THREE.CylinderGeometry(1, 1, 1, 40);
const ringGeo = new THREE.TorusGeometry(1, 0.16, 12, 48);
const portGeo = bevelBox(1, 1, 1, 0.1, 2);

/**
 * Both rack ears for a vendor chassis: printed legend texture, then real buttons, LEDs and ports.
 * The power button keeps its sim behaviour (click → inspect/power, coach glow on 'power').
 */
export function VendorEars({ dev, w, v, ac, onDevice, glowPower }: { dev: Device; w: World; v: VendorId; ac: boolean; onDevice: () => void; glowPower: boolean }) {
  const st = VSTYLE[v];
  const storage = MODELS[dev.model].form === 'storage';
  const pl = powerLed(w, dev);
  const hl = healthLed(w, dev);
  const h = healthRollup(w, dev);
  const on = dev.power === 'on' || dev.power === 'posting';
  const fault = hl === 'amber' || hl === 'amber_blink';
  const ears: Array<['L' | 'R', number, number]> = [
    ['L', -2.12, 0.22],
    ['R', 2.1, 0.26],
  ];
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <group>
      {ears.map(([side, x, width]) => (
        <group key={side} onClick={side === 'R' ? (e) => (stop(e), onDevice()) : undefined}>
          <mesh position={[x, 0.43, FZ + 0.03]} geometry={bevelBox(width, 0.84, 0.06, 0.012, 3)} material={vMat(st.ear, 0.25, 0.6)} />
          <mesh position={[x, 0.43, FZ + 0.0605]} raycast={() => null}>
            <planeGeometry args={[width * 0.98, 0.835]} />
            <meshStandardMaterial map={earTex(v, side, storage)} metalness={0.2} roughness={0.6} transparent={false} />
          </mesh>
          {EARS[v][side].map((el, i) => {
            const z = FZ + 0.064;
            const lx = x + (side === 'R' ? 0.03 : 0.035);
            const ix = x - width / 2 + ((el.iconX ?? 60) / 256) * width;
            if (el.role === 'power') {
              const r = v === 'dell' ? 0.05 : 0.038;
              const bx = v === 'dell' ? x : lx;
              return (
                <group key={i} {...hoverCursor()}>
                  <mesh position={[bx, el.y, z + 0.008]} rotation={[Math.PI / 2, 0, 0]} scale={[r, 0.018, r]} geometry={btnGeo} material={vMat('#1b1d21', 0.6, 0.35)} />
                  <mesh position={[bx, el.y, z + 0.004]} scale={[r * 1.12, r * 1.12, r]} geometry={ringGeo}>
                    <meshStandardMaterial color={pl === 'green' ? '#39ff7a' : pl === 'amber' ? '#ffb02e' : '#222'} emissive={pl === 'green' ? '#1fd65c' : pl === 'amber' ? '#c97a00' : '#000'} emissiveIntensity={pl === 'off' ? 0 : 2.2} toneMapped={false} />
                  </mesh>
                  {glowPower && <GuideGlow position={[bx, el.y, z + 0.01]} size={[0.14, 0.14, 0.06]} />}
                </group>
              );
            }
            if (el.role === 'port')
              return (
                <group key={i} raycast={() => null}>
                  <mesh position={[lx, el.y, z]} scale={[0.07, 0.03, 0.02]} geometry={portGeo} material={vMat('#0a0b0d', 0.4, 0.5)} />
                  <mesh position={[lx, el.y, z + 0.004]} scale={[0.05, 0.012, 0.01]} geometry={portGeo} material={vMat('#5c6670', 0.8, 0.3)} />
                </group>
              );
            if (el.role === 'reset')
              return <mesh key={i} position={[lx, el.y, z + 0.004]} rotation={[Math.PI / 2, 0, 0]} scale={[0.02, 0.012, 0.02]} geometry={btnGeo} material={vMat('#0c0d0f', 0.3, 0.6)} raycast={() => null} />;
            // LEDs and lit buttons
            let state: Parameters<typeof Led>[0]['state'] = 'off';
            if (!ac) state = 'off';
            else if (el.role === 'status') state = h[el.area!] === 'ok' ? 'off' : 'amber';
            else if (el.role === 'id') state = dev.locateLed ? 'blue_blink' : fault ? 'amber_blink' : 'blue';
            else if (el.role === 'uid') state = dev.locateLed ? 'blue_blink' : 'off';
            else if (el.role === 'health') state = !on ? 'off' : fault ? (h.overall === 'critical' ? 'red' : 'amber') : 'green';
            else if (el.role === 'error' || el.role === 'info') state = fault ? 'amber' : 'off';
            else if (el.role === 'nic') state = on ? 'green_blink' : 'off';
            else if (el.role === 'hdd') state = on ? 'amber_blink' : 'off';
            const big = el.role === 'id' || el.role === 'uid';
            return (
              <group key={i}>
                {big && <mesh position={[ix, el.y, z + 0.006]} rotation={[Math.PI / 2, 0, 0]} scale={[0.034, 0.014, 0.034]} geometry={btnGeo} material={vMat('#16181b', 0.5, 0.4)} raycast={() => null} />}
                <Led state={state} position={[side === 'L' ? x + 0.05 : lx + 0.05, el.y, z + (big ? 0.014 : 0.004)]} size={big ? 0.026 : 0.017} period={el.role === 'nic' ? 0.18 : el.role === 'hdd' ? 0.12 : 0.7} />
              </group>
            );
          })}
          {/* Dell's pull-out information tag (Service Tag, iDRAC password) peeking out of the left ear */}
          {side === 'L' && v === 'dell' && (
            <mesh position={[x - 0.02, 0.845, FZ + 0.05]} raycast={() => null}>
              <boxGeometry args={[0.16, 0.025, 0.008]} />
              <meshStandardMaterial color="#e8ecef" roughness={0.6} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
