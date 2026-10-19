// Renders the sim's IPMI-style SEL entries the way each vendor's management log shows them:
// Dell Lifecycle Log message IDs, HPE IML entries, Lenovo XCC FQXSP events, Supermicro health events.
// IDs and wording follow each vendor's style closely; they are illustrative, not copied from a registry.
import { MODELS, slotLabel } from './catalog';
import type { Device, SelEntry } from './types';
import type { VendorId } from './vendors';

export interface VendorEvent {
  /** Message ID / event code where the vendor uses one. */
  code?: string;
  text: string;
  category: string;
}

type Key =
  | 'mem_ce' | 'mem_ce_limit' | 'mem_uce' | 'mem_disabled' | 'mem_training' | 'mem_config' | 'mem_none'
  | 'drive_predictive' | 'drive_fault' | 'drive_present'
  | 'psu_fail' | 'psu_ac_lost' | 'psu_ac_restored' | 'psu_present' | 'psu_mismatch' | 'psu_red_lost' | 'psu_red_ok' | 'ac_restored'
  | 'fan_low' | 'fan_present' | 'fan_red_lost' | 'fan_red_ok' | 'fan_mismatch'
  | 'cpu_ierr' | 'cpu_mce' | 'cpu_thermal' | 'cpu_mismatch' | 'cpu_absent' | 'cpu_temp'
  | 'pcie_fatal' | 'pcie_temp' | 'nic_fault' | 'cmos_low' | 'cmos_checksum'
  | 'os_stop' | 'watchdog' | 'power_on' | 'power_off' | 'intrusion' | 'pxe_fail' | 'no_boot' | 'log_cleared' | 'bmc_reset' | 'present';

interface Parsed {
  key: Key | null;
  slot?: string;
  label: string;
  extra?: string;
}

const SLOT_SENSOR = /^(Memory|Drive Slot|Drive|Power Supply|Fan|Processor) (\S+)$/;

