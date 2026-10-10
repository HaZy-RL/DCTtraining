// Codex cards (unlock as you meet things) + always-on glossary and cheat-sheets.
export interface CodexEntry {
  id: string; // unlock key, e.g. "kind:dimm" or "tool:bmc"
  title: string;
  icon: string;
  category: 'Hardware' | 'Tools' | 'Process';
  body: string;
  gotchas: string[];
}

export const CODEX: CodexEntry[] = [
  { id: 'kind:hdd', title: 'Hard drive (3.5" SATA)', icon: '💽', category: 'Hardware', body: 'Spinning disk in a hot-swap carrier. Storage nodes run them as JBOD: the storage service replicates data, so there is no hardware RAID.', gotchas: ['Release the handle, then wait 15–30 s for spin-down before pulling it out', 'Map by SERIAL, not /dev/sdX', 'Data-bearing: secure destruction only, never RMA', 'Blink the bay (ledctl / BMC) before you pull'] },
  { id: 'kind:nvme', title: 'NVMe SSD (U.2)', icon: '⚡', category: 'Hardware', body: '2.5" 15 mm PCIe SSD. Hot-pluggable on supported backplanes.', gotchas: ['E1.S and U.2 are different form factors', 'Kernel names (nvme3n1) don\'t match bay numbers', 'Media errors or "Percentage Used" > 100% → replace'] },
  { id: 'kind:psu', title: 'Power supply (CRPS)', icon: '🔋', category: 'Hardware', body: 'Hot-swap 1+1 redundant PSUs. PSU1 is fed from PDU-A and PSU2 from PDU-B.', gotchas: ['Check the OTHER PSU is healthy before pulling', 'Blinking amber = no input (check the cord/PDU). Solid amber = PSU fault', 'Unplug the cord before pulling the PSU', 'AC vs -48 V DC PSUs look identical'] },
  { id: 'kind:fan', title: 'Fan module', icon: '🌀', category: 'Hardware', body: 'N+1 hot-swap fans behind the drive cage. Replacing one needs the lid open, which disturbs airflow.', gotchas: ['Swap within ~60 s of opening', 'Fan type must match the chassis configuration'] },
  { id: 'kind:dimm', title: 'DIMM (DDR5 RDIMM)', icon: '🧠', category: 'Hardware', body: 'Registered DDR5 memory, 8 channels per CPU. Silkscreen labels (DIMM_A3) map to EDAC names.', gotchas: ['Cold swap: unplug both cords and drain flea power', 'Line up the notch; never force it', 'Both latches must click closed or memory training fails', 'Match the PN exactly: a slower DIMM down-clocks the whole system', 'Expect a long first POST (memory training)'] },
  { id: 'kind:cpu', title: 'CPU + heatsink', icon: '🔲', category: 'Hardware', body: 'LGA socket processor under a screw-down heatsink.', gotchas: ['Loosen 4→3→2→1, tighten 1→2→3→4', 'Match the pin-1 triangle. Bent socket pins = new motherboard', 'Clean old paste with IPA and apply new', 'Both CPUs must be the same SKU'] },
  { id: 'kind:m2', title: 'M.2 boot drive', icon: '🧷', category: 'Hardware', body: 'Mirrored (md RAID1) pair holding the OS.', gotchas: ['22110 ≠ 2280 length', 'Check /proc/mdstat before AND after', 'Pulling the wrong one of a degraded mirror = host won\'t boot'] },
  { id: 'kind:nic', title: 'OCP 3.0 NIC', icon: '🌐', category: 'Hardware', body: 'Dual-port 25G SFP28 card in the rear OCP slot.', gotchas: ['New NIC = new MACs → update CMDB/DHCP', 'SFP28 vs QSFP cages'] },
  { id: 'kind:gpu', title: 'GPU (low-profile, Riser 1)', icon: '🎮', category: 'Hardware', body: 'Inference accelerator on a PCIe riser.', gotchas: ['Xid 79 = fell off the bus', 'lspci rev ff = device gone', 'Reseat the riser as well as the card'] },
  { id: 'kind:cmos', title: 'CMOS battery', icon: '🪙', category: 'Hardware', body: 'CR2032 coin cell. It keeps the BIOS settings and RTC alive with AC removed.', gotchas: ['Replacing it resets BIOS → PXE first, clock 2017', 'Fix the boot order and time in Setup afterwards'] },
  { id: 'tool:bmc', title: 'BMC (baseboard management controller)', icon: '📡', category: 'Tools', body: 'A tiny computer on the motherboard, on a separate OOB network. It runs on standby power: sensors, SEL, power control, console.', gotchas: ['The SEL survives OS crashes', 'Front LED stays amber until the SEL is cleared', 'BMC reset ≠ host reset'] },
  { id: 'tool:terminal', title: 'Jump host & shells', icon: '⌨️', category: 'Tools', body: 'Laptop → jump host → server OS / BMC / switch. All sessions are logged.', gotchas: ['~. kills your jump-host ssh; use ~~. to leave SOL', 'ipmitool needs -I lanplus', 'Use -E so passwords stay out of history'] },
  { id: 'tool:ticket', title: 'Ticket workflow', icon: '🎫', category: 'Process', body: 'Open → In Progress → (Waiting for Part / Customer / Escalated) → Resolved → Closed (by the requester).', gotchas: ['No work without In Progress', 'Worklog: old/new S/N + verification', 'DCO resolves; the requester closes'] },
  { id: 'tool:parts', title: 'Parts, RMA & destruction', icon: '📦', category: 'Process', body: 'Spares come from the cage. Failed parts go back to the vendor (RMA) or into secure destruction.', gotchas: ['Bag + tag every RMA part', 'Drives never go to RMA'] },
  { id: 'tool:assets', title: 'CMDB / asset lookup', icon: '🗃️', category: 'Tools', body: 'The source of truth for location, serial and asset tag… until somebody moves a server without updating it.', gotchas: ['Always scan the physical asset tag', 'Use the BMC locate LED when the location looks wrong'] },
  { id: 'tool:pdu', title: 'Rack PDUs', icon: '🔌', category: 'Hardware', body: 'Two PDUs per rack (A/B), fed from different upstream sources.', gotchas: ['80% continuous-load rule', 'A+B together must fit on ONE side', 'Trips again? Stop and call Facilities'] },
];

