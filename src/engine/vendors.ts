// Vendor registry: Dell, HPE, Supermicro and Lenovo flavours of the generic 2U nodes.
// Names, part-number styles, label formats and log wording are modelled closely on the real platforms; exact
// numbers are illustrative. DCT Training is not affiliated with or endorsed by any of these companies.
import type { ComponentKind } from './types';
import type { Rng } from './rng';

export type VendorId = 'dell' | 'hpe' | 'supermicro' | 'lenovo';
export const VENDOR_IDS: VendorId[] = ['dell', 'hpe', 'supermicro', 'lenovo'];

/** A vendor's version of a generic part (keyed by the generic PN in catalog.ts). */
export interface VendorPart {
  pn: string;
  desc: string;
  watts?: number;
  /** Replaces the generic gotcha; '' means this part is correct for the vendor (e.g. 2280 boot SSDs on BOSS-N1). */
  gotcha?: string;
  formFactor?: string;
}

export interface VendorModelInfo {
  id: string;
  name: string;
  /** Short model badge as printed on the chassis. */
  badge: string;
  description: string;
}

export interface VendorInfo {
  id: VendorId;
  name: string;
  family: string;
  /** Brand colours: primary (logo), and the BMC chrome. */
  color: string;
  bmcBg: string;
  bmcAccent: string;
  bmc: { product: string; short: string; logName: string; selName: string; cli: string; defaultUser: string };
  serialLabel: string;
  models: { compute: VendorModelInfo; storage: VendorModelInfo };
  /** Generic PN -> vendor part. Every generic PN in catalog.ts has an entry. */
  parts: Record<string, VendorPart>;
  /** Which M.2 form factor the boot device takes (BOSS-N1 and NS204i-u carriers take 2280). */
  m2FormFactor: 'm2-2280' | 'm2-22110';
  /** How a failed part gets to site, for ticket text and the codex. */
  dispatch: string;
  touchPoints: string;
  oui: string;
  bmcFw: (rng: Rng) => string;
  chassisSerial: (rng: Rng) => string;
  partSerial: (rng: Rng, kind: ComponentKind, pn: string) => string;
  slotLabel: (slotId: string) => string | undefined;
}

// ---------- shared helpers ----------

const UP = 'ABCDEFGHJKLMNPRSTVWXYZ';
const DIG = '0123456789';
const pickN = (rng: Rng, chars: string, n: number) => Array.from({ length: n }, () => chars[rng.int(0, chars.length - 1)]).join('');

/** Drives, DIMMs and CPUs carry the silicon vendor's serial whatever the box; the rest carry the OEM's label format. */
function siliconSerial(rng: Rng, kind: ComponentKind): string | null {
  if (kind === 'hdd') return `ZL${pickN(rng, DIG, 1)}${pickN(rng, UP + DIG, 5)}`; // Seagate Exos style
  if (kind === 'nvme' || kind === 'm2') return `S6${pickN(rng, UP, 2)}NA0${pickN(rng, UP, 1)}${pickN(rng, DIG, 6)}`; // Samsung PM9A3 style
  if (kind === 'dimm') return pickN(rng, '0123456789ABCDEF', 8); // SPD serial, 8 hex digits
  if (kind === 'cpu') return pickN(rng, '0123456789ABCDEF', 16); // PPIN
  return null;
}

function dimmBank(slotId: string): { cpu: number; i: number } | null {
  const m = /^DIMM_([AB])(\d)$/.exec(slotId);
  return m ? { cpu: m[1] === 'A' ? 1 : 2, i: Number(m[2]) } : null;
}

const num = (slotId: string, prefix: string) => (slotId.startsWith(prefix) ? Number(slotId.slice(prefix.length)) : NaN);

// ---------- Dell ----------