function parse(modelId: string, e: SelEntry): Parsed {
  const m = SLOT_SENSOR.exec(e.sensor);
  const slot = m?.[2];
  const label = slot ? slotLabel(modelId, slot) : e.sensor;
  const ev = e.event;
  const k = (key: Key, extra?: string): Parsed => ({ key, slot, label, extra });
  if (e.sensor.startsWith('Memory')) {
    if (/Correctable ECC logging limit/.test(ev)) return k('mem_ce_limit');
    if (/^Correctable ECC/.test(ev)) return k('mem_ce');
    if (/Uncorrectable ECC — DIMM disabled/.test(ev)) return k('mem_disabled');
    if (/Uncorrectable/.test(ev)) return k('mem_uce');
    if (/disabled by BIOS/.test(ev)) return k('mem_disabled');
    if (/training/.test(ev)) return k('mem_training');
    if (/configuration mismatch/.test(ev)) return k('mem_config');
    if (/No usable memory/.test(ev)) return k('mem_none');
  }
  if (e.sensor.startsWith('Drive')) {
    if (/Predictive/.test(ev)) return k('drive_predictive');
    if (/Fault/.test(ev)) return k('drive_fault');
    if (/Present/.test(ev)) return k('drive_present');
  }
  if (e.sensor.startsWith('Power Supply')) {
    if (/Failure detected/.test(ev)) return k('psu_fail');
    if (/AC lost/.test(ev)) return k('psu_ac_lost');
    if (/AC input restored/.test(ev)) return k('psu_ac_restored');
    if (/Presence/.test(ev)) return k('psu_present');
    if (/mismatch/.test(ev)) return k('psu_mismatch');
  }
  if (e.sensor === 'Power Unit') {
    if (/Redundancy Lost/.test(ev)) return k('psu_red_lost');
    if (/Redundancy regained/.test(ev)) return k('psu_red_ok');
    if (/AC Restored/.test(ev)) return k('ac_restored');
  }
  if (e.sensor.startsWith('Fan')) {
    if (/Lower Critical/.test(ev)) return k('fan_low');
    if (/Presence/.test(ev)) return k('fan_present');
    if (/redundancy regained/i.test(ev)) return k('fan_red_ok');
    if (/Redundancy Lost/.test(ev)) return k('fan_red_lost');
    if (/type mismatch/.test(ev)) return k('fan_mismatch');
  }
  if (e.sensor.startsWith('Processor')) {
    if (/IERR/.test(ev)) return k('cpu_ierr');
    if (/Machine Check/.test(ev)) return k('cpu_mce');
    if (/Thermal Trip/.test(ev)) return k('cpu_thermal');
    if (/mismatch/.test(ev)) return k('cpu_mismatch');
    if (/not detected/.test(ev)) return k('cpu_absent');
  }
  if (e.sensor === 'Temp CPU') return k('cpu_temp', /\((\d+)C\)/.exec(ev)?.[1]);
  if (e.sensor === 'PCIe Slot 1') return k('pcie_fatal');
  if (e.sensor === 'PCIe Slot 1 Temp') return k('pcie_temp');
  if (e.sensor === 'OCP NIC') return k('nic_fault');
  if (e.sensor === 'Battery CMOS') return k('cmos_low');
  if (e.sensor === 'BIOS' && /CMOS checksum/.test(ev)) return k('cmos_checksum');
  if (e.sensor === 'OS Critical Stop') return k('os_stop');
  if (e.sensor === 'System Event') {
    if (/watchdog/.test(ev)) return k('watchdog');
    if (/Power on/.test(ev)) return k('power_on', /\((.+)\)/.exec(ev)?.[1]);
    if (/shutdown|Power off/.test(ev)) return k('power_off', /\((.+)\)/.exec(ev)?.[1]);
  }
  if (e.sensor === 'Physical Security') return k('intrusion');
  if (e.sensor === 'OS Boot') return k(/PXE/.test(ev) ? 'pxe_fail' : 'no_boot');
  if (e.sensor === 'Event Logging Disabled') return k('log_cleared');
  if (e.sensor === 'BMC') return k('bmc_reset');
  if (/Presence detected/.test(ev)) return k('present');
  return { key: null, slot, label };
}

const lastNum = (s: string) => /(\d+)\s*$/.exec(s)?.[1] ?? '1';
/** Dell CPU1/CPU2 from slot CPU0/CPU1. */
const cpuN = (slot?: string) => (slot ? String(Number(slot.slice(3)) + 1) : '1');

