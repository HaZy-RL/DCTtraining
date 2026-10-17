import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, PDU_X, PDU_Z, PLINTH, RACK_D, RACK_PITCH, U, uBaseY } from './common';

/**
 * Overhead cable infrastructure for the whole hall, laid out the way a real colo does it (low to high above each row):
 *   1. A/B power busways over the rear of the racks, with a tap-off box per rack and a whip down into each PDU
 *   2. a wire-mesh basket tray for copper/DAC, with waterfall drops into the rack roofs
 *   3. a yellow fiber raceway on top, with a downspout into every rack
 * all hung from threaded-rod trapezes, joined by ladder bridges across the aisles and a backbone at the end of the hall.
 * Filler racks also get their rear cabling (node DACs to the ToR, management copper to the OOB switch).
 *
 * Purely visual: nothing here is in the sim (ToR uplinks swp49+ stay free for the cabling scenarios), so every mesh is
 * merged per material and ignores the raycaster.
 */

export const RACK_TOP = 42 * U + PLINTH + 0.6;
const CEIL = 31;
const BUS_Y = 23.4; // busway centre
const BUS = { A: 3.0, B: 4.5 }; // busway positions, measured from the row centre toward the rear of the racks
const TAP_X = { A: 1.9, B: -1.9 }; // tap-off boxes sit inboard of the hanger struts
const BASKET = { y: 25.0, r0: -2.6, r1: 0.8, wall: 0.6 };
const FIBER = { y: 27.0, r0: 0.3, r1: 2.1, wall: 0.7 };
const DOWNSPOUT_R = 1.7;
const ROD_R = [-3.0, 5.6];

interface Row {
  z: number;
  rear: 1 | -1; // which way "rear" points in world z
  flip: boolean;
  x0: number;
  x1: number;
  busX1: number; // busways stop at the end of the racks
  racks: Array<{ x: number; real: boolean }>;
}

// ---------- materials ----------

const wireTex = () =>
  canvasTex(
    'wiremesh',
    64,
    128,
    (g) => {
      g.clearRect(0, 0, 64, 128);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 7;
      g.strokeRect(0, 0, 64, 128);
    },
    [1, 1],
  );