const dellDpn = (s: string) => `0${s}`;
const dell: VendorInfo = {
  id: 'dell',
  name: 'Dell',
  family: 'PowerEdge',
  color: '#0076ce',
  bmcBg: '#0b1f33',
  bmcAccent: '#0076ce',
  bmc: { product: 'Integrated Dell Remote Access Controller 9', short: 'iDRAC9', logName: 'Lifecycle Log', selName: 'System Event Log', cli: 'racadm', defaultUser: 'root' },
  serialLabel: 'Service Tag',
  models: {
    compute: { id: 'dell-r760', name: 'PowerEdge R760 (2U, 8x NVMe)', badge: 'R760', description: 'Dell 16th-gen 2-socket 2U. 8x 2.5" NVMe front bays, 16 DDR5 DIMMs, BOSS-N1 mirrored M.2 boot, OCP NIC 3.0 and an NVIDIA L4 on Riser 1. iDRAC9 Enterprise.' },
    storage: { id: 'dell-r760-lff', name: 'PowerEdge R760 (2U, 12x 3.5")', badge: 'R760', description: 'Dell R760 in the 12x 3.5" LFF chassis on an HBA465i, for scale-out storage. BOSS-N1 boot, OCP NIC 3.0. iDRAC9 Enterprise.' },
  },
  parts: {
    'CPU-X5-64C-2.4': { pn: dellDpn('R9N7M'), desc: 'Intel Xeon Platinum 8592+ 1.9G, 64C/128T, 350W', watts: 350 },
    'CPU-X5-48C-2.6': { pn: dellDpn('F6HW3'), desc: 'Intel Xeon Platinum 8568Y+ 2.3G, 48C/96T, 350W', watts: 350 },
    'MEM-64G-D5-5600-2R': { pn: dellDpn('J52K5'), desc: '64GB RDIMM, 5600MT/s, Dual Rank' },
    'MEM-64G-D5-4800-2R': { pn: dellDpn('W08W9'), desc: '64GB RDIMM, 4800MT/s, Dual Rank' },
    'MEM-32G-D5-5600-1R': { pn: dellDpn('KTTH1'), desc: '32GB RDIMM, 5600MT/s, Single Rank' },
    'PSU-1600W-AC-TI': { pn: dellDpn('X1W9T'), desc: '1400W Titanium Hot-Plug PSU (Mixed Mode, 100-240Vac)', watts: 1400 },
    'PSU-1600W-48VDC': { pn: dellDpn('H6J6R'), desc: '1100W -48V DC Hot-Plug PSU', watts: 1100 },
    'PSU-1100W-AC-PL': { pn: dellDpn('CMPGM'), desc: '1100W Titanium Hot-Plug PSU (Mixed Mode)', watts: 1100 },
    'FAN-60X56-HP': { pn: dellDpn('VN8F4'), desc: 'High Performance Gold (HPR Gold) Fan' },
    'FAN-60X38-STD': { pn: dellDpn('J1CF8'), desc: 'Standard (STD) Fan', gotcha: 'STD fan in a box configured for HPR Gold fans (L4 GPU + 350W CPUs): iDRAC logs a fan configuration mismatch and pins every fan at 100%.' },
    'HDD-20T-SATA-7K2': { pn: dellDpn('R5J1W'), desc: '20TB Hard Drive SATA 6Gbps 7.2K 512e 3.5in Hot-Plug' },
    'HDD-20T-SAS-7K2': { pn: dellDpn('KHJ9C'), desc: '20TB Hard Drive SAS ISE 12Gbps 7.2K 512e 3.5in Hot-Plug' },
    'HDD-18T-SATA-7K2': { pn: dellDpn('Y5D7W'), desc: '18TB Hard Drive SATA 6Gbps 7.2K 512e 3.5in Hot-Plug' },
    'NVME-7T68-U2-G4': { pn: dellDpn('D2WGR'), desc: '7.68TB Enterprise NVMe Read Intensive AG Drive U.2 Gen4 with carrier' },
    'NVME-7T68-E1S': { pn: dellDpn('M8F4T'), desc: '7.68TB Enterprise NVMe Read Intensive E3.S Gen5' , gotcha: 'E3.S EDSFF drive. It needs an E3.S backplane and carrier; it will not go into a U.2 bay.' },
    'M2-960G-NVME-22110': { pn: dellDpn('7FXH2'), desc: '960GB M.2 NVMe 22110 SSD', gotcha: 'Wrong length for BOSS-N1: the BOSS carrier only takes M.2 2280. A 22110 overhangs the carrier and cannot be latched.' },
    'M2-960G-NVME-2280': { pn: dellDpn('3K2N4'), desc: 'BOSS-N1 960GB M.2 NVMe 2280 Read Intensive SSD', formFactor: 'm2-2280', gotcha: '' },
    'OCP3-2X25G-SFP28': { pn: dellDpn('X7R2P'), desc: 'Broadcom 57414 Dual Port 10/25GbE SFP28, OCP NIC 3.0' },
    'OCP3-2X100G-QSFP': { pn: dellDpn('J9W5K'), desc: 'Mellanox ConnectX-6 Dx Dual Port 100GbE QSFP56, OCP NIC 3.0' },
    'GPU-24G-LP-PCIE4': { pn: dellDpn('N5T2X'), desc: 'NVIDIA L4 24GB PCIe Gen4 72W Low Profile', watts: 72 },
    'BATT-CR2032': { pn: dellDpn('D3T3D'), desc: 'System board coin cell battery, CR2032 3V' },
    'BATT-CR2025': { pn: dellDpn('9R2MH'), desc: 'Coin cell battery CR2025 3V' },
    'HS-2U-STD': { pn: dellDpn('HX9V5'), desc: 'Heatsink, 2U, High Performance (350W)' },
  },
  m2FormFactor: 'm2-2280',
  dispatch: 'Dell ProSupport: the failed part ships by onsite dispatch (TechDirect). Quote the Service Tag; return the old part in the same box with the prepaid label.',
  touchPoints: 'Orange (terracotta) touch points = hot-plug, safe with the system on. Blue touch points = power the system off first.',
  oui: 'B0:7B:25',
  bmcFw: (rng) => `iDRAC9 7.${rng.int(0, 1)}0.${rng.int(3, 6)}0.00`,
  // 7-character Service Tag (no I, O, Q, U to avoid confusion)
  chassisSerial: (rng) => pickN(rng, DIG + UP.replace(/[AEU]/g, ''), 7),
  partSerial: (rng, kind, pn) => siliconSerial(rng, kind) ?? `CN${pn}${pickN(rng, DIG, 5)}${pickN(rng, DIG + UP, 3)}${pickN(rng, DIG, 4)}A0${rng.int(0, 3)}`, // PPID
  slotLabel: (id) => {
    const d = dimmBank(id);
    if (d) return `${d.cpu === 1 ? 'A' : 'B'}${d.i}`;
    if (id.startsWith('BAY')) return `Disk ${num(id, 'BAY')}`;
    if (id.startsWith('FAN')) return `Fan ${num(id, 'FAN')}`;
    if (id.startsWith('PSU')) return `PSU ${num(id, 'PSU')}`;
    return { CPU0: 'CPU1', CPU1: 'CPU2', OCP0: 'OCP NIC 3.0', M2_0: 'BOSS-N1 M.2 0', M2_1: 'BOSS-N1 M.2 1', CMOS: 'System board battery', PCIE1: 'Riser 1 Slot 1' }[id];
  },
};

