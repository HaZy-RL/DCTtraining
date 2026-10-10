// The DCO workroom laptop: every web tool a DCT uses, in one "browser" with tabs.
import { useState } from 'react';
import { useStore } from '../store';
import { AssetsTool } from '../tools/AssetsTool';
import { BmcTool } from '../tools/BmcTool';
import { CutsheetTool } from '../tools/CutsheetTool';
import { FindingsTool } from '../tools/FindingsTool';
import { NotesTool } from '../tools/NotesTool';
import { PartsTool } from '../tools/PartsTool';
import { PduTool } from '../tools/PduTool';
import { TicketTool } from '../tools/TicketTool';

const TABS: Record<string, { ic: string; name: string; url: string }> = {
  ticket: { ic: '🎫', name: 'Jira · DCO queue', url: 'https://jira.dco.internal/projects/DCO/queues' },
  bmc: { ic: '📡', name: 'BMC console', url: 'https://bmc.oob.dco.internal/' },
  assets: { ic: '🗃️', name: 'CMDB', url: 'https://cmdb.dco.internal/assets' },
  parts: { ic: '📦', name: 'Inventory & RMA', url: 'https://inventory.dco.internal/spares' },
  pdu: { ic: '🔌', name: 'PDU manager', url: 'https://pdu.mgmt.dco.internal/' },
  cutsheet: { ic: '📋', name: 'Cut sheets', url: 'https://wiki.dco.internal/builds/cutsheet' },
  findings: { ic: '🔎', name: 'Findings form', url: 'https://forms.dco.internal/findings' },
  notes: { ic: '📝', name: 'Notepad', url: 'notepad://scratch' },
};

export function Laptop() {
  const open = useStore((s) => s.laptopOpen);
  const setLaptop = useStore((s) => s.setLaptop);
  const inst = useStore((s) => s.inst);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const clock = useStore((s) => s.world?.t ?? 0);
  const tools: string[] = (inst?.tools ?? []).filter((t) => t !== 'terminal' && TABS[t]);
  if (inst?.bench?.findings?.length) tools.push('findings');
  const [tab, setTab] = useState<string>(tools[0] ?? 'ticket');
  if (!open || !inst) return null;
  const cur = tools.includes(tab) ? tab : tools[0];
  const hh = Math.floor((14 * 3600 + clock) / 3600) % 24;
  const mm = Math.floor(((14 * 3600 + clock) % 3600) / 60);
  return (
    <div className="modal-back" onClick={() => setLaptop(false)}>
      <div className="laptop" onClick={(e) => e.stopPropagation()}>
        <div className="laptop-screen">
          <div className="lp-tabs">
            {tools.map((t) => (
              <button key={t} className={`lp-tab ${t === cur ? 'on' : ''}`} onClick={() => setTab(t)}>
                {TABS[t].ic} {TABS[t].name}
              </button>
            ))}
            {inst.tools.includes('terminal') && (
              <button
                className="lp-tab"
                onClick={() => {
                  toggleTerminal(true);
                  setLaptop(false);
                }}
              >
                ⌨️ Terminal ↗
              </button>
            )}
            <div className="spacer" />
            <span className="lp-clock">
              {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}
            </span>
            <button className="lp-close" onClick={() => setLaptop(false)} title="Close the laptop (Esc)">
              ✕
            </button>
          </div>
          <div className="lp-url">
            <span className="lp-lock">🔒</span> {cur ? TABS[cur].url : ''}
          </div>
          <div className="lp-body">
            {cur === 'ticket' && <TicketTool />}
            {cur === 'bmc' && <BmcTool />}
            {cur === 'assets' && <AssetsTool />}
            {cur === 'parts' && <PartsTool />}
            {cur === 'pdu' && <PduTool />}
            {cur === 'cutsheet' && <CutsheetTool />}
            {cur === 'findings' && <FindingsTool />}
            {cur === 'notes' && <NotesTool />}
          </div>
        </div>
        <div className="laptop-base">
          <span>DCO-LT-0420 · company laptop · do not leave unlocked</span>
        </div>
      </div>
    </div>
  );
}
