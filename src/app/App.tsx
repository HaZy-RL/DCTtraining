import { lazy, Suspense, useEffect } from 'react';
import { MODULES } from '../content';
import { useStore, type Screen } from './store';
import { MainMenu } from './screens/MainMenu';
import { ModuleScreen } from './screens/ModuleScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { CodexScreen } from './screens/CodexScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ReviewScreen } from './screens/ReviewScreen';

const PlayScreen = lazy(() => import('./play/PlayScreen'));

function parseHash(): Screen {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'module' && MODULES.some((m) => m.id === b)) return { name: 'module', module: b };
  if (a === 'progress' || a === 'codex' || a === 'settings') return { name: a };
  return { name: 'menu' };
}

export function App() {
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    document.body.dataset.theme = screen.name === 'play' ? 'dark' : 'bright';
  }, [screen.name]);
  useEffect(() => {
    if (useStore.getState().screen.name === 'menu') useStore.setState({ screen: parseHash() });
    const onHash = () => {
      const cur = useStore.getState().screen.name;
      if (cur === 'play' || cur === 'review') return;
      useStore.setState({ screen: parseHash() });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  switch (screen.name) {
    case 'play':
      return (
        <Suspense fallback={<div className="page muted">Loading the data hall…</div>}>
          <PlayScreen />
        </Suspense>
      );
    case 'review':
      return <ReviewScreen />;
    case 'module':
      return <ModuleScreen moduleId={screen.module} />;
    case 'progress':
      return <ProgressScreen />;
    case 'codex':
      return <CodexScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <MainMenu />;
  }
}

export function TopNav() {
  const go = useStore((s) => s.go);
  return (
    <nav className="topnav">
      <div className="brand" onClick={() => go({ name: 'menu' })}>
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        DCT Training
      </div>
      <div className="spacer" />
      <button className="btn ghost" onClick={() => go({ name: 'progress' })}>
        Progress
      </button>
      <button className="btn ghost" onClick={() => go({ name: 'codex' })}>
        Codex
      </button>
      <button className="btn ghost" onClick={() => go({ name: 'settings' })}>
        Settings
      </button>
    </nav>
  );
}
