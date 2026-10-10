import { useStore } from '../store';

export function DeskScene() {
  const inst = useStore((s) => s.inst!);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <div className="bench" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at 50% 40%, #142030, #0a0e13 70%)' }}>
      <div style={{ textAlign: 'center', maxWidth: 520 }}>
        <div style={{ fontSize: 64 }}>🖥️☕</div>
        <h2>DCO desk</h2>
        <p className="muted">This one is remote work: everything goes through the jump host, the BMC and the ticket system. No need to walk the floor.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {inst.tools.includes('terminal') && (
            <button className="btn primary" onClick={() => toggleTerminal(true)}>
              ⌨️ Open terminal
            </button>
          )}
          <button className="btn" onClick={() => setPanel('ticket')}>
            🎫 Tickets
          </button>
          {inst.bench?.findings && (
            <button className="btn" onClick={() => setPanel('findings')}>
              🔎 Findings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
