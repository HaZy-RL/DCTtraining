// Fault injection: puts a device into a failure state, with consistent history in every lens.
import { MODELS } from './catalog';
import { addSel } from './sim';
import type { Device, FailureMode, World } from './types';
import type { Rng } from './rng';

export interface FaultInfo {
  mode: FailureMode | 'loose_cord' | 'bmc_hung' | 'pxe_boot' | 'dirty_fiber' | 'bad_cable' | 'wrong_port' | 'port_admin_down' | 'breaker_tripped';
  deviceId: string;
  slot?: string;
  /** Human description for the after-action review. */
  rootCause: string;
}

const H = 3600;

/** Kinds of slot each failure mode targets. */
export const MODE_KIND: Partial<Record<FailureMode, string>> = {
  dimm_ce_storm: 'dimm',
  dimm_uce: 'dimm',
  hdd_failed: 'hdd',
  hdd_predictive: 'hdd',
  nvme_missing: 'nvme',
  nvme_media_errors: 'nvme',
  psu_failed: 'psu',
  fan_failed: 'fan',
  cpu_ierr: 'cpu',
  cmos_low: 'cmos',
  m2_failed: 'm2',
  nic_hw_fault: 'nic',
  gpu_fell_off_bus: 'gpu',
  gpu_thermal: 'gpu',
};

export function pickSlot(rng: Rng, dev: Device, kind: string): string {
  const slots = MODELS[dev.model].slots.filter((s) => s.kind === kind && dev.slots[s.id]);
  return rng.pick(slots).id;
}

export function injectFault(w: World, rng: Rng, dev: Device, mode: FailureMode, slotIn?: string): FaultInfo {
  const kind = MODE_KIND[mode]!;
  const slot = slotIn ?? pickSlot(rng, dev, kind);
  const c = dev.slots[slot]!;
  c.failure = mode;
  const ago = (hours: number) => -Math.round(hours * H);
  let rootCause = '';
  switch (mode) {
    case 'dimm_ce_storm':
      c.health = 'degraded';
      addSel(w, dev, `Memory ${slot}`, 'Correctable ECC | Asserted', 'warning', 'Asserted', ago(30));
      addSel(w, dev, `Memory ${slot}`, 'Correctable ECC logging limit reached', 'warning', 'Asserted', ago(6));
      rootCause = `DIMM ${slot} is throwing a storm of correctable ECC errors (predictive failure).`;
      break;
    case 'dimm_uce':
      c.health = 'failed';
      addSel(w, dev, `Memory ${slot}`, 'Correctable ECC | Asserted', 'warning', 'Asserted', ago(50));
      addSel(w, dev, `Memory ${slot}`, 'Uncorrectable ECC | Asserted', 'critical', 'Asserted', ago(20));
      addSel(w, dev, 'OS Critical Stop', 'Run-time critical stop (kernel panic)', 'critical', 'Asserted', ago(20));
      addSel(w, dev, 'System Event', 'System restart (watchdog)', 'info', 'Asserted', ago(19.9));
      addSel(w, dev, `Memory ${slot}`, 'Uncorrectable ECC | Asserted', 'critical', 'Asserted', ago(4));
      addSel(w, dev, 'OS Critical Stop', 'Run-time critical stop (kernel panic)', 'critical', 'Asserted', ago(4));
      addSel(w, dev, `Memory ${slot}`, 'Memory device disabled by BIOS', 'critical', 'Asserted', ago(3.9));
      rootCause = `DIMM ${slot} has uncorrectable ECC errors; the host panicked and BIOS mapped the DIMM out.`;
      break;
    case 'hdd_failed':
      c.health = 'failed';
      c.smart = { ...c.smart!, reallocated: 3816, pending: 512, uncorrectable: 744 };
      addSel(w, dev, `Drive Slot ${slot}`, 'Predictive Failure | Asserted', 'warning', 'Asserted', ago(70));
      addSel(w, dev, `Drive Slot ${slot}`, 'Drive Fault | Asserted', 'critical', 'Asserted', ago(5));
      rootCause = `HDD in ${slot} (S/N ${c.serial}) failed: unrecoverable read errors and thousands of reallocated sectors.`;
      break;
    case 'hdd_predictive':
      c.health = 'degraded';
      c.smart = { ...c.smart!, reallocated: 1208, pending: 88, uncorrectable: 3 };
      addSel(w, dev, `Drive Slot ${slot}`, 'Predictive Failure | Asserted', 'warning', 'Asserted', ago(12));
      rootCause = `HDD in ${slot} (S/N ${c.serial}) is in SMART predictive failure (reallocated sectors climbing).`;
      break;
    case 'nvme_missing':
      c.health = 'failed';
      addSel(w, dev, `Drive Slot ${slot}`, 'Drive Fault | Asserted', 'critical', 'Asserted', ago(8));
      rootCause = `NVMe in ${slot} (S/N ${c.serial}) dropped off the PCIe bus and no longer enumerates.`;
      break;
    case 'nvme_media_errors':
      c.health = 'degraded';
      c.smart = { ...c.smart!, uncorrectable: 431, wearPct: 104 };
      addSel(w, dev, `Drive Slot ${slot}`, 'Predictive Failure | Asserted', 'warning', 'Asserted', ago(9));
      rootCause = `NVMe in ${slot} is worn out (104% endurance used) with media errors.`;
      break;
    case 'psu_failed':
      c.health = 'failed';
      addSel(w, dev, `Power Supply ${slot}`, 'Failure detected | Asserted', 'critical', 'Asserted', ago(2));
      addSel(w, dev, 'Power Unit', 'Redundancy Lost | Asserted', 'critical', 'Asserted', ago(2));
      rootCause = `${slot} failed internally (input OK, no output).`;
      break;
    case 'fan_failed':
      c.health = 'failed';
      addSel(w, dev, `Fan ${slot}`, 'Lower Critical going low | Asserted', 'critical', 'Asserted', ago(3));
      addSel(w, dev, 'Fan Redundancy', 'Redundancy Lost | Asserted', 'warning', 'Asserted', ago(3));
      rootCause = `Fan module ${slot} seized (0 RPM).`;
      break;
    case 'cpu_ierr':
      c.health = 'failed';
      addSel(w, dev, `Processor ${slot}`, 'IERR | Asserted', 'critical', 'Asserted', ago(26));
      addSel(w, dev, 'System Event', 'System restart (watchdog)', 'info', 'Asserted', ago(25.9));
      addSel(w, dev, `Processor ${slot}`, 'IERR | Asserted', 'critical', 'Asserted', ago(7));
      addSel(w, dev, `Processor ${slot}`, 'Machine Check Exception (bank 4 — uncorrected)', 'critical', 'Asserted', ago(7));
      rootCause = `${slot} is throwing internal errors (IERR / uncorrected MCE). Replace the CPU after ruling out the board.`;
      break;
    case 'cmos_low':
      c.health = 'degraded';
      addSel(w, dev, 'Battery CMOS', 'Lower Critical going low | Asserted', 'warning', 'Asserted', ago(40));
      rootCause = 'CMOS battery below 2.4 V. BIOS clock drifts and settings are at risk.';
      break;
    case 'm2_failed':
      c.health = 'failed';
      addSel(w, dev, `Drive ${slot}`, 'Drive Fault | Asserted', 'critical', 'Asserted', ago(11));
      rootCause = `M.2 boot drive ${slot} failed. The md RAID1 mirror is running degraded on the other disk.`;
      break;
    case 'nic_hw_fault':
      c.health = 'failed';
      addSel(w, dev, 'OCP NIC', 'Device Fault | Asserted', 'critical', 'Asserted', ago(1));
      rootCause = 'The OCP NIC firmware hit a fatal error. Both links are down, so the host is unreachable in-band.';
      break;
    case 'gpu_fell_off_bus':
      c.health = 'failed';
      addSel(w, dev, 'PCIe Slot 1', 'Bus Fatal Error | Asserted', 'critical', 'Asserted', ago(5));
      rootCause = 'The GPU in Riser 1 fell off the PCIe bus (Xid 79).';
      break;
    case 'gpu_thermal':
      c.health = 'degraded';
      addSel(w, dev, 'PCIe Slot 1 Temp', 'Upper Critical going high', 'warning', 'Asserted', ago(5));
      rootCause = 'The GPU is thermally throttling at 95 °C.';
      break;
    default:
      break;
  }
  return { mode, deviceId: dev.id, slot, rootCause };
}

