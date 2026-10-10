import { useState } from 'react';
import { TopNav } from '../App';
import { exportProgress } from '../progress';
import { useStore } from '../store';

export function SettingsScreen() {
  const { progress, updateSettings, resetProgress } = useStore();
  const s = progress.settings;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <TopNav />
      <div className="page" style={{ maxWidth: 720 }}>
        <h1>Settings</h1>
        <div className="card col">
          <label className="row">
            <input type="checkbox" checked={s.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} /> Sound effects
          </label>
          <label className="row">
            <input type="checkbox" checked={s.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} /> Reduce motion (no camera fly-to, slower LED blink)
          </label>
          <label className="row">
            3D quality
            <select value={s.quality} onChange={(e) => updateSettings({ quality: e.target.value as 'high' | 'low' })}>
              <option value="high">High (shadows, more detail)</option>
              <option value="low">Low (faster on laptops/tablets)</option>
            </select>
          </label>
          <label className="row">
            Simulation speed
            <select value={s.speed} onChange={(e) => updateSettings({ speed: Number(e.target.value) })}>
              <option value={1}>1× real time</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
              <option value={8}>8×</option>
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Waits like POST and drains are short anyway, and you can always press ⏩ Wait.
            </span>
          </label>
        </div>
        <div className="card col" style={{ marginTop: 14 }}>
          <b>Your data</b>
          <span className="muted" style={{ fontSize: 13 }}>
            Progress is stored only in this browser (localStorage). Clearing site data erases it.
          </span>
          <div className="row wrap">
            <button
              className="btn"
              onClick={() => {
                const blob = new Blob([exportProgress(progress)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'dct-training-progress.json';
                a.click();
              }}
            >
              Export progress (JSON)
            </button>
            {!confirm ? (
              <button className="btn danger" onClick={() => setConfirm(true)}>
                Reset all progress…
              </button>
            ) : (
              <>
                <span className="pill-bad">Really erase everything?</span>
                <button
                  className="btn danger"
                  onClick={() => {
                    resetProgress();
                    setConfirm(false);
                  }}
                >
                  Yes, erase
                </button>
                <button className="btn" onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
