// Vendor tracks: every hardware drill on Dell, HPE, Supermicro and Lenovo racks.
import type { ScenarioDef } from '../engine/scenario';
import { VENDOR_IDS } from '../engine/vendors';
import { drillScenario, DRILLS } from './hardware';

export const vendorScenarios: ScenarioDef[] = VENDOR_IDS.flatMap((v) => DRILLS.map((d) => drillScenario(d, v)));
