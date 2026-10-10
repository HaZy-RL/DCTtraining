import { lazy, Suspense } from 'react';
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
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);
  const inst = useStore((s) => s.inst!);
  const w = useStore((s) => s.world!);
  const sel = useStore((s) => s.sel);
  const dispatch = useStore((s) => s.dispatch);
  const rackId = sel.rackId ?? inst.focusRackId;
  return (
    <div className="overlay scene-ctrl">
      <button className={`btn sm ${view === 'front' ? 'on' : ''}`} onClick={() => setView('front')}>
        Front (cold aisle)
      </button>
      <button className={`btn sm ${view === 'rear' ? 'on' : ''}`} onClick={() => setView('rear')}>
        Rear (hot aisle)
      </button>
      <button className="btn sm" onClick={() => select({ rackId })}>
        ⟲ Rack view
      </button>
      {rackId && w.trainee.location !== rackId && (
        <button className="btn sm primary" onClick={() => dispatch({ type: 'walk', to: rackId })}>
          🚶 Walk here
        </button>
      )}
      {Object.values(w.racks).filter((r) => r.row === w.racks[rackId ?? '']?.row).length > 1 && (
        <select value={rackId} onChange={(e) => select({ rackId: e.target.value })} style={{ fontSize: 12 }}>
          {Object.values(w.racks)
            .filter((r) => r.row === w.racks[rackId ?? '']?.row)
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
          <Inspector buildMode={scene === 'rackbuild'} />
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