// ---------- HPE ----------

const hpeSpare = (n: number) => `P${n}-001`;
const hpe: VendorInfo = {
  id: 'hpe',
  name: 'HPE',
  family: 'ProLiant',
  color: '#01a982',
  bmcBg: '#262b30',
  bmcAccent: '#01a982',
  bmc: { product: 'HPE Integrated Lights-Out 6', short: 'iLO 6', logName: 'Integrated Management Log', selName: 'iLO Event Log', cli: 'iLO CLI (SMASH CLP)', defaultUser: 'Administrator' },
  serialLabel: 'Serial Number',
  models: {
    compute: { id: 'hpe-dl380g11', name: 'ProLiant DL380 Gen11 (2U, 8 SFF NVMe)', badge: 'DL380 Gen11', description: 'HPE 2-socket 2U. 8 SFF U.3 NVMe bays in Basic Carriers, 16 DDR5 Smart Memory DIMMs, NS204i-u mirrored boot device, OCP 3.0 slot and an NVIDIA L4. iLO 6 Advanced.' },
    storage: { id: 'hpe-dl380g11-lff', name: 'ProLiant DL380 Gen11 (2U, 12 LFF)', badge: 'DL380 Gen11', description: 'DL380 Gen11 in the 12 LFF chassis with Low Profile drive carriers on an HPE MR408i-o in HBA mode. NS204i-u boot. iLO 6.' },
  },
  parts: {
    'CPU-X5-64C-2.4': { pn: hpeSpare(67111), desc: 'Intel Xeon-Platinum 8592+ 1.9GHz 64-core 350W Processor for HPE', watts: 350 },
    'CPU-X5-48C-2.6': { pn: hpeSpare(67107), desc: 'Intel Xeon-Platinum 8568Y+ 2.3GHz 48-core 350W Processor for HPE', watts: 350 },
    'MEM-64G-D5-5600-2R': { pn: hpeSpare(64707), desc: 'HPE 64GB (1x64GB) Dual Rank x4 DDR5-5600 CAS-46-45-45 EC8 Registered Smart Memory Kit' },
    'MEM-64G-D5-4800-2R': { pn: hpeSpare(43331), desc: 'HPE 64GB (1x64GB) Dual Rank x4 DDR5-4800 CAS-40-39-39 EC8 Registered Smart Memory Kit' },
    'MEM-32G-D5-5600-1R': { pn: hpeSpare(64706), desc: 'HPE 32GB (1x32GB) Single Rank x4 DDR5-5600 CAS-46-45-45 EC8 Registered Smart Memory Kit' },
    'PSU-1600W-AC-TI': { pn: hpeSpare(38997), desc: 'HPE 1600W Flex Slot Platinum Hot Plug Low Halogen Power Supply', watts: 1600 },
    'PSU-1600W-48VDC': { pn: hpeSpare(36385), desc: 'HPE 1600W Flex Slot -48VDC Hot Plug Power Supply', watts: 1600 },
    'PSU-1100W-AC-PL': { pn: hpeSpare(44712), desc: 'HPE 1000W Flex Slot Titanium Hot Plug Power Supply', watts: 1000, gotcha: 'Mixed Flex Slot wattages. iLO reports a power supply mismatch and redundancy is not guaranteed at full load.' },
    'FAN-60X56-HP': { pn: hpeSpare(48461), desc: 'HPE ProLiant DL3X0 Gen11 High Performance Fan Kit' },
    'FAN-60X38-STD': { pn: hpeSpare(48460), desc: 'HPE ProLiant DL3X0 Gen11 Standard Fan Kit', gotcha: 'Standard fan in a high-performance config (GPU + 350W CPUs): iLO logs "fan configuration not supported" and runs fans at maximum.' },
    'HDD-20T-SATA-7K2': { pn: hpeSpare(53562), desc: 'HPE 20TB SATA 6G Business Critical 7.2K LFF LP 1-year ISE Multi Vendor HDD' },
    'HDD-20T-SAS-7K2': { pn: hpeSpare(53563), desc: 'HPE 20TB SAS 12G Business Critical 7.2K LFF LP 1-year ISE Multi Vendor HDD' },
    'HDD-18T-SATA-7K2': { pn: hpeSpare(23608), desc: 'HPE 18TB SATA 6G Business Critical 7.2K LFF LP 1-year ISE Multi Vendor HDD' },
    'NVME-7T68-U2-G4': { pn: hpeSpare(50229), desc: 'HPE 7.68TB NVMe Gen4 Mainstream Performance Read Intensive SFF BC U.3 Static Multi Vendor SSD' },
    'NVME-7T68-E1S': { pn: hpeSpare(61199), desc: 'HPE 7.68TB NVMe Gen5 Read Intensive E3.S EC1 Multi Vendor SSD', gotcha: 'E3.S EDSFF drive: it needs an E3.S drive cage. It cannot go into an SFF Basic Carrier bay.' },
    'M2-960G-NVME-22110': { pn: hpeSpare(40513), desc: 'HPE 960GB NVMe Gen4 Read Intensive M.2 22110 SSD', gotcha: 'Wrong length: the NS204i-u boot device carriers only take M.2 2280.' },
    'M2-960G-NVME-2280': { pn: hpeSpare(47819), desc: 'HPE 480GB NVMe Gen4 Mainstream Performance Read Intensive M.2 2280 SSD (NS204i-u)', formFactor: 'm2-2280', gotcha: '' },
    'OCP3-2X25G-SFP28': { pn: hpeSpare(51181), desc: 'Broadcom BCM57414 Ethernet 10/25Gb 2-port SFP28 OCP3 Adapter for HPE' },
    'OCP3-2X100G-QSFP': { pn: hpeSpare(42044), desc: 'NVIDIA Mellanox MCX623436AS-CDAI Ethernet 100Gb 2-port QSFP56 OCP3 Adapter for HPE' },
    'GPU-24G-LP-PCIE4': { pn: hpeSpare(58155), desc: 'NVIDIA L4 24GB PCIe Accelerator for HPE', watts: 72 },
    'BATT-CR2032': { pn: hpeSpare(23455), desc: 'System battery, 3V lithium coin cell (CR2032)' },
    'BATT-CR2025': { pn: hpeSpare(11902), desc: '3V lithium coin cell (CR2025)' },
    'HS-2U-STD': { pn: hpeSpare(48903), desc: 'HPE ProLiant DL380 Gen11 High Performance Heat Sink Kit' },
  },
  m2FormFactor: 'm2-2280',
  dispatch: 'HPE Pointnext: open a support case with the serial number. CSR (Customer Self Repair) parts ship to site; the old part goes back in the same packaging within the return window.',
  touchPoints: 'Terracotta touch points = hot-plug. Blue touch points = cold, power down first. Press the Do-Not-Remove button on a Smart Carrier drive before you pull it.',
  oui: '94:40:C9',
  bmcFw: (rng) => `iLO 6 v1.${rng.int(55, 64)}`,
  chassisSerial: (rng) => `CZ${pickN(rng, DIG, 1)}${pickN(rng, UP + DIG, 7)}`,
  partSerial: (rng, kind) => siliconSerial(rng, kind) ?? `${pickN(rng, DIG, 1)}${pickN(rng, UP, 4)}${pickN(rng, DIG, 1)}${pickN(rng, UP + DIG, 8)}`,
  slotLabel: (id) => {
    const d = dimmBank(id);
    if (d) return `Proc ${d.cpu} DIMM ${d.i}`;
    if (id.startsWith('BAY')) return `Box 1 Bay ${num(id, 'BAY') + 1}`;
    if (id.startsWith('FAN')) return `Fan ${num(id, 'FAN')}`;
    if (id.startsWith('PSU')) return `Power Supply ${num(id, 'PSU')}`;
    return { CPU0: 'Proc 1', CPU1: 'Proc 2', OCP0: 'OCP 3.0 Slot 14', M2_0: 'NS204i-u Drive 1', M2_1: 'NS204i-u Drive 2', CMOS: 'System battery', PCIE1: 'Primary Riser Slot 1' }[id];
  },
};

