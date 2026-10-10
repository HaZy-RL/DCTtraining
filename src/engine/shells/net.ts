// Name resolution and reachability for the simulated management + production networks.
import { hasAC, linkState } from '../projectors';
import type { Device, World } from '../types';

export function hostIp(w: World, dev: Device): string {
  if (!dev.rackId) return '10.20.0.0';
  const r = w.racks[dev.rackId];
  return `10.20.${r.position + (r.row.charCodeAt(0) - 64) * 20}.${(dev.u ?? 0) + 10}`;
}

export type Resolved = { dev: Device; plane: 'prod' | 'bmc'; ip: string };

export function resolve(w: World, name: string): Resolved | undefined {
  const n = name.replace(/^.*@/, '').toLowerCase();
  for (const d of Object.values(w.devices)) {
    const h = d.hostname.toLowerCase();
    if (n === h || n === `${h}.${w.site.toLowerCase()}.dc` || n === hostIp(w, d)) return { dev: d, plane: 'prod', ip: hostIp(w, d) };
    if (n === `${h}-bmc` || n === `${h}-bmc.${w.site.toLowerCase()}.dc` || n === d.bmc.ip) return { dev: d, plane: 'bmc', ip: d.bmc.ip };
  }
  return undefined;
}

export function bmcReachable(w: World, dev: Device): boolean {
  if (dev.role !== 'server') return hasAC(w, dev);
  return hasAC(w, dev) && dev.bmc.responsive && linkState(w, dev.id, 'bmc').up;
}

export function prodReachable(w: World, dev: Device): boolean {
  if (dev.role !== 'server') return hasAC(w, dev);
  if (dev.power !== 'on' || (dev.os !== 'up' && dev.os !== 'readonly_fs')) return false;
  return ['nic0p0', 'nic0p1'].some((p) => linkState(w, dev.id, p).up);
}

export function pingOut(target: string, ip: string, ok: boolean): string {
  if (!ok)
    return `PING ${target} (${ip}) 56(84) bytes of data.\nFrom 10.250.0.1 icmp_seq=1 Destination Host Unreachable\nFrom 10.250.0.1 icmp_seq=2 Destination Host Unreachable\nFrom 10.250.0.1 icmp_seq=3 Destination Host Unreachable\n\n--- ${target} ping statistics ---\n4 packets transmitted, 0 received, +3 errors, 100% packet loss, time 3062ms`;
  const t = () => (0.18 + Math.random() * 0.2).toFixed(3);
  return `PING ${target} (${ip}) 56(84) bytes of data.\n64 bytes from ${ip}: icmp_seq=1 ttl=62 time=${t()} ms\n64 bytes from ${ip}: icmp_seq=2 ttl=62 time=${t()} ms\n64 bytes from ${ip}: icmp_seq=3 ttl=62 time=${t()} ms\n64 bytes from ${ip}: icmp_seq=4 ttl=62 time=${t()} ms\n\n--- ${target} ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss, time 3004ms`;
}