function dell(p: Parsed, e: SelEntry): VendorEvent {
  const L = p.label;
  const n = lastNum(L);
  const T: Partial<Record<Key, [string, string, string]>> = {
    mem_ce: ['MEM0701', `Correctable memory error rate exceeded for DIMM ${L}.`, 'Memory'],
    mem_ce_limit: ['MEM8000', `Correctable memory error logging disabled for a memory device at location DIMM ${L}.`, 'Memory'],
    mem_uce: ['MEM0001', `Multi-bit memory errors detected on a memory device at location(s) DIMM ${L}.`, 'Memory'],
    mem_disabled: ['UEFI0107', `One or more memory errors have occurred on memory slot: ${L}. The memory device has been disabled.`, 'Memory'],
    mem_training: ['UEFI0081', `Memory size has changed from the last time the system was started. DIMM ${L} failed memory training and is mapped out.`, 'Memory'],
    mem_config: ['MEM0007', `Unsupported memory configuration; check memory device at location DIMM ${L}.`, 'Memory'],
    mem_none: ['UEFI0039', 'No usable memory detected. The system is halted.', 'Memory'],
    drive_predictive: ['PDR1024', `Drive ${n} in disk drive bay 1 is predicted to fail.`, 'Storage'],
    drive_fault: ['PDR1001', `Fault detected on drive ${n} in disk drive bay 1.`, 'Storage'],
    drive_present: ['PDR1100', `Drive ${n} is installed in disk drive bay 1.`, 'Storage'],
    psu_fail: ['PSU0001', `Power supply ${n} failed.`, 'Power Supply'],
    psu_ac_lost: ['PSU0003', `The power input for power supply ${n} is lost.`, 'Power Supply'],
    psu_ac_restored: ['PSU0005', `The power input for power supply ${n} has been restored.`, 'Power Supply'],
    psu_present: ['PSU0016', `Power supply ${n} is present.`, 'Power Supply'],
    psu_mismatch: ['PSU0017', 'The power supplies are incorrectly configured: mismatched wattage.', 'Power Supply'],
    psu_red_lost: ['RDU0012', 'Power supply redundancy is lost.', 'Power Supply'],
    psu_red_ok: ['RDU0001', 'The power supplies are redundant.', 'Power Supply'],
    ac_restored: ['SYS1000', 'System AC power was restored. iDRAC has started.', 'System'],
    fan_low: ['FAN0002', `Fan ${n} RPM is less than the lower critical threshold.`, 'Fan'],
    fan_present: ['FAN0012', `Fan ${n} is present.`, 'Fan'],
    fan_red_lost: ['RDU0003', 'Fan redundancy is lost.', 'Fan'],
    fan_red_ok: ['RDU0002', 'Fan redundancy is regained.', 'Fan'],
    fan_mismatch: ['FAN1008', 'Fan configuration is not supported for the installed processors and GPUs. Fans are set to maximum speed.', 'Fan'],
    cpu_ierr: ['CPU0000', `Internal error has occurred check for additional logs. (CPU${cpuN(p.slot)})`, 'CPU'],
    cpu_mce: ['CPU0204', `CPU${cpuN(p.slot)} machine check error detected: uncorrected error in bank 4.`, 'CPU'],
    cpu_thermal: ['CPU0001', 'CPU has a thermal trip (over-temperature) event.', 'CPU'],
    cpu_mismatch: ['CPU0005', 'CPU configuration is unsupported: processor models do not match.', 'CPU'],
    cpu_absent: ['CPU0010', 'CPU1 is absent. The system is halted.', 'CPU'],
    cpu_temp: ['TMP0120', `The system board CPU1 Temp temperature is greater than the upper critical threshold${p.extra ? ` (${p.extra} C)` : ''}.`, 'Temperature'],
    pcie_fatal: ['PCI1302', 'A bus fatal error was detected on a component at slot 1.', 'PCI Device'],
    pcie_temp: ['TMP0122', 'The Slot 1 GPU temperature is greater than the upper warning threshold.', 'Temperature'],
    nic_fault: ['NIC1301', 'A fatal error was detected on OCP NIC 3.0. Both ports are down.', 'NIC'],
    cmos_low: ['BAT0017', 'The system board battery is low.', 'Battery'],
    cmos_checksum: ['UEFI0040', 'BIOS settings were reset to defaults because of a CMOS checksum error.', 'BIOS'],
    os_stop: ['OSE0003', 'A runtime critical stop occurred (OS kernel panic).', 'OS'],
    watchdog: ['ASR0001', 'The watchdog timer reset the system.', 'System'],
    power_on: ['SYS1001', `System is turning on.${p.extra ? ` (${p.extra})` : ''}`, 'System'],
    power_off: ['SYS1002', `System is turning off.${p.extra ? ` (${p.extra})` : ''}`, 'System'],
    intrusion: ['SEC0000', 'The chassis is open while the power is on.', 'Security'],
    pxe_fail: ['UEFI0201', 'PXE boot failed: no boot filename received.', 'BIOS'],
    no_boot: ['UEFI0072', 'No bootable device found.', 'BIOS'],
    log_cleared: ['LOG203', 'The System Event Log was cleared.', 'Audit'],
    bmc_reset: ['RAC0182', 'The iDRAC firmware was rebooted with the following reason: user initiated.', 'iDRAC'],
    present: ['HWC1001', `The ${L} is present.`, 'Hardware Config'],
  };
  const r = p.key ? T[p.key] : undefined;
  return r ? { code: r[0], text: r[1], category: r[2] } : { code: 'SEL9901', text: `${e.sensor}: ${e.event}`, category: 'System' };
}

