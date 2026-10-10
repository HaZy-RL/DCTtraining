import { useStore } from '../store';
import { AssetsTool } from '../tools/AssetsTool';
import { BmcTool } from '../tools/BmcTool';
import { CutsheetTool } from '../tools/CutsheetTool';
import { FindingsTool } from '../tools/FindingsTool';
import { NotesTool } from '../tools/NotesTool';
import { PartsTool } from '../tools/PartsTool';
import { PduTool } from '../tools/PduTool';
import { TicketTool } from '../tools/TicketTool';

const TITLES: Record<string, string> = {
  ticket: '🎫 Tickets',
  bmc: '📡 BMC web console',
  assets: '🗃️ CMDB / asset lookup',
  parts: '📦 Parts cart & tray',
  notes: '📝 Notes',
  cutsheet: '📋 Cut sheet / build sheet',
  pdu: '🔌 Rack PDUs',
  findings: '🔎 Findings',
};

export function SidePanel() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  if (!panel) return null;
  const wide = panel === 'ticket' || panel === 'bmc';
  return (
    <aside className={`side ${wide ? 'wide' : ''}`}>
      <div className="side-head">
        <h3 className="grow">{TITLES[panel] ?? panel}</h3>
        <button className="btn ghost sm" onClick={() => setPanel(null)}>
          ✕
        </button>
      </div>
      <div className="side-body">
        {panel === 'ticket' && <TicketTool />}
        {panel === 'bmc' && <BmcTool />}
        {panel === 'assets' && <AssetsTool />}
        {panel === 'parts' && <PartsTool />}
        {panel === 'notes' && <NotesTool />}
        {panel === 'cutsheet' && <CutsheetTool />}
        {panel === 'pdu' && <PduTool />}
        {panel === 'findings' && <FindingsTool />}
      </div>
    </aside>
  );
}
