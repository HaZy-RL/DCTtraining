import { cutsheetDone } from '../../content/cabling';
import { useStore } from '../store';

export function CutsheetTool() {
  const inst = useStore((s) => s.inst!);
  const w = useStore((s) => s.world!);
  const rows = inst.bench?.cutsheet ?? [];
  const build = inst.bench?.build ?? [];
  const host = (id: string) => w.devices[id]?.hostname ?? id;
  return (
    <div className="col" style={{ gap: 14 }}>
      {build.length > 0 && (
        <div>
          <b>Build sheet (rack elevation)</b>
          <table className="t" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>U</th>
                <th>Device</th>
                <th>Weight</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...build]
                .sort((a, b) => b.u - a.u)
                .map((r) => {
                  const d = w.devices[r.deviceId];
                  const ok = d.rackId && d.u === r.u;
                  return (
                    <tr key={r.deviceId}>
                      <td className="mono">
                        U{String(r.u).padStart(2, '0')}–U{String(r.u + d.heightU - 1).padStart(2, '0')}
                      </td>
                      <td className="mono">{d.hostname}</td>
                      <td>{d.weightKg} kg</td>
                      <td className={ok ? 'pill-ok' : 'dim'}>{ok ? '✓ mounted' : 'staged'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <div>
          <b>Cut sheet</b>
          <table className="t" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Cable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ok = cutsheetDone(w, r);
                return (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {host(r.a.deviceId)}
                      <br />
                      <b>{r.a.port}</b>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {host(r.b.deviceId)}
                      <br />
                      <b>{r.b.port}</b>
                    </td>
                    <td>
                      {r.cableType.toUpperCase()} {r.lengthM} m
                      <div className="dim mono" style={{ fontSize: 10.5 }}>
                        {r.aLabel}
                      </div>
                    </td>
                    <td className={ok ? 'pill-ok' : 'dim'}>{ok ? '✓' : '○'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="card" style={{ fontSize: 13 }}>
        <b>Rack cabling standard</b>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Server #N (counting from the bottom server): P0 (eth0) → ToR swpN, P1 (eth1) → ToR swp(N+24), both 25G DAC</li>
          <li>BMC port → OOB switch mgmtN, Cat6</li>
          <li>PSU1 → PDU-A, PSU2 → PDU-B</li>
          <li>Labels on both ends: &lt;rack&gt;-U&lt;nn&gt;-&lt;port&gt; &gt; &lt;far end&gt;</li>
        </ul>
        <p className="dim" style={{ fontSize: 12, marginBottom: 0 }}>
          How to cable: switch the 3D view to <b>Rear</b>, click a port (it highlights), click the far-end port, then pick the cable type and length.
        </p>
      </div>
    </div>
  );
}