/** "Proc 1 DIMM 3" -> "Processor 1, DIMM 3" */
const hpeDimm = (L: string) => L.replace(/^Proc (\d) DIMM (\d+)$/, 'Processor $1, DIMM $2');

function hpe(p: Parsed, e: SelEntry, dev: Device): VendorEvent {
  const L = p.label;
  const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const T: Partial<Record<Key, [string, string]>> = {
    mem_ce: [`Corrected Memory Error threshold exceeded (${hpeDimm(L)})`, 'Memory'],
    mem_ce_limit: [`Corrected Memory Error threshold exceeded (${hpeDimm(L)}, Memory Module logging disabled)`, 'Memory'],
    mem_uce: [`Uncorrectable Memory Error (${hpeDimm(L)})`, 'Memory'],
    mem_disabled: [`Memory Module mapped out by system ROM (${hpeDimm(L)})`, 'Memory'],
    mem_training: [`POST Error: 207-Memory initialization error on ${hpeDimm(L)}. The DIMM has been mapped out`, 'POST Message'],
    mem_config: ['POST Error: 268-DIMM Configuration Error - mixed DIMM types are not supported', 'POST Message'],
    mem_none: ['POST Error: 207-No memory available. System halted', 'POST Message'],
    drive_predictive: [`Internal Storage Enclosure Device Predictive Failure (${L})`, 'Drive Array'],
    drive_fault: [`Internal Storage Enclosure Device Failure (${L})`, 'Drive Array'],
    drive_present: [`Internal Storage Enclosure Device inserted (${L})`, 'Drive Array'],
    psu_fail: [`Power Supply Failure (${L})`, 'Power'],
    psu_ac_lost: [`Power Supply AC Power Loss (${L})`, 'Power'],
    psu_ac_restored: [`Power Supply AC Power restored (${L})`, 'Power'],
    psu_present: [`Power Supply Inserted (${L})`, 'Power'],
    psu_mismatch: ['Power Supply Mismatch: installed power supplies have different capacities', 'Power'],
    psu_red_lost: ['System Power Supplies Not Redundant', 'Power'],
    psu_red_ok: ['System Power Supplies are Redundant', 'Power'],
    ac_restored: ['Server power restored', 'System Revision'],
    fan_low: [`System Fan Failure (${L}, Location System)`, 'Environment'],
    fan_present: [`System Fan Inserted (${L}, Location System)`, 'Environment'],
    fan_red_lost: ['System Fans Not Redundant', 'Environment'],
    fan_red_ok: ['System Fans are Redundant', 'Environment'],
    fan_mismatch: ['Fan configuration is not supported for the installed configuration. Fans set to maximum', 'Environment'],
    cpu_ierr: [`Uncorrectable Machine Check Exception (Board 1, ${L.replace('Proc', 'Processor')}, APIC ID ${hex(Number(p.slot?.slice(3) ?? 0) * 0x80)}, Bank 0x00000004, Status ${hex(0xbe000000)}'${hex(0x00100150)})`, 'Processor'],
    cpu_mce: [`Uncorrectable Machine Check Exception (Board 1, ${L.replace('Proc', 'Processor')}, Bank 0x00000004, uncorrected)`, 'Processor'],
    cpu_thermal: ['System Overheating (Processor thermal trip)', 'Environment'],
    cpu_mismatch: ['POST Error: 1798-Processor stepping or model mismatch detected', 'POST Message'],
    cpu_absent: ['POST Error: Processor 1 not detected. System halted', 'POST Message'],
    cpu_temp: [`Temperature Status Caution (Processor 1 zone${p.extra ? `, ${p.extra} C` : ''})`, 'Environment'],
    pcie_fatal: ['Uncorrectable PCI Express Error (Slot 1, Bus 0x5A, Device 0x00, Function 0x00, Error status 0x00000020)', 'PCI Bus'],
    pcie_temp: ['Temperature Status Caution (PCI Slot 1 zone)', 'Environment'],
    nic_fault: ['Network Adapter Failure (OCP 3.0 Slot 14): adapter is not responding', 'Network'],
    cmos_low: ['System Battery Failure (RTC battery low)', 'System Revision'],
    cmos_checksum: ['POST Error: 162-System Options Not Set', 'POST Message'],
    os_stop: ['Operating System failure (Linux kernel panic)', 'ASR'],
    watchdog: ['ASR Detected by System ROM', 'ASR'],
    power_on: [`Server power restored${p.extra ? ` (${p.extra})` : ''}`, 'System Revision'],
    power_off: [`Server power removed${p.extra ? ` (${p.extra})` : ''}`, 'System Revision'],
    intrusion: ['Chassis Intrusion: Hood removed while system power on', 'System Revision'],
    pxe_fail: ['Network boot failure: PXE server not found or no boot filename', 'POST Message'],
    no_boot: ['POST Error: 1785-No bootable device was found', 'POST Message'],
    log_cleared: ['IML Cleared (iLO user: Administrator)', 'Maintenance'],
    bmc_reset: ['iLO 6 reset by user request', 'iLO'],
    present: [`${L} inserted`, 'System Revision'],
  };
  void dev;
  const r = p.key ? T[p.key] : undefined;
  return r ? { text: r[0], category: r[1] } : { text: `${e.sensor}: ${e.event}`, category: 'System Revision' };
}