export const GLOSSARY: Array<[string, string]> = [
  ['BMC', 'Baseboard Management Controller: out-of-band management processor (iDRAC/iLO/XClarity-class).'],
  ['OOB', 'Out-of-band: the separate management network the BMCs live on.'],
  ['SEL', 'System Event Log: the BMC\'s hardware event log.'],
  ['SDR', 'Sensor Data Repository: the BMC\'s sensor list (ipmitool sdr).'],
  ['SOL', 'Serial-over-LAN: the serial console through the BMC.'],
  ['IPMI', 'Intelligent Platform Management Interface: the older protocol for BMCs (ipmitool).'],
  ['Redfish', 'Modern REST API for BMCs.'],
  ['FRU', 'Field Replaceable Unit: any part you can swap on site.'],
  ['DCO / DCT', 'Datacenter Operations / Technician.'],
  ['ToR', 'Top-of-Rack switch.'],
  ['DAC / AOC', 'Direct-Attach Copper / Active Optical Cable.'],
  ['SMF / MMF', 'Single-mode (yellow) / multi-mode (aqua/OM4) fiber.'],
  ['LLDP', 'Link Layer Discovery Protocol: tells you which switch port you are plugged into.'],
  ['PDU', 'Power Distribution Unit: the rack power strip, A and B sides.'],
  ['CMA', 'Cable Management Arm.'],
  ['U', 'Rack unit = 1.75" (44.45 mm). Counted from the bottom.'],
  ['RMA', 'Return Merchandise Authorization: sending a failed part back to the vendor.'],
  ['CMDB', 'Configuration Management Database: asset inventory and locations.'],
  ['SLA', 'Service Level Agreement: the time you have to resolve a ticket.'],
  ['Drain', 'Moving workloads off a host so it can be safely taken down.'],
  ['ECC CE/UE', 'Correctable / uncorrectable memory errors.'],
  ['MCE', 'Machine Check Exception: a CPU-reported hardware error.'],
  ['POST', 'Power-On Self Test (BIOS init, memory training).'],
  ['PXE', 'Network boot.'],
  ['EPO', 'Emergency Power Off: kills the whole room. Emergencies only.'],
  ['ESD', 'Electrostatic discharge.'],
  ['JBOD', 'Just a Bunch Of Disks: no hardware RAID.'],
];

export const CHEATSHEETS: Array<{ title: string; lines: string[] }> = [
  { title: 'T568B (pin 1 → 8, clip away from you)', lines: ['1 White/Orange', '2 Orange', '3 White/Green', '4 Blue', '5 White/Blue', '6 Green', '7 White/Brown', '8 Brown'] },
  { title: 'ipmitool from the jump host', lines: ['ipmitool -I lanplus -H <host>-bmc -U admin -E chassis status', '… sel elist | sel clear | sdr | sdr type Fan | fru', '… chassis power status|on|soft|cycle', '… chassis identify force   (locate LED)', '… mc reset cold   (BMC only)', '… sol activate   (exit with ~~.)'] },
  { title: 'Linux triage', lines: ['sudo dmesg -T | tail -50', 'journalctl -p err -b    |  journalctl -b -1', 'lsblk -o NAME,SERIAL,SIZE,MODEL', 'sudo smartctl -H /dev/sdX', 'cat /proc/mdstat', 'sudo ras-mc-ctl --error-count', 'ip -br link ; ethtool eth0 ; sudo lldpctl', 'sudo ledctl locate=/dev/sdX'] },
  { title: 'LEDs', lines: ['Health: green OK, amber warning/unacked SEL, blinking amber critical', 'PSU: green OK, blinking amber = no AC input, solid amber = PSU fault', 'Drive: blinking green = activity, amber = fault, blinking = locate', 'Blue blinking = chassis locate/UID'] },
];