// ---------- Supermicro ----------

const supermicro: VendorInfo = {
  id: 'supermicro',
  name: 'Supermicro',
  family: 'SuperServer',
  color: '#1f4b99',
  bmcBg: '#1c2a3f',
  bmcAccent: '#3d8b3d',
  bmc: { product: 'Supermicro BMC (X13)', short: 'BMC', logName: 'Health Event Log', selName: 'Health Event Log', cli: 'SMASH-CLP', defaultUser: 'ADMIN' },
  serialLabel: 'System Serial',
  models: {
    compute: { id: 'smc-221h', name: 'SuperServer SYS-221H-TNR (2U, 8x NVMe)', badge: 'SYS-221H-TNR', description: 'Supermicro Hyper 2U, 2-socket X13. 8x 2.5" NVMe hot-swap, 16 DDR5 DIMMs, dual M.2 on the board, an AIOM (OCP 3.0) slot and an NVIDIA L4.' },
    storage: { id: 'smc-621c-lff', name: 'SuperServer SYS-621C-TN12R (2U, 12x 3.5")', badge: 'SYS-621C-TN12R', description: 'Supermicro CloudDC 2U, 12x 3.5" hot-swap on an AOC-S3816L HBA, dual M.2 boot, AIOM networking.' },
  },
  parts: {
    'CPU-X5-64C-2.4': { pn: 'P4X-EMR8592+-SRN6J', desc: 'Intel Xeon Platinum 8592+ 64C 1.9GHz 350W (LGA-4677)', watts: 350 },
    'CPU-X5-48C-2.6': { pn: 'P4X-EMR8568Y+-SRN6Q', desc: 'Intel Xeon Platinum 8568Y+ 48C 2.3GHz 350W (LGA-4677)', watts: 350 },
    'MEM-64G-D5-5600-2R': { pn: 'MEM-DR564MC-ER56', desc: '64GB DDR5-5600 2Rx4 ECC RDIMM' },
    'MEM-64G-D5-4800-2R': { pn: 'MEM-DR564MB-ER48', desc: '64GB DDR5-4800 2Rx4 ECC RDIMM' },
    'MEM-32G-D5-5600-1R': { pn: 'MEM-DR532MD-ER56', desc: '32GB DDR5-5600 1Rx4 ECC RDIMM' },
    'PSU-1600W-AC-TI': { pn: 'PWS-1K63A-1R', desc: '1600W 1U redundant module, 80+ Titanium, AC', watts: 1600 },
    'PSU-1600W-48VDC': { pn: 'PWS-1K66D-1R', desc: '1600W 1U redundant module, -48V DC', watts: 1600 },
    'PSU-1100W-AC-PL': { pn: 'PWS-1K13A-1R', desc: '1100W 1U redundant module, 80+ Platinum, AC', watts: 1100 },
    'FAN-60X56-HP': { pn: 'FAN-0206L4', desc: '60x56mm 4-pin PWM hot-swap fan, 17.3K RPM' },
    'FAN-60X38-STD': { pn: 'FAN-0184L4', desc: '60x38mm 4-pin PWM fan, 13.5K RPM', gotcha: 'Lower-airflow 38mm fan. With the L4 and 350W CPUs the BMC flags low fan speed and the board throttles.' },
    'HDD-20T-SATA-7K2': { pn: 'HDD-T20T-ST20000NM007D', desc: 'Seagate Exos X20 20TB SATA 6Gb/s 7.2K 3.5" 512e' },
    'HDD-20T-SAS-7K2': { pn: 'HDD-A20T-ST20000NM002D', desc: 'Seagate Exos X20 20TB SAS 12Gb/s 7.2K 3.5" 512e' },
    'HDD-18T-SATA-7K2': { pn: 'HDD-T18T-ST18000NM000J', desc: 'Seagate Exos X18 18TB SATA 6Gb/s 7.2K 3.5" 512e' },
    'NVME-7T68-U2-G4': { pn: 'HDS-SUN1-MZQL27T6HBLA', desc: 'Samsung PM9A3 7.68TB NVMe PCIe Gen4 U.2 15mm' },
    'NVME-7T68-E1S': { pn: 'HDS-SE1-MZ4L27T6HBLA', desc: 'Samsung PM9A3 7.68TB NVMe PCIe Gen4 E1.S 9.5mm' },
    'M2-960G-NVME-22110': { pn: 'HDS-SMN0-MZ1L2960HCJR', desc: 'Samsung PM9A3 960GB NVMe PCIe Gen4 M.2 22110' },
    'M2-960G-NVME-2280': { pn: 'HDS-IMN0-SSDPEKKA960G', desc: '960GB NVMe PCIe M.2 2280 (client-grade)', gotcha: '2280 is 30mm short of the 22110 standoff, and it is a client drive without power-loss protection. Do not use it as a boot mirror member.' },
    'OCP3-2X25G-SFP28': { pn: 'AOC-A25G-b2SG', desc: 'AIOM (OCP 3.0) 2-port 25GbE SFP28, Broadcom BCM57414' },
    'OCP3-2X100G-QSFP': { pn: 'AOC-A100G-m2CG', desc: 'AIOM (OCP 3.0) 2-port 100GbE QSFP28, NVIDIA ConnectX-6 Dx' },
    'GPU-24G-LP-PCIE4': { pn: 'GPU-NVL4', desc: 'NVIDIA L4 24GB PCIe Gen4 72W Low Profile, passive', watts: 72 },
    'BATT-CR2032': { pn: 'BTY-CR2032-3V', desc: 'Onboard battery BT1, CR2032 3V lithium' },
    'BATT-CR2025': { pn: 'BTY-CR2025-3V', desc: 'CR2025 3V lithium coin cell' },
    'HS-2U-STD': { pn: 'SNK-P0088P', desc: '2U passive CPU heatsink, LGA-4677' },
  },
  m2FormFactor: 'm2-22110',
  dispatch: 'Supermicro: spares are stocked on site from the advance-replacement pool. Log the swap and file the eRMA with the system serial; the failed part goes back with the RMA number on the box.',
  touchPoints: 'Hot-swap parts (drives, fans, PSUs) have their own release tab or latch. There is no colour code you can rely on, so check the manual for anything internal.',
  oui: '3C:EC:EF',
  bmcFw: (rng) => `BMC 01.0${rng.int(2, 4)}.${rng.int(10, 30)}`,
  chassisSerial: (rng) => `S${pickN(rng, DIG, 6)}X${pickN(rng, DIG, 1)}${pickN(rng, UP, 1)}${pickN(rng, DIG, 5)}`,
  partSerial: (rng, kind, pn) => siliconSerial(rng, kind) ?? `${pn.replace(/[^A-Z0-9]/g, '').slice(0, 6)}${pickN(rng, DIG, 2)}${pickN(rng, UP, 2)}${pickN(rng, DIG, 5)}`,
  slotLabel: (id) => {
    const d = dimmBank(id);
    if (d) return `P${d.cpu}-DIMM${'ABCDEFGH'[d.i - 1]}1`;
    if (id.startsWith('BAY')) return `Slot ${num(id, 'BAY')}`;
    if (id.startsWith('FAN')) return `FAN${num(id, 'FAN')}`;
    if (id.startsWith('PSU')) return `PS${num(id, 'PSU')}`;
    return { CPU0: 'CPU1', CPU1: 'CPU2', OCP0: 'AIOM', M2_0: 'M.2-C1', M2_1: 'M.2-C2', CMOS: 'BT1 battery', PCIE1: 'RSC-R1 Slot 1' }[id];
  },
};