function lenovo(p: Parsed, e: SelEntry, dev: Device): VendorEvent {
  const L = p.label;
  const mtmsn = `MTM-SN: 7D76CTO1WW-${dev.serial}`;
  const sfx = e.severity === 'critical' ? 'M' : e.severity === 'warning' ? 'G' : 'I';
  const T: Partial<Record<Key, [string, string, string]>> = {
    mem_ce: ['MA0011', `Memory Logging Limit Reached for ${L} Status on Subsystem Memory.`, 'Memory'],
    mem_ce_limit: ['MA0011', `Memory Logging Limit Reached for ${L} Status on Subsystem Memory. Correctable error logging is disabled.`, 'Memory'],
    mem_uce: ['MA0010', `Uncorrectable error detected for ${L} Status on Subsystem Memory.`, 'Memory'],
    mem_disabled: ['MA0008', `${L} has been disabled.`, 'Memory'],
    mem_training: ['MA0026', `${L} failed memory training and has been disabled.`, 'Memory'],
    mem_config: ['MA0009', 'Invalid memory configuration (mixed DIMM types) detected for Subsystem Memory.', 'Memory'],
    mem_none: ['MA0007', 'No usable memory detected for Subsystem Memory. The system is halted.', 'Memory'],
    drive_predictive: ['SD0002', `Failure Predicted on Drive ${lastNum(L)} in the enclosure (${mtmsn}).`, 'Storage'],
    drive_fault: ['SD0001', `The Drive ${lastNum(L)} in the enclosure (${mtmsn}) has been disabled due to a detected fault.`, 'Storage'],
    drive_present: ['SD0000', `The Drive ${lastNum(L)} has been added.`, 'Storage'],
    psu_fail: ['PW0002', `Power supply ${lastNum(L)} in the enclosure (${mtmsn}) has failed.`, 'Power'],
    psu_ac_lost: ['PW0011', `Power supply ${lastNum(L)} has lost input.`, 'Power'],
    psu_ac_restored: ['PW0011', `Power supply ${lastNum(L)} has returned to a normal input state.`, 'Power'],
    psu_present: ['PW0001', `Power supply ${lastNum(L)} has been added to container (${mtmsn}).`, 'Power'],
    psu_mismatch: ['PW0062', 'Power supply configuration mismatch: installed power supplies have different ratings.', 'Power'],
    psu_red_lost: ['PW0104', 'Non-redundant: Sufficient Resources from Redundancy Degraded or Fully Redundant for Power Resource has asserted.', 'Power'],
    psu_red_ok: ['PW0105', 'Redundancy Lost for Power Resource has deasserted.', 'Power'],
    ac_restored: ['SE4003', 'The XClarity Controller has restarted after AC power was restored.', 'System'],
    fan_low: ['FN0004', `Numeric sensor ${L} Tach going low (lower critical) has asserted.`, 'Fan'],
    fan_present: ['FN0009', `${L} has been added.`, 'Fan'],
    fan_red_lost: ['FN0012', 'Redundancy Lost for Cooling Zone 1 has asserted.', 'Fan'],
    fan_red_ok: ['FN0013', 'Redundancy Lost for Cooling Zone 1 has deasserted.', 'Fan'],
    fan_mismatch: ['FN0017', 'Fan configuration is not supported for the installed GPUs and processors. Fans set to maximum speed.', 'Fan'],
    cpu_ierr: ['PU0003', `${L} has Failed with IERR.`, 'Processor'],
    cpu_mce: ['PU0021', `${L} has an uncorrectable machine check error (bank 4).`, 'Processor'],
    cpu_thermal: ['PU0001', 'An over-temperature condition has been detected on Processor 1.', 'Processor'],
    cpu_mismatch: ['PU0006', 'Processor configuration mismatch: the installed processors are not the same model.', 'Processor'],
    cpu_absent: ['PU0011', 'Processor 1 is absent. The system cannot boot.', 'Processor'],
    cpu_temp: ['TM0002', `Numeric sensor CPU 1 Temp going high (upper critical) has asserted${p.extra ? ` (${p.extra} C)` : ''}.`, 'Temperature'],
    pcie_fatal: ['IO0004', 'A PCIe fatal bus error has occurred on Slot 1.', 'PCI'],
    pcie_temp: ['TM0001', 'Numeric sensor GPU 1 Temp going high (upper non-critical) has asserted.', 'Temperature'],
    nic_fault: ['IO0011', 'A fatal error has been detected on the OCP 3.0 Ethernet adapter.', 'Network'],
    cmos_low: ['SE2000', 'The CMOS battery is low.', 'System'],
    cmos_checksum: ['SE2001', 'UEFI settings were restored to defaults after a CMOS checksum error.', 'UEFI'],
    os_stop: ['OS0001', 'Critical stop has occurred on the operating system (kernel panic).', 'OS'],
    watchdog: ['OS0005', 'The system has been reset by the OS watchdog timer.', 'OS'],
    power_on: ['PW0007', `Server has been powered on${p.extra ? ` (${p.extra})` : ''}.`, 'Power'],
    power_off: ['PW0008', `Server has been powered off${p.extra ? ` (${p.extra})` : ''}.`, 'Power'],
    intrusion: ['SE0001', 'Chassis intrusion: the top cover was removed while the server is powered on.', 'System'],
    pxe_fail: ['OS0012', 'PXE boot failed: no boot file received.', 'UEFI'],
    no_boot: ['OS0011', 'No bootable device was found.', 'UEFI'],
    log_cleared: ['SE4004', 'The event log has been cleared by user USERID.', 'Audit'],
    bmc_reset: ['SE4000', 'The XClarity Controller was reset by user USERID.', 'XCC'],
    present: ['SE0007', `${L} has been added.`, 'System'],
  };
  const r = p.key ? T[p.key] : undefined;
  return r ? { code: `FQXSP${r[0]}${sfx}`, text: r[1], category: r[2] } : { code: `FQXSPSE4001${sfx}`, text: `${e.sensor}: ${e.event}`, category: 'System' };
}