export function injectLooseCord(w: World, dev: Device, psu: 'PSU1' | 'PSU2'): FaultInfo {
  dev.quirks.push(`loose_cord:${psu}`);
  addSel(w, dev, `Power Supply ${psu}`, 'Power Supply AC lost | Asserted', 'critical', 'Asserted', -2 * H);
  addSel(w, dev, 'Power Unit', 'Redundancy Lost | Asserted', 'critical', 'Asserted', -2 * H);
  return { mode: 'loose_cord', deviceId: dev.id, slot: psu, rootCause: `The ${psu} power cord was partially unseated (retention clip not engaged). The PSU itself was healthy.` };
}

export function injectBmcHung(w: World, dev: Device): FaultInfo {
  dev.quirks.push('bmc_hung');
  dev.bmc.responsive = false;
  void w;
  return { mode: 'bmc_hung', deviceId: dev.id, rootCause: 'The BMC firmware was hung. The host OS was fine; an in-band `ipmitool mc reset cold` recovers it without touching the host.' };
}

export function injectPxeBoot(w: World, dev: Device): FaultInfo {
  dev.bootOrder = ['PXE: OCP0 Port 0', 'NVMe: M.2 Boot 0', 'NVMe: M.2 Boot 1', 'UEFI Shell'];
  dev.power = 'on';
  dev.os = 'pxe_loop';
  addSel(w, dev, 'BIOS', 'CMOS checksum error — defaults loaded', 'warning', 'Asserted', -1 * H);
  addSel(w, dev, 'OS Boot', 'PXE boot — no boot filename received', 'warning', 'Asserted', -0.9 * H);
  return { mode: 'pxe_boot', deviceId: dev.id, rootCause: 'After a CMOS reset the BIOS loaded defaults with PXE first in the boot order, so the host loops on PXE instead of booting from M.2.' };
}
