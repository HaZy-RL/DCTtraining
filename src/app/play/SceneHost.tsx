import { lazy, Suspense, useEffect } from 'react';
import { useWalker } from '../scenes/three/walker';
import { useCoachTarget } from './guide';
import { useStore } from '../store';
import { DeskScene } from '../scenes/DeskScene';
import { QuizScene } from '../scenes/QuizScene';
import { TriageScene } from '../scenes/TriageScene';
import { Inspector } from './Inspector';

const RackScene = lazy(() => import('../scenes/RackScene').then((m) => ({ default: m.RackScene })));
const FloorScene = lazy(() => import('../scenes/FloorScene'));
const HazardScene = lazy(() => import('../scenes/HazardScene'));
const Rj45Bench = lazy(() => import('../scenes/Rj45Bench'));
const FiberBench = lazy(() => import('../scenes/FiberBench'));

function SceneControls() {
  const view = useStore((s) => s.view);
  const goAisle = useStore((s) => s.goAisle);
  const select = useStore((s) => s.select);
  const inst = useStore((s) => s.inst!);
  const racks = useStore((s) => s.world!.racks);
  const location = useStore((s) => s.world!.trainee.location);
  const sel = useStore((s) => s.sel);
  const camMode = useStore((s) => s.camMode);
  const setCamMode = useStore((s) => s.setCamMode);
  const dispatch = useStore((s) => s.dispatch);
  const rackId = sel.rackId ?? inst.focusRackId;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = useStore.getState();
      if (e.key === 'Escape' && st.laptopOpen) return st.setLaptop(false);
      if (st.laptopOpen) return;
      if (e.key === 'v' || e.key === 'V') st.setCamMode(st.camMode === 'walk' ? 'inspect' : 'walk');
      else if (e.key === 'Escape' && st.scanner) st.setScanner(false);
      else if (e.key === 'Escape' && st.camMode === 'walk') st.setCamMode('inspect');
      else if ((e.key === 'f' || e.key === 'F') && st.sel.deviceId) st.setCamMode('inspect');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="overlay scene-ctrl">
      <button className={`btn sm ${camMode === 'walk' ? 'on primary' : ''}`} onClick={() => setCamMode(camMode === 'walk' ? 'inspect' : 'walk')} title="Toggle first-person walking (V)">
        {camMode === 'walk' ? '🔍 Inspect camera' : '🚶 Walk mode'}
      </button>
      <button className={`btn sm ${view === 'front' ? 'on' : ''}`} onClick={() => goAisle('front')} title="If you're at a rack, this walks you round to the cold aisle">
        ❄ Front (cold aisle)
      </button>
      <button className={`btn sm ${view === 'rear' ? 'on' : ''}`} onClick={() => goAisle('rear')} title="If you're at a rack, this walks you round to the hot aisle">
        🔥 Rear (hot aisle)
      </button>
      <button className="btn sm" onClick={() => select({ rackId })}>
        ⟲ Rack view
      </button>
      {rackId && location !== rackId && (
        <button className="btn sm primary" onClick={() => dispatch({ type: 'walk', to: rackId, side: view })}>
          🚶 Walk here
        </button>
      )}
      {Object.values(racks).filter((r) => r.row === racks[rackId ?? '']?.row).length > 1 && (
        <select value={rackId} onChange={(e) => select({ rackId: e.target.value })} style={{ fontSize: 12 }}>
          {Object.values(racks)
            .filter((r) => r.row === racks[rackId ?? '']?.row)
            .sort((a, b) => a.position - b.position)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.location}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

/** Hint banner while the barcode scanner is in hand. */
function ScannerHud() {
  const scanner = useStore((s) => s.scanner);
  const setScanner = useStore((s) => s.setScanner);
  if (!scanner) return null;
  return (
    <div className="overlay scanner-hud">
      📷 <b>Scanner ready.</b> Aim at the barcode sticker on the server's left rack ear (front, cold aisle) and click to scan.
      <button className="btn sm" onClick={() => setScanner(false)}>
        Put away (Esc)
      </button>
    </div>
  );
}

/** Crosshair, controls help and a top-down minimap while walking. */
function WalkHud() {
  const camMode = useStore((s) => s.camMode);
  const racks = useStore((s) => s.world!.racks);
  const location = useStore((s) => s.world!.trainee.location);
  const inst = useStore((s) => s.inst!);
  const sel = useStore((s) => s.sel);
  const wk = useWalker();
  const gt = useCoachTarget();
  if (camMode !== 'walk') return null;
  const focus = racks[sel.rackId ?? inst.focusRackId ?? ''] ?? Object.values(racks)[0];
  const origin = racks[inst.focusRackId ?? focus.id]?.position ?? focus.position;
  const row = Object.values(racks).filter((r) => r.row === focus.row);
  const target = gt?.rackId ?? focus.id;
  // map: x in scene units → px; z likewise
  const S = 2.2;
  const cx = 110;
  const cz = 60;
  const px = (x: number) => cx + (x - wk.x) * S * 0.5;
  const pz = (z: number) => cz - z * S * 0.5;
  return (
    <>
      <div className="crosshair" />
      <div className="overlay walk-help">
        <b>WASD</b> walk · <b>drag</b> look · <b>Shift</b> run · <b>click</b> to use · <b>V</b> inspect
      </div>
      <svg className="overlay minimap" width={220} height={120} viewBox="0 0 220 120">
        <rect x={0} y={0} width={220} height={120} rx={10} fill="rgba(13,19,27,0.82)" />
        <rect x={0} y={20} width={220} height={cz - 26} fill="#2f7de1" opacity={0.18} />
        <rect x={0} y={cz + 6} width={220} height={cz - 26} fill="#e1442f" opacity={0.18} />
        {row.map((r) => {
          const x = (r.position - origin) * 6.15;
          const isT = r.id === target;
          const here = r.id === location;
          return <rect key={r.id} x={px(x) - 6.6} y={cz - 5.9} width={13.2} height={11.8} fill={isT ? '#ffd166' : here ? '#2bb3a3' : '#4a5563'} stroke="#0b0f14" strokeWidth={1} />;
        })}
        <text x={8} y={16} fill="#9fd3ff" fontSize={10}>
          ❄ cold aisle (front)
        </text>
        <text x={8} y={112} fill="#ffb3a6" fontSize={10}>
          🔥 hot aisle (rear)
        </text>
        <g transform={`translate(${cx} ${pz(wk.z)}) rotate(${180 + (wk.yaw * 180) / Math.PI})`}>
          <polygon points="0,-7 5,5 0,2 -5,5" fill="#2bff6a" />
        </g>
      </svg>
    </>
  );
}

/** The inspector for the 3D rack scenes; PlayScreen stacks it under the objectives so the two never overlap. */
export function SceneInspector() {
  const scene = useStore((s) => s.inst!.scene);
  return scene === 'rack' || scene === 'rackbuild' ? <Inspector buildMode={scene === 'rackbuild'} /> : null;
}

const Loading = () => <div className="bench muted">Loading 3D…</div>;

export function SceneHost() {
  const scene = useStore((s) => s.inst!.scene);
  switch (scene) {
    case 'rack':
    case 'rackbuild':
      return (
        <>
          <Suspense fallback={<Loading />}>
            <RackScene buildMode={scene === 'rackbuild'} />
          </Suspense>
          <SceneControls />
          <WalkHud />
          <ScannerHud />
        </>
      );
    case 'floor':
      return (
        <Suspense fallback={<Loading />}>
          <FloorScene />
        </Suspense>
      );
    case 'hazard':
      return (
        <Suspense fallback={<Loading />}>
          <HazardScene />
        </Suspense>
      );
    case 'rj45':
      return (
        <Suspense fallback={<Loading />}>
          <Rj45Bench />
        </Suspense>
      );
    case 'fiber':
      return (
        <Suspense fallback={<Loading />}>
          <FiberBench />
        </Suspense>
      );
    case 'quiz':
      return <QuizScene />;
    case 'triage':
      return <TriageScene />;
    default:
      return <DeskScene />;
  }
}