// ---------- Lenovo ----------

const lenovo: VendorInfo = {
  id: 'lenovo',
  name: 'Lenovo',
  family: 'ThinkSystem',
  color: '#e2231a',
  bmcBg: '#1d1d1f',
  bmcAccent: '#e2231a',
  bmc: { product: 'Lenovo XClarity Controller 2', short: 'XCC2', logName: 'Event Log', selName: 'Event Log', cli: 'XCC CLI', defaultUser: 'USERID' },
  serialLabel: 'Serial Number',
  models: {
    compute: { id: 'lnv-sr650v3', name: 'ThinkSystem SR650 V3 (2U, 8x NVMe)', badge: 'SR650 V3', description: 'Lenovo 2-socket 2U. 8x 2.5" AnyBay NVMe, 16 TruDDR5 DIMMs, mirrored M.2 boot on the M.2 adapter, OCP 3.0 Ethernet and an NVIDIA L4. XClarity Controller 2.' },
    storage: { id: 'lnv-sr650v3-lff', name: 'ThinkSystem SR650 V3 (2U, 12x 3.5")', badge: 'SR650 V3', description: 'SR650 V3 in the 12x 3.5" chassis on a ThinkSystem 440-16i HBA. M.2 boot, OCP 3.0. XClarity Controller 2.' },
  },
  parts: {
    'CPU-X5-64C-2.4': { pn: '03LF942', desc: 'ThinkSystem Intel Xeon Platinum 8592+ 64C 350W 1.9GHz Processor', watts: 350 },
    'CPU-X5-48C-2.6': { pn: '03LF938', desc: 'ThinkSystem Intel Xeon Platinum 8568Y+ 48C 350W 2.3GHz Processor', watts: 350 },
    'MEM-64G-D5-5600-2R': { pn: '03LF845', desc: 'ThinkSystem 64GB TruDDR5 5600MHz (2Rx4) RDIMM' },
    'MEM-64G-D5-4800-2R': { pn: '03KH935', desc: 'ThinkSystem 64GB TruDDR5 4800MHz (2Rx4) 10x4 RDIMM' },
    'MEM-32G-D5-5600-1R': { pn: '03LF844', desc: 'ThinkSystem 32GB TruDDR5 5600MHz (1Rx4) RDIMM' },
    'PSU-1600W-AC-TI': { pn: '03LE542', desc: 'ThinkSystem 1800W 230V Titanium Hot-Swap Gen2 Power Supply', watts: 1800 },
    'PSU-1600W-48VDC': { pn: '03LE551', desc: 'ThinkSystem 1100W -48V DC Hot-Swap Gen2 Power Supply', watts: 1100 },
    'PSU-1100W-AC-PL': { pn: '03LE537', desc: 'ThinkSystem 1100W 230V/115V Titanium Hot-Swap Gen2 Power Supply', watts: 1100 },
    'FAN-60X56-HP': { pn: '03LE612', desc: 'ThinkSystem SR650 V3 Performance Fan Module' },
    'FAN-60X38-STD': { pn: '03LE611', desc: 'ThinkSystem SR650 V3 Standard Fan Module', gotcha: 'Standard fan in a performance-fan config (GPU + 350W CPUs): XCC raises a fan mismatch event and the box will not run at full load.' },
    'HDD-20T-SATA-7K2': { pn: '03LC312', desc: 'ThinkSystem 3.5" 20TB 7.2K SATA 6Gb Hot Swap 512e HDD' },
    'HDD-20T-SAS-7K2': { pn: '03LC316', desc: 'ThinkSystem 3.5" 20TB 7.2K SAS 12Gb Hot Swap 512e HDD' },
    'HDD-18T-SATA-7K2': { pn: '02YE960', desc: 'ThinkSystem 3.5" 18TB 7.2K SATA 6Gb Hot Swap 512e HDD' },
    'NVME-7T68-U2-G4': { pn: '03LE228', desc: 'ThinkSystem 2.5" U.3 7.68TB Read Intensive NVMe PCIe 4.0 x4 HS SSD' },
    'NVME-7T68-E1S': { pn: '03LE931', desc: 'ThinkSystem E3.S 7.68TB Read Intensive NVMe PCIe 5.0 x4 HS SSD', gotcha: 'E3.S EDSFF drive. It needs the E3.S backplane; it will not seat in an AnyBay 2.5" bay.' },
    'M2-960G-NVME-22110': { pn: '03LE466', desc: 'ThinkSystem M.2 7450 PRO 960GB Read Intensive NVMe PCIe 4.0 x4 NHS SSD' },
    'M2-960G-NVME-2280': { pn: '03LE470', desc: 'ThinkSystem M.2 960GB NVMe 2280 NHS SSD' },
    'OCP3-2X25G-SFP28': { pn: '03LE201', desc: 'ThinkSystem Broadcom 57414 10/25GbE SFP28 2-Port OCP Ethernet Adapter' },
    'OCP3-2X100G-QSFP': { pn: '03LE205', desc: 'ThinkSystem Mellanox ConnectX-6 Dx 100GbE QSFP56 2-port OCP Ethernet Adapter' },
    'GPU-24G-LP-PCIE4': { pn: '03LE710', desc: 'ThinkSystem NVIDIA L4 24GB PCIe Gen4 Passive GPU', watts: 72 },
    'BATT-CR2032': { pn: '01ET712', desc: 'CMOS battery, CR2032 3V' },
    'BATT-CR2025': { pn: '01ET713', desc: 'Coin cell battery, CR2025 3V' },
    'HS-2U-STD': { pn: '03LE660', desc: 'ThinkSystem SR650 V3 Performance Heatsink' },
  },
  m2FormFactor: 'm2-22110',
  dispatch: 'Lenovo Premier Support: open a service ticket with the machine type and serial (MTM 7D76). CRU parts ship to site; the field service rep handles FRUs. Return the failed part with the label in the box.',
  touchPoints: 'Terracotta touch points = hot-swap. Blue touch points = power off first. The fault LEDs on the light path show which part failed, even with the lid off.',
  oui: '08:94:EF',
  bmcFw: (rng) => `XCC2 ${rng.int(2, 4)}.${rng.int(10, 40)} (ESX3${pickN(rng, UP, 2)}I)`,
  chassisSerial: (rng) => `J${pickN(rng, DIG, 3)}${pickN(rng, UP + DIG, 4)}`,
  partSerial: (rng, kind, pn) => siliconSerial(rng, kind) ?? `11S${pn}${pickN(rng, UP, 2)}${pickN(rng, DIG, 2)}${pickN(rng, UP + DIG, 6)}`,
  slotLabel: (id) => {
    const d = dimmBank(id);
    if (d) return `DIMM ${d.i + (d.cpu - 1) * 8}`;
    if (id.startsWith('BAY')) return `Bay ${num(id, 'BAY')}`;
    if (id.startsWith('FAN')) return `Fan ${num(id, 'FAN')}`;
    if (id.startsWith('PSU')) return `PSU ${num(id, 'PSU')}`;
    return { CPU0: 'Processor 1', CPU1: 'Processor 2', OCP0: 'OCP 3.0 adapter', M2_0: 'M.2 Drive 0', M2_1: 'M.2 Drive 1', CMOS: 'CMOS battery', PCIE1: 'Riser 1 Slot 1' }[id];
  },
};

export const VENDORS: Record<VendorId, VendorInfo> = { dell, hpe, supermicro, lenovo };

export function isVendorId(s: string | undefined): s is VendorId {
  return !!s && (VENDOR_IDS as string[]).includes(s);
}
