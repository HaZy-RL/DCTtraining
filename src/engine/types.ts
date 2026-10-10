// Core world model for the datacenter simulation.
// Everything the trainee sees (BMC, Linux, 3D, tickets) is a projection of World.

export type ComponentKind =
  | 'cpu'
  | 'dimm'
  | 'psu'
  | 'fan'
  | 'hdd'
  | 'nvme'
  | 'm2'
  | 'nic'
  | 'gpu'
  | 'cmos'
  | 'heatsink';

export type Health = 'ok' | 'degraded' | 'failed';

/** Failure modes drive what each projector (SEL, dmesg, LEDs…) emits. */
export type FailureMode =
  | 'dimm_ce_storm'
  | 'dimm_uce'
  | 'hdd_failed'
  | 'hdd_predictive' // SMART reallocated/pending sectors climbing
  | 'nvme_missing'
  | 'nvme_media_errors'
  | 'psu_failed'
  | 'psu_no_input' // PSU fine, cord/PDU problem
  | 'fan_failed'
  | 'cpu_ierr'
  | 'cmos_low'
  | 'm2_failed'
  | 'nic_hw_fault'
  | 'gpu_fell_off_bus'
  | 'gpu_thermal';

export interface SmartData {
  powerOnHours: number;
  reallocated: number;
  pending: number;
  uncorrectable: number;
  wearPct?: number; // SSD/NVMe percentage used
  tempC: number;
}

export interface Component {
  uid: string;
  kind: ComponentKind;
  partNumber: string;
  serial: string;
  health: Health;
  failure?: FailureMode;
  smart?: SmartData;
  firmware?: string;
  /** Seated state after insertion; latch/screws must be closed for 'ok'. */
  seated: boolean;
  /** Data-bearing parts (drives) must go to secure destruction, never RMA. */
  dataBearing?: boolean;
  /** Bagged in ESD bag (only meaningful for removed parts). */
  bagged?: boolean;
  /** Tagged with RMA / defective tag. */
  tagged?: boolean;
  /** Where a removed part came from (while in the trainee's tray). */
  fromSlot?: string;
  fromDevice?: string;
}

export type SlotAccess = 'front' | 'rear' | 'internal';

export interface SlotDef {
  id: string; // e.g. "DIMM_A1", "PSU1", "BAY3", "FAN2"
  kind: ComponentKind;
  access: SlotAccess;
  hotSwap: boolean;
  /** Other parts that must be removed first (e.g. shroud, heatsink, riser). */
  requires?: Array<'lid' | 'shroud' | 'heatsink' | 'riser1' | 'riser2'>;
  label: string;
  /** Linux-visible name hints (e.g. /dev/sdc, nvme2n1, eth0) */
  osName?: string;
  /** For DIMMs: which CPU/memory controller. */
  cpu?: number;
  channel?: string;
}

export type PowerState = 'off' | 'standby' | 'posting' | 'on' | 'crashed';
export type OsState = 'down' | 'booting' | 'up' | 'panic' | 'grub_rescue' | 'pxe_loop' | 'readonly_fs';

export interface SelEntry {
  id: number;
  t: number; // sim seconds
  sensor: string;
  event: string;
  dir: 'Asserted' | 'Deasserted';
  severity: 'info' | 'warning' | 'critical';
}

export interface Device {
  id: string;
  model: string; // ServerModel id
  role: 'server' | 'switch' | 'mgmt_switch' | 'patch_panel';
  hostname: string;
  serial: string;
  assetTag: string;
  rackId: string | null;
  u: number | null; // lowest U occupied
  heightU: number;
  weightKg: number;
  powerW: number;
  power: PowerState;
  os: OsState;
  bootAt?: number; // sim time when POST began
  slots: Record<string, Component | null>;
  /** Removable mechanical layers. true = installed. */
  layers: { lid: boolean; shroud: boolean; riser1: boolean; riser2: boolean };
  /** Per-CPU heatsink installed. */
  heatsinks: Record<string, boolean>;
  /** DIMM/drive latch state; open latches = can remove. */
  latches: Record<string, 'open' | 'closed'>;
  servicePosition: boolean; // slid out on rails
  powerCords: Record<string, string | null>; // PSU slot id -> PDU outlet id
  sel: SelEntry[];
  selSeq: number;
  locateLed: boolean;
  bmc: { ip: string; mac: string; responsive: boolean; fw: string };
  /** Released (drained) to DCO for maintenance by the service owner. */
  drained: boolean;
  bootOrder: string[];
  /** MACs per NIC port, by "nic0p0" style id */
  macs: Record<string, string>;
  /** Linux device name per slot (deliberately not in bay order). */
  osNames: Record<string, string>;
  /** Free-form fault flags not attached to a component (e.g. bios config). */
  quirks: string[];
}