function supermicro(p: Parsed, e: SelEntry): VendorEvent {
  const L = p.label;
  // P1-DIMMA1 -> DIMMA1(CPU1)
  const at = L.replace(/^P(\d)-(DIMM\w+)$/, '$2(CPU$1)');
  const dir = e.dir === 'Deasserted' ? 'Deassertion' : 'Assertion';
  const T: Partial<Record<Key, [string, string]>> = {
    mem_ce: [`Correctable ECC @${at} - ${dir}`, 'Memory'],
    mem_ce_limit: [`Correctable ECC logging limit reached @${at} - ${dir}`, 'Memory'],
    mem_uce: [`Uncorrectable ECC @${at} - ${dir}`, 'Memory'],
    mem_disabled: [`Memory device disabled @${at} - ${dir}`, 'Memory'],
    mem_training: [`Memory training failure, DIMM mapped out @${at} - ${dir}`, 'Memory'],
    drive_predictive: [`Drive Slot ${L}: Predictive Failure - ${dir}`, 'Drive Slot'],
    drive_fault: [`Drive Slot ${L}: Drive Fault - ${dir}`, 'Drive Slot'],
    drive_present: [`Drive Slot ${L}: Drive Present - ${dir}`, 'Drive Slot'],
    psu_fail: [`${L}: Failure detected - ${dir}`, 'Power Supply'],
    psu_ac_lost: [`${L}: Power Supply AC lost - ${dir}`, 'Power Supply'],
    psu_red_lost: ['PS Redundancy: Redundancy Lost - Assertion', 'Power Unit'],
    psu_red_ok: ['PS Redundancy: Fully Redundant - Assertion', 'Power Unit'],
    fan_low: [`${L}: Lower Critical - going low - ${dir}`, 'Fan'],
    fan_red_lost: ['Fan Redundancy: Redundancy Lost - Assertion', 'Fan'],
    cpu_ierr: [`${L}: IERR - ${dir}`, 'Processor'],
    cpu_thermal: [`${L}: Thermal Trip - ${dir}`, 'Processor'],
    cmos_low: ['VBAT: Lower Critical - going low - Assertion', 'Voltage'],
    watchdog: ['Watchdog 2: Timer expired, hard reset - Assertion', 'Watchdog 2'],
    intrusion: ['Chassis Intru: General Chassis Intrusion - Assertion', 'Physical Security'],
    log_cleared: ['SEL: Log area reset/cleared - Assertion', 'Event Logging Disabled'],
  };
  const r = p.key ? T[p.key] : undefined;
  return r ? { text: r[0], category: r[1] } : { text: `${e.sensor}: ${e.event} - ${dir}`, category: e.sensor.split(' ')[0] };
}

/** How the device's own management controller words this log entry. Generic devices fall through unchanged. */
export function vendorEvent(dev: Device, e: SelEntry): VendorEvent {
  const v: VendorId | undefined = MODELS[dev.model]?.vendor;
  const p = parse(dev.model, e);
  if (v === 'dell') return dell(p, e);
  if (v === 'hpe') return hpe(p, e, dev);
  if (v === 'lenovo') return lenovo(p, e, dev);
  if (v === 'supermicro') return supermicro(p, e);
  return { text: `${e.sensor}: ${e.event}`, category: e.sensor.split(' ')[0] };
}

/** Swap raw slot ids in a sensor name for the vendor's label ("Memory DIMM_A3" -> "Memory A3"). */
export function vendorSensor(dev: Device, sensor: string): string {
  const m = SLOT_SENSOR.exec(sensor);
  return m ? `${m[1]} ${slotLabel(dev.model, m[2])}` : sensor;
}
