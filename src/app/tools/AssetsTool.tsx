import { useMemo, useState } from 'react';
import { MODELS } from '../../engine/catalog';
import { locationOf } from '../../engine/projectors';
import { hostIp } from '../../engine/shells/net';
import { useStore } from '../store';

export function AssetsTool() {
  const w = useStore((s) => s.world!);
  const dispatch = useStore((s) => s.dispatch);
  const select = useStore((s) => s.select);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return Object.values(w.devices).filter((d) => [d.hostname, d.serial, d.assetTag, d.bmc.ip, hostIp(w, d), locationOf(w, d)].some((x) => x.toLowerCase().includes(s)));
  }, [q, w]);
  return (
    <div className="col">
      <input autoFocus placeholder="Search hostname, serial, asset tag, IP or location…" value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!w.flags['used_cmdb']) dispatch({ type: 'setFlag', name: 'used_cmdb' });
        }}
      />
      <p className="dim" style={{ fontSize: 12, margin: 0 }}>
        The CMDB is only as accurate as the last person who updated it. Always scan the physical asset tag.
      </p>
      {rows.length > 0 && (
        <table className="t">
          <thead>
            <tr>
              <th>Hostname</th>
              <th>Asset</th>
              <th>Serial</th>
              <th>Model</th>
              <th>Location</th>
              <th>BMC</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((d) => {
              const stale = d.quirks.find((x) => x.startsWith('cmdb_stale:'))?.slice(11);
              const loc = stale ?? locationOf(w, d);
              return (
                <tr key={d.id}>
                  <td className="mono">{d.hostname}</td>
                  <td className="mono">{d.assetTag}</td>
                  <td className="mono">{d.serial}</td>
                  <td>{MODELS[d.model].id.toUpperCase()}</td>
                  <td className="mono">{loc}</td>
                  <td className="mono">{d.role === 'server' ? d.bmc.ip : '—'}</td>
                  <td>
                    {d.rackId && (
                      <button
                        className="btn sm"
                        onClick={() => {
                          const target = stale ? Object.values(w.racks).find((r) => stale.startsWith(r.location))?.id ?? d.rackId! : d.rackId!;
                          dispatch({ type: 'walk', to: target });
                          select({ rackId: target });
                        }}
                      >
                        Walk there
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