const MATS: Record<string, THREE.Material> = {
  strut: new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.75, roughness: 0.4 }),
  rod: new THREE.MeshStandardMaterial({ color: '#7d8590', metalness: 0.8, roughness: 0.35 }),
  ladder: new THREE.MeshStandardMaterial({ color: '#a7b0ba', metalness: 0.75, roughness: 0.35 }),
  busway: new THREE.MeshStandardMaterial({ color: '#c4c9cf', metalness: 0.85, roughness: 0.3 }),
  slot: new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.3, roughness: 0.7 }),
  tapBox: new THREE.MeshStandardMaterial({ color: '#d0d4d9', metalness: 0.5, roughness: 0.45 }),
  feedA: new THREE.MeshStandardMaterial({ color: '#2f7de1', roughness: 0.6 }),
  feedB: new THREE.MeshStandardMaterial({ color: '#e1442f', roughness: 0.6 }),
  whip: new THREE.MeshStandardMaterial({ color: '#2b2f35', roughness: 0.75 }),
  fiberDuct: new THREE.MeshStandardMaterial({ color: '#e8c21a', roughness: 0.55 }),
  grommet: new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.9 }),
  sleeve: new THREE.MeshStandardMaterial({ color: '#8f969e', roughness: 0.8 }),
  firestop: new THREE.MeshStandardMaterial({ color: '#c8402a', roughness: 0.9 }),
  cBlue: new THREE.MeshStandardMaterial({ color: '#2f6fe1', roughness: 0.6 }),
  cBlack: new THREE.MeshStandardMaterial({ color: '#1a1d21', roughness: 0.55 }),
  cGrey: new THREE.MeshStandardMaterial({ color: '#8a939d', roughness: 0.6 }),
  cYellow: new THREE.MeshStandardMaterial({ color: '#d9b72b', roughness: 0.6 }),
  cAqua: new THREE.MeshStandardMaterial({ color: '#2fd1d1', roughness: 0.5 }),
  cSmf: new THREE.MeshStandardMaterial({ color: '#e2d92b', roughness: 0.5 }),
};
let basketMat: THREE.MeshStandardMaterial | null = null;
const basket = () =>
  (basketMat ??= new THREE.MeshStandardMaterial({ color: '#d5dae0', map: wireTex(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.35 }));

// ---------- geometry kit: everything is collected per material and merged ----------

class Kit {
  parts = new Map<string, THREE.BufferGeometry[]>();
  lowDetail: boolean;
  constructor(lowDetail: boolean) {
    this.lowDetail = lowDetail;
  }
  add(key: string, g: THREE.BufferGeometry) {
    const list = this.parts.get(key) ?? [];
    list.push(g);
    this.parts.set(key, list);
  }
  box(key: string, c: [number, number, number], s: [number, number, number]) {
    const g = new THREE.BoxGeometry(...s);
    g.translate(...c);
    this.add(key, g);
  }
  /** Vertical cylinder from y0 to y1. */
  rod(key: string, x: number, z: number, y0: number, y1: number, r: number, rTop = r) {
    const g = new THREE.CylinderGeometry(rTop, r, Math.abs(y1 - y0), this.lowDetail ? 5 : 8);
    g.translate(x, (y0 + y1) / 2, z);
    this.add(key, g);
  }
  tube(key: string, pts: THREE.Vector3[], r: number, segPerUnit = 1.2) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.4);
    const seg = Math.max(4, Math.round(curve.getLength() * segPerUnit * (this.lowDetail ? 0.5 : 1)));
    this.add(key, new THREE.TubeGeometry(curve, seg, r, this.lowDetail ? 4 : 6, false));
  }
  /** Flat textured panel (wire mesh) with UVs in metres so the mesh pitch is the same on every piece. */
  panel(key: string, c: [number, number, number], size: [number, number], rot: [number, number, number]) {
    const g = new THREE.PlaneGeometry(size[0], size[1]);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * size[0]) / 1.0, (uv.getY(i) * size[1]) / 0.5);
    g.rotateX(rot[0]);
    g.rotateY(rot[1]);
    g.rotateZ(rot[2]);
    g.translate(...c);
    this.add(key, g);
  }
  merged(): Array<{ key: string; geo: THREE.BufferGeometry }> {
    const out: Array<{ key: string; geo: THREE.BufferGeometry }> = [];
    for (const [key, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (geo) out.push({ key, geo });
    }
    return out;
  }
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- per-row build ----------

function buildRow(k: Kit, row: Row, rnd: () => number) {
  const zr = (r: number) => row.z + row.rear * r;
  const v = (x: number, y: number, r: number) => new THREE.Vector3(x, y, zr(r));
  const len = row.x1 - row.x0;
  const cx = (row.x0 + row.x1) / 2;

  // trapeze hangers every two racks: two threaded rods, a strut under each tier
  for (let x = row.x0 + RACK_PITCH; x < row.x1 - 0.5; x += RACK_PITCH * 2) {
    for (const r of ROD_R) k.rod('rod', x, zr(r), BUS_Y - 0.65, CEIL, 0.06);
    for (const y of [BUS_Y - 0.7, BASKET.y - 0.22, FIBER.y - 0.22]) k.box('strut', [x, y, zr((ROD_R[0] + ROD_R[1]) / 2)], [0.42, 0.42, ROD_R[1] - ROD_R[0] + 0.3]);
  }

  // 1. A/B busways with a continuous tap-off slot underneath, fed from a box at the hall end
  for (const feed of ['A', 'B'] as const) {
    const r = BUS[feed];
    const bl = row.busX1 - row.x0;
    const bc = (row.x0 + row.busX1) / 2;
    k.box('busway', [bc, BUS_Y, zr(r)], [bl, 1.0, 1.0]);
    k.box('slot', [bc, BUS_Y - 0.51, zr(r)], [bl, 0.04, 0.32]);
    k.box('tapBox', [row.x0 + 0.9, BUS_Y + 0.1, zr(r)], [1.8, 1.9, 1.3]);
    k.box(feed === 'A' ? 'feedA' : 'feedB', [row.x0 + 0.9, BUS_Y + 0.3, zr(r) + row.rear * 0.66], [1.2, 0.5, 0.02]);
    k.rod('slot', row.x0 + 0.9, zr(r), BUS_Y + 1.05, CEIL, 0.28); // conduit up to the distribution above the ceiling
  }

  // 2. wire basket: floor + two side walls, carrying a few long bundles
  const bw = BASKET.r1 - BASKET.r0;
  const bMid = zr((BASKET.r0 + BASKET.r1) / 2);
  k.panel('basket', [cx, BASKET.y, bMid], [len, bw], [-Math.PI / 2, 0, 0]);
  for (const r of [BASKET.r0, BASKET.r1]) k.panel('basket', [cx, BASKET.y + BASKET.wall / 2, zr(r)], [len, BASKET.wall], [0, 0, 0]);
  const bundles: Array<[string, number, number]> = [
    ['cBlue', -1.9, 0.2],
    ['cBlack', -1.1, 0.18],
    ['cGrey', -0.3, 0.15],
    ['cBlue', 0.35, 0.12],
  ];
  for (const [mat, r, rad] of bundles) {
    const pts: THREE.Vector3[] = [];
    for (let x = row.x0 + 0.3; x <= row.x1 - 0.3; x += 8) pts.push(v(x, BASKET.y + rad + 0.02, r + (rnd() - 0.5) * 0.25));
    pts.push(v(row.x1 - 0.3, BASKET.y + rad + 0.02, r));
    k.tube(mat, pts, rad, 0.25);
  }

  // 3. fiber raceway (U channel) with a couple of trunks inside
  const fw = FIBER.r1 - FIBER.r0;
  k.box('fiberDuct', [cx, FIBER.y, zr((FIBER.r0 + FIBER.r1) / 2)], [len, 0.08, fw]);
  for (const r of [FIBER.r0, FIBER.r1]) k.box('fiberDuct', [cx, FIBER.y + FIBER.wall / 2, zr(r)], [len, FIBER.wall, 0.07]);
  for (const [mat, r] of [
    ['cAqua', 0.8],
    ['cSmf', 1.45],
  ] as const) {
    const pts: THREE.Vector3[] = [];
    for (let x = row.x0 + 0.3; x <= row.x1 - 0.3; x += 10) pts.push(v(x, FIBER.y + 0.14, r + (rnd() - 0.5) * 0.2));
    pts.push(v(row.x1 - 0.3, FIBER.y + 0.14, r));
    k.tube(mat, pts, 0.1, 0.2);
  }

  // drops into every rack
  for (const rk of row.racks) {
    const s = row.flip ? -1 : 1; // rack-local +x in world
    // power: a tap-off box on each busway, a whip down through the roof into the PDU
    for (const feed of ['A', 'B'] as const) {
      const r = BUS[feed];
      const bx = rk.x + s * TAP_X[feed];
      k.box('tapBox', [bx, BUS_Y - 1.1, zr(r)], [0.9, 1.2, 0.8]);
      k.box(feed === 'A' ? 'feedA' : 'feedB', [bx, BUS_Y - 1.05, zr(r) + row.rear * 0.41], [0.55, 0.35, 0.02]);
      const px = rk.x + s * PDU_X[feed];
      const pr = -PDU_Z; // PDUs sit just inside the rear posts
      const end = rk.real ? v(px, PLINTH + 18, pr) : v(px, RACK_TOP + 0.02, pr - 0.3);
      k.tube('whip', [v(bx, BUS_Y - 1.7, r), v(bx, BUS_Y - 2.4, r), v((bx + px) / 2, RACK_TOP + 0.9, (r + pr) / 2), v(px, RACK_TOP + 0.25, pr - 0.3), end], 0.085);
    }
    // copper: a waterfall of patch bundles off the basket's rear lip into the roof
    const wx = rk.x - s * 1.0;
    k.box('grommet', [wx, RACK_TOP + 0.02, zr(BASKET.r1 + 0.2)], [1.3, 0.05, 0.55]);
    (['cBlue', 'cBlack', 'cGrey'] as const).forEach((mat, i) => {
      const x = wx + (i - 1) * 0.3;
      k.tube(mat, [v(x, BASKET.y + 0.15, BASKET.r1 - 0.5), v(x, BASKET.y + 0.25, BASKET.r1 + 0.05), v(x, BASKET.y - 0.5, BASKET.r1 + 0.32), v(x, RACK_TOP + 1.5, BASKET.r1 + 0.25), v(x, RACK_TOP, BASKET.r1 + 0.2)], 0.075);
    });
    // fiber: funnel + corrugated downspout
    const fx = rk.x + s * 0.9;
    k.rod('fiberDuct', fx, zr(DOWNSPOUT_R), FIBER.y - 0.45, FIBER.y + 0.02, 0.22, 0.4);
    k.rod('fiberDuct', fx, zr(DOWNSPOUT_R), RACK_TOP + 0.05, FIBER.y - 0.45, 0.2);
    k.box('grommet', [fx, RACK_TOP + 0.02, zr(DOWNSPOUT_R)], [0.6, 0.05, 0.6]);
  }
}

/** Ladder tray between two points along z at a given x (cross-aisle bridges and the backbone). */
function ladderZ(k: Kit, x: number, y: number, z0: number, z1: number, width: number) {
  const L = Math.abs(z1 - z0);
  const zc = (z0 + z1) / 2;
  for (const sx of [-width / 2, width / 2]) k.box('ladder', [x + sx, y + 0.17, zc], [0.1, 0.34, L]);
  for (let z = Math.min(z0, z1) + 0.4; z < Math.max(z0, z1); z += 0.9) k.box('ladder', [x, y + 0.03, z], [width, 0.06, 0.12]);
}

/** Yellow raceway run along z (fiber bridge / backbone). */
function raceZ(k: Kit, x: number, y: number, z0: number, z1: number, width: number) {
  const L = Math.abs(z1 - z0);
  const zc = (z0 + z1) / 2;
  k.box('fiberDuct', [x, y, zc], [width, 0.08, L]);
  for (const sx of [-width / 2, width / 2]) k.box('fiberDuct', [x + sx, y + FIBER.wall / 2, zc], [0.07, FIBER.wall, L]);
}

/** Bundles lying along a ladder run in z. */
function bundleZ(k: Kit, x: number, y: number, z0: number, z1: number, mats: Array<[string, number, number]>) {
  for (const [mat, dx, rad] of mats) k.tube(mat, [new THREE.Vector3(x + dx, y + rad + 0.06, z0), new THREE.Vector3(x + dx, y + rad + 0.06, (z0 + z1) / 2), new THREE.Vector3(x + dx, y + rad + 0.06, z1)], rad, 0.2);
}

function trapezeZ(k: Kit, x: number, z: number, halfW: number, ys: number[]) {
  for (const sx of [-halfW, halfW]) k.rod('rod', x + sx, z, Math.min(...ys) - 0.4, CEIL, 0.06);
  for (const y of ys) k.box('strut', [x, y - 0.22, z], [halfW * 2 + 0.3, 0.42, 0.42]);
}

/**
 * Rear cabling of a filler rack, built in rack-local space (rear face at -RACK_D/2) and placed with the rack's own
 * transform: every 2U node's DAC (port block on the right of the rear texture) into a bundle up to the ToR, and its
 * management copper (the painted yellow lead) up the other side to the OOB switch.
 */
function fillerRear(k: Kit, x: number, z: number, flip: boolean) {
  const m = new THREE.Matrix4().makeRotationY(flip ? Math.PI : 0).setPosition(x, 0, z);
  const zf = -RACK_D / 2;
  const local = new Kit(k.lowDetail);
  const top = uBaseY(42) + U / 2;
  const tor = (sx: number, y: number) => new THREE.Vector3(sx, y, zf - 0.25);
  const nodes: number[] = [];
  for (let u = 3; u <= 39; u += 2) nodes.push(uBaseY(u) + U);
  // bundles hang in the vertical managers at each side and turn in at the switches
  local.tube('cBlack', [tor(-2.62, nodes[0] - 0.3), tor(-2.62, (nodes[0] + top) / 2), tor(-2.62, top - 0.6), tor(-2.2, top - 0.05), tor(-1.4, top)], 0.17, 1);
  local.tube('cYellow', [tor(2.62, nodes[0] - 0.3), tor(2.62, (nodes[0] + top) / 2), tor(2.62, top - 1.0), tor(2.2, top - U - 0.05), tor(1.4, top - U)], 0.12, 1);
  for (const y of nodes) {
    local.tube('cBlack', [new THREE.Vector3(-1.7, y, zf - 0.02), new THREE.Vector3(-1.85, y - 0.04, zf - 0.22), new THREE.Vector3(-2.5, y + 0.1, zf - 0.26)], 0.04, 3);
    local.tube('cYellow', [new THREE.Vector3(0.89, y + 0.1, zf - 0.02), new THREE.Vector3(1.2, y + 0.08, zf - 0.2), new THREE.Vector3(2.52, y + 0.18, zf - 0.24)], 0.025, 3);
  }
  for (const [key, list] of local.parts) for (const g of list) k.add(key, g.applyMatrix4(m));
}

export interface OverheadProps {
  origin: number;
  minP: number;
  maxP: number;
  realPositions: number[];
  roomX0: number;
  oppositeZ: number;
  lowDetail: boolean;
}

function OverheadInner({ origin, minP, maxP, realPositions, roomX0, oppositeZ, lowDetail }: OverheadProps) {
  const realKey = realPositions.join();
  const parts = useMemo(() => {
    const k = new Kit(lowDetail);
    const rnd = lcg(4242);
    const px = (p: number) => (p - origin) * RACK_PITCH;
    const x0 = px(minP - 4) - RACK_PITCH / 2;
    const x1 = px(maxP + 4) + RACK_PITCH / 2;
    const real = new Set(realPositions);
    const span = (a: number, b: number, isReal: (p: number) => boolean) => {
      const out: Array<{ x: number; real: boolean; p: number }> = [];
      for (let p = a; p <= b; p++) out.push({ x: px(p), real: isReal(p), p });
      return out;
    };
    const main = span(minP, maxP, (p) => real.has(p));
    const neighbour = span(minP - 4, maxP + 4, () => false);
    // the main row's trays continue through the workroom wall to the MDA; the neighbouring rows stop at their ends
    const rows: Row[] = [
      { z: 0, rear: -1, flip: false, x0, x1: roomX0, busX1: x1, racks: main },
      { z: oppositeZ, rear: 1, flip: true, x0, x1, busX1: x1, racks: neighbour },
      { z: -oppositeZ, rear: 1, flip: true, x0, x1, busX1: x1, racks: neighbour },
    ];
    for (const row of rows) buildRow(k, row, rnd);

    // filler racks: rear cabling (the real racks are cabled by the sim)
    for (const r of main) if (!r.real) fillerRear(k, r.x, 0, false);
    for (const r of neighbour) for (const z of [oppositeZ, -oppositeZ]) fillerRear(k, r.x, z, true);

    // where each row's basket/raceway sits in z
    const span0 = (row: Row, a: number, b: number) => [row.z + row.rear * a, row.z + row.rear * b].sort((m, n) => m - n) as [number, number];
    const bMain = span0(rows[0], BASKET.r0, BASKET.r1);
    const bUp = span0(rows[1], BASKET.r0, BASKET.r1);
    const bDown = span0(rows[2], BASKET.r0, BASKET.r1);
    const fMain = span0(rows[0], FIBER.r0, FIBER.r1);
    const fUp = span0(rows[1], FIBER.r0, FIBER.r1);
    const fDown = span0(rows[2], FIBER.r0, FIBER.r1);
    const copper: Array<[string, number, number]> = [
      ['cBlue', -0.45, 0.16],
      ['cBlack', 0.2, 0.14],
    ];

    // cross-aisle bridges every six racks, skipping the aisle signs in the middle of the hall
    const signX = (px(minP) + px(maxP)) / 2;
    for (let p = minP - 1; p <= maxP + 1; p += 6) {
      const bx = px(p) + RACK_PITCH / 2;
      if (Math.abs(bx - signX) < 6.5) continue;
      for (const [a, b] of [
        [bMain[1], bUp[0]],
        [bDown[1], bMain[0]],
      ]) {
        ladderZ(k, bx, BASKET.y, a, b, 1.6);
        bundleZ(k, bx, BASKET.y, a, b, copper);
        trapezeZ(k, bx, (a + b) / 2, 1.0, [BASKET.y]);
      }
      const fx = bx + 1.4;
      for (const [a, b] of [
        [fMain[1], fUp[0]],
        [fDown[1], fMain[0]],
      ]) {
        raceZ(k, fx, FIBER.y, a, b, 1.2);
        k.tube('cAqua', [new THREE.Vector3(fx, FIBER.y + 0.12, a), new THREE.Vector3(fx, FIBER.y + 0.12, b)], 0.08, 0.2);
        trapezeZ(k, fx, (a + b) / 2, 0.75, [FIBER.y]);
      }
    }

    // backbone across the far end of the hall, collecting every row
    const zLo = Math.min(bDown[0], fDown[0]) - 0.4;
    const zHi = Math.max(bUp[1], fUp[1]) + 0.4;
    const bbx = x0 - 1.1;
    ladderZ(k, bbx, BASKET.y, zLo, zHi, 2.0);
    bundleZ(k, bbx, BASKET.y, zLo, zHi, [
      ['cBlue', -0.6, 0.2],
      ['cBlack', 0.0, 0.18],
      ['cGrey', 0.55, 0.15],
    ]);
    raceZ(k, bbx, FIBER.y, zLo, zHi, 1.8);
    k.tube('cAqua', [new THREE.Vector3(bbx - 0.3, FIBER.y + 0.14, zLo), new THREE.Vector3(bbx - 0.3, FIBER.y + 0.14, zHi)], 0.12, 0.2);
    k.tube('cSmf', [new THREE.Vector3(bbx + 0.35, FIBER.y + 0.14, zLo), new THREE.Vector3(bbx + 0.35, FIBER.y + 0.14, zHi)], 0.1, 0.2);
    for (let z = zLo + 3; z < zHi; z += RACK_PITCH * 2) trapezeZ(k, bbx, z, 1.4, [BASKET.y, FIBER.y]);

    // fire-stopped penetration where the main row's trays go through the workroom wall
    k.box('sleeve', [roomX0, (BASKET.y + FIBER.y + 0.8) / 2, (Math.min(bMain[0], fMain[0]) + Math.max(bMain[1], fMain[1])) / 2], [0.9, FIBER.y - BASKET.y + 1.6, Math.max(bMain[1], fMain[1]) - Math.min(bMain[0], fMain[0]) + 0.6]);
    k.box('firestop', [roomX0 - 0.46, (BASKET.y + FIBER.y + 0.8) / 2, (Math.min(bMain[0], fMain[0]) + Math.max(bMain[1], fMain[1])) / 2], [0.02, FIBER.y - BASKET.y + 1.3, Math.max(bMain[1], fMain[1]) - Math.min(bMain[0], fMain[0]) + 0.3]);

    return k.merged();
  }, [origin, minP, maxP, realKey, roomX0, oppositeZ, lowDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => parts.forEach((p) => p.geo.dispose()), [parts]);

  return (
    <group>
      {parts.map((p) => (
        <mesh key={p.key} geometry={p.geo} material={p.key === 'basket' ? basket() : MATS[p.key]} raycast={() => null} />
      ))}
    </group>
  );
}

export const Overhead = memo(OverheadInner);