export interface Pdu {
  id: string; // "R12-PDU-A"
  side: 'A' | 'B';
  breakerAmps: number;
  volts: number;
  outlets: number;
  /** outlet index -> tripped etc */
  breakerTripped: boolean;
}

export interface Rack {
  id: string;
  location: string; // "PHX1-H2-R03-C07"
  row: string;
  position: number;
  heightU: number;
  pdus: Pdu[];
  maxWeightKg: number;
  /** U positions where rails are installed: key = bottom U, value = hole offset (0 = aligned) */
  rails: Record<number, { heightU: number; holeOffset: number }>;
}

export type CableType = 'cat6' | 'dac' | 'aoc' | 'fiber_smf' | 'fiber_mmf' | 'power_c13' | 'power_c19';

export interface PortRef {
  deviceId: string;
  port: string; // "nic0p0", "bmc", "swp12", "mgmt5"
}

export interface Cable {
  id: string;
  type: CableType;
  a: PortRef | null;
  b: PortRef | null;
  lengthM: number;
  labelA?: string;
  labelB?: string;
  condition: 'ok' | 'damaged' | 'dirty' | 'bad_termination';
}

export type TicketStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting for Part'
  | 'Waiting for Customer'
  | 'Escalated'
  | 'Resolved'
  | 'Closed';

export interface Worklog {
  t: number;
  author: string;
  text: string;
  kind: 'comment' | 'worklog' | 'system';
}

export interface Ticket {
  key: string;
  type: 'Hardware Repair' | 'Rack & Stack' | 'Cabling' | 'Investigation' | 'Decommission' | 'Break/Fix';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: TicketStatus;
  summary: string;
  description: string;
  reporter: string;
  assignee: string | null;
  hostname?: string;
  assetTag?: string;
  serial?: string;
  location?: string;
  createdAt: number;
  slaDueAt: number;
  worklogs: Worklog[];
  linkedRma?: string;
  partRequested?: string;
  hostState: 'In Production' | 'Drain Requested' | 'Drained';
  labels: string[];
}

export interface SparePart {
  component: Component;
  label: string; // human label shown on the bag/box
  location: 'cart' | 'cage';
}

export type BinKind = 'rma' | 'secure_destruction' | 'ewaste';

export interface Penalty {
  t: number;
  points: number;
  rule: string;
  reason: string;
  safety: boolean;
}

export interface Trainee {
  name: string;
  location: string | null; // rackId or 'noc' / 'cage'
  esdStrap: boolean;
  /** Components the trainee flagged as faulty: "deviceId:slot" */
  flagged: string[];
  notes: string;
  /** Removed parts currently in hand/tray */
  tray: Component[];
  liftAssist: boolean;
}

export interface PendingEvent {
  at: number;
  type: 'post_complete' | 'os_up' | 'drain_approved' | 'part_arrives' | 'bmc_reset_done' | 'thermal_check' | 'ticket_arrives';
  deviceId?: string;
  ticketKey?: string;
  payload?: Record<string, unknown>;
}

export interface LogEntry {
  t: number;
  action: string;
  detail: string;
  ok: boolean;
}

export interface World {
  seed: number;
  t: number; // sim seconds since scenario start
  site: string;
  racks: Record<string, Rack>;
  devices: Record<string, Device>;
  cables: Record<string, Cable>;
  tickets: Record<string, Ticket>;
  /** Tickets that arrive later (Shift Mode). Released by 'ticket_arrives' events. */
  ticketQueue: Ticket[];
  spares: SparePart[];
  bins: Record<BinKind, Component[]>;
  trainee: Trainee;
  pending: PendingEvent[];
  penalties: Penalty[];
  /** First and last time a named flag was set. Used by objective checks. */
  flags: Record<string, { first: number; last: number; count: number }>;
  log: LogEntry[];
  /** Messages for UI toasts (consumed by UI). */
  toasts: Array<{ id: number; t: number; kind: 'info' | 'warn' | 'error' | 'success'; text: string }>;
  toastSeq: number;
  /** Ids of devices that the scenario's fault applies to (for AAR). */
  meta: Record<string, string | number | boolean>;
}
