// Registry of training modules and their scenarios.
import type { ModuleId, ScenarioDef } from '../engine/scenario';
import { cablingScenarios } from './cabling';
import { floorScenarios } from './floor';
import { hardwareScenarios } from './hardware';
import { linuxScenarios } from './linux';
import { oobScenarios } from './oob';
import { rackstackScenarios } from './rackstack';
import { safetyScenarios } from './safety';
import { shiftScenarios } from './shift';
import { ticketingScenarios } from './ticketing';
import { troubleshootScenarios } from './troubleshoot';

export interface ModuleInfo {
  id: ModuleId;
  title: string;
  blurb: string;
  icon: string;
  color: string;
}

export const MODULES: ModuleInfo[] = [
  { id: 'hardware', title: 'Hardware Replacement', blurb: 'Swap every common FRU: drives, PSUs, fans, DIMMs, CPUs, NICs, GPUs, boot drives, CMOS.', icon: '🔧', color: '#4fd1c5' },
  { id: 'troubleshoot', title: 'Troubleshooting', blurb: 'Vague tickets, red herrings and hidden root causes, worked end to end.', icon: '🩺', color: '#f6ad55' },
  { id: 'oob', title: 'Out-of-Band / BMC', blurb: 'SEL, sensors, ipmitool, Redfish, serial console and BIOS, all without touching the box.', icon: '📡', color: '#63b3ed' },
  { id: 'linux', title: 'Linux for DCTs', blurb: 'dmesg, smartctl, lsblk, mdstat, ethtool, LLDP, EDAC: find the fault from the OS.', icon: '🐧', color: '#9ae6b4' },
  { id: 'cabling', title: 'Cabling & Termination', blurb: 'RJ45 crimping, fiber inspect/clean/polarity, cut-sheet patching, A/B power.', icon: '🔌', color: '#fbd38d' },
  { id: 'rackstack', title: 'Rack & Stack', blurb: 'Rails and U boundaries, safe lifting, power budgets, full builds and decommissions.', icon: '🗄️', color: '#b794f4' },
  { id: 'ticketing', title: 'Ticketing & Workflow', blurb: 'Triage, worklogs, Waiting for Part, and escalating to the right team.', icon: '🎫', color: '#f687b3' },
  { id: 'safety', title: 'Safety & Security', blurb: 'Spot the hazards, ESD, lifting, EPO, tailgating and data-bearing media.', icon: '🦺', color: '#fc8181' },
  { id: 'floor', title: 'Floor Navigation', blurb: 'Location codes, U numbering, hot and cold aisles, finding racks fast.', icon: '🗺️', color: '#90cdf4' },
  { id: 'shift', title: 'Shift Mode', blurb: 'The capstone: a live ticket queue, SLAs, a P1 page and a handoff.', icon: '⏱️', color: '#f6e05e' },
];

export const SCENARIOS: ScenarioDef[] = [
  ...hardwareScenarios,
  ...troubleshootScenarios,
  ...oobScenarios,
  ...linuxScenarios,
  ...cablingScenarios,
  ...rackstackScenarios,
  ...ticketingScenarios,
  ...safetyScenarios,
  ...floorScenarios,
  ...shiftScenarios,
];

export function scenariosFor(m: ModuleId): ScenarioDef[] {
  return SCENARIOS.filter((s) => s.module === m);
}

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
