// M5 — Linux for DCTs: find-the-fault puzzles answered in the Findings panel.
import { injectFault } from '../engine/faults';
import { makeTicket } from '../engine/procedure';
import { cableAt, edacName } from '../engine/projectors';
import type { ScenarioDef, ScenarioInstance, Step } from '../engine/scenario';
import { pickServer, standardWorld } from './common';
import { finding, findingStep, norm } from './helpers';

function linuxInst(base: Omit<ScenarioInstance, 'tools' | 'scene' | 'startTool'>): ScenarioInstance {
  return { ...base, tools: ['terminal', 'ticket', 'notes'], scene: 'none', startTool: 'terminal' };
}

const sshStep = (devId: string, host: string): Step => ({
  id: 'ssh',
  text: `From the jump host: ssh ${host}`,
  why: 'Servers are only reachable through the jump host (bastion). Every session is logged.',
  points: 5,
  required: true,
  done: (w) => !!w.flags[`ssh:${devId}`],
});

export const linuxScenarios: ScenarioDef[] = [
  {
    id: 'lx-basics',
    module: 'linux',
    title: 'Linux basics for techs',
    summary: 'Get around a production host: identity, uptime, sudo, pipes and grep, plus reading the hardware inventory.',
    difficulty: 1,
    tags: ['sudo', 'pipes', 'dmidecode'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      makeTicket(s.w, s.rng, dev, { priority: 'P4', type: 'Investigation', summary: `[TRAINING] Inventory check ${dev.hostname}`, description: 'Collect basic inventory facts from the host.' });
      return linuxInst({
        world: s.w,
        title: 'Linux basics for techs',
        briefing: `Log into ${dev.hostname} through the jump host and answer the questions in the Findings panel. Type \`help\` in any shell for a cheat-sheet. Hardware tools need \`sudo\`.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          findingStep('serial', 'System serial number (dmidecode)', 10, 'Compare the chassis serial to the ticket every time. It is how you make sure you are on the right box.'),
          findingStep('mem', 'Total memory installed in GB', 10),
          findingStep('dimms', 'How many DIMM slots are populated?', 10),
          findingStep('kernel', 'Running kernel version', 5),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: 'Practice run, no fault.',
        expertPath: [`ssh ${dev.hostname}`, 'sudo dmidecode -s system-serial-number', 'free -g   (or: sudo dmidecode -t memory | grep Size: | grep -c GB)', 'uname -r  (or uname -a)'],
        bench: {
          findings: [
            finding('serial', 'System serial number', [dev.serial], `It is ${dev.serial}. \`sudo dmidecode -s system-serial-number\`.`),
            finding('mem', 'Total memory (GB)', (x) => ['1024', '1 tb', '1tb', '1024gb', '1024 gb'].includes(norm(x)), '16 × 64 GB = 1024 GB. `free -g` shows slightly less (kernel-reserved memory).'),
            finding('dimms', 'Populated DIMM slots', ['16'], '`sudo dmidecode -t memory | grep -c "Size: 64 GB"` → 16.'),
            finding('kernel', 'Kernel version', ['6.8.0-45-generic', '6.8.0-45'], '`uname -r` → 6.8.0-45-generic'),
          ],
        },
      });
    },
  },
  {
    id: 'lx-disk',
    module: 'linux',
    title: 'Which disk is dying?',
    summary: 'A storage node has a drive in SMART predictive failure. Find it by kernel name, serial and bay, and never trust /dev/sdX.',
    difficulty: 2,
    tags: ['smartctl', 'lsblk', 'ledctl', 'gotcha'],
    minutes: 8,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2412s');
      const f = injectFault(s.w, s.rng, dev, 'hdd_predictive');
      const c = dev.slots[f.slot!]!;
      const name = dev.osNames[f.slot!];
      makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Investigation', summary: `[DISK] SMART warning on ${dev.hostname}`, description: 'Storage service reports one disk with growing reallocated sectors. Identify it precisely for the replacement ticket.' });
      return linuxInst({
        world: s.w,
        title: 'Which disk is dying?',
        briefing: `One of ${dev.hostname}'s 12 HDDs is failing. Find it, and get its serial and physical bay right. Linux names (sda, sdb…) are not in bay order on this box.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          findingStep('dev', 'Kernel device name of the failing disk', 10),
          findingStep('serial', 'Its serial number', 15, 'The serial is the one identifier that never changes. Kernel names can move after a reboot or a hot-plug.'),
          { id: 'locate', text: 'Blink its bay LED (sudo ledctl locate=/dev/…)', points: 10, required: true, done: (w) => !!w.flags[`drive_locate:${dev.id}:${f.slot}`] },
          findingStep('bay', 'Which physical bay is it in? (BMC → Storage, or the blinking LED in the rack view)', 10),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['lsblk -o NAME,SERIAL,SIZE,MODEL', 'for d in each disk: sudo smartctl -H /dev/sdX (or -a and look at Reallocated_Sector_Ct / Current_Pending_Sector)', `sudo ledctl locate=/dev/${name}`, 'Map the serial to the bay with the BMC Storage page'],
        bench: {
          findings: [
            finding('dev', 'Kernel name (e.g. sdc)', [name], `/dev/${name}`),
            finding('serial', 'Serial number', [c.serial], c.serial),
            finding('bay', 'Physical bay', [f.slot!, f.slot!.replace('BAY', 'bay '), f.slot!.replace('BAY', '')], `${f.slot}: note that it doesn't line up with /dev/${name}!`),
          ],
        },
      });
    },
  },
  {
    id: 'lx-memory',
    module: 'linux',
    title: 'Correctable ECC storm: which DIMM?',
    summary: 'A host logs thousands of correctable memory errors. Find the DIMM label from the EDAC/RAS tools.',
    difficulty: 2,
    tags: ['edac', 'ras-mc-ctl', 'dmesg'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const f = injectFault(s.w, s.rng, dev, 'dimm_ce_storm');
      makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Investigation', summary: `[MEM] CE rate high on ${dev.hostname}`, description: 'Memory correctable error rate above threshold. Identify the DIMM for predictive replacement.' });
      return linuxInst({
        world: s.w,
        title: 'Correctable ECC storm',
        briefing: `${dev.hostname} is logging a flood of correctable ECC errors. That predicts an uncorrectable error and a crash. Find which DIMM.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          { id: 'dmesg', text: 'Look at the kernel log (sudo dmesg -T | grep -i edac)', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:logs`] },
          findingStep('dimm', 'DIMM label with the errors', 20, 'EDAC prints CPU_SrcID / MC / Chan. `ras-mc-ctl --error-count` translates that to the silkscreen label (DIMM_A3) you will see on the board.'),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['sudo dmesg -T | grep -i edac', `→ ${edacName(f.slot!)}`, `sudo ras-mc-ctl --error-count | sort -k2 -n | tail`, `→ ${f.slot}`],
        bench: { findings: [finding('dimm', 'DIMM label', [f.slot!, f.slot!.replace('DIMM_', '')], `${f.slot} (${edacName(f.slot!)})`, 'e.g. DIMM_B2')] },
      });
    },
  },
  {
    id: 'lx-network',
    module: 'linux',
    title: 'One link down',
    summary: 'A host lost one of its two uplinks and the bond is degraded. Find which interface, which switch port it should be on, and why.',
    difficulty: 3,
    tags: ['ip', 'ethtool', 'lldp', 'bond'],
    minutes: 8,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const cable = cableAt(s.w, dev.id, 'nic0p1')!;
      cable.condition = 'damaged';
      const swp = cable.b!.port;
      makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Investigation', summary: `[NET] Bond degraded on ${dev.hostname}`, description: 'bond0 running on one slave. Identify the failed link and gather evidence for the cabling ticket.' });
      return linuxInst({
        world: s.w,
        title: 'One link down',
        briefing: `${dev.hostname}'s bond0 is running on one leg. Work out which NIC port is down and which switch port it lands on. LLDP only works on links that are up, so you'll need to deduce the far end.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          findingStep('ifc', 'Which interface is down?', 10),
          { id: 'ethtool', text: 'Check the physical layer with ethtool', points: 5, required: false, done: (w) => !!w.flags[`viewed:${dev.id}:network`] },
          findingStep('lldp', 'Which switch does the working link land on? (LLDP)', 10),
          findingStep('swp', 'Which switch port should the broken link be on? (Hint: cable labels / cut sheet: P1 → port N+24)', 15),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: `The DAC on eth1 (→ ${swp}) is physically damaged. Link down, no LLDP.`,
        expertPath: ['ip -br link → eth1 DOWN', 'ethtool eth1 → Link detected: no', 'sudo lldpctl → eth0 neighbor = ToR, port swpN', 'P1 cabling convention / cable label → swp(N+24)'],
        bench: {
          findings: [
            finding('ifc', 'Down interface', ['eth1'], 'eth1 (nic0p1)'),
            finding('lldp', 'Switch hostname', [s.w.devices[cable.b!.deviceId].hostname], s.w.devices[cable.b!.deviceId].hostname),
            finding('swp', 'Switch port', [swp], `${swp}, by the rack cabling standard and the cable label.`),
          ],
        },
      });
    },
  },
  {
    id: 'lx-raid',
    module: 'linux',
    title: 'Degraded boot mirror',
    summary: 'The OS boot RAID1 is degraded. Read /proc/mdstat and mdadm to work out which member is missing.',
    difficulty: 2,
    tags: ['mdadm', 'raid1', 'boot'],
    minutes: 5,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const f = injectFault(s.w, s.rng, dev, 'm2_failed');
      makeTicket(s.w, s.rng, dev, { priority: 'P3', type: 'Investigation', summary: `[RAID] md1 degraded on ${dev.hostname}`, description: 'Boot mirror degraded. Identify the failed member.' });
      return linuxInst({
        world: s.w,
        title: 'Degraded boot mirror',
        briefing: `The boot mirror on ${dev.hostname} lost a disk. Find out which one, before the other one dies too.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          { id: 'mdstat', text: 'cat /proc/mdstat', points: 10, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:raid`] },
          findingStep('member', 'Which NVMe device dropped out of the mirror?', 15),
          findingStep('slot', 'Which physical M.2 slot is that? (M2_0 / M2_1)', 10),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['cat /proc/mdstat → [U_] or [_U]', 'sudo mdadm --detail /dev/md1 → "removed"', 'sudo dmesg | grep md → "Disk failure on nvmeXn1p2"', 'nvme0n1 = M2_0, nvme1n1 = M2_1'],
        bench: {
          findings: [
            finding('member', 'Failed member', [dev.osNames[f.slot!]], dev.osNames[f.slot!]),
            finding('slot', 'M.2 slot', [f.slot!], f.slot!),
          ],
        },
      });
    },
  },
  {
    id: 'lx-gpu',
    module: 'linux',
    title: 'GPU fell off the bus',
    summary: 'An inference job died. Confirm the GPU fault from Linux, record the Xid and PCI address for the hardware ticket.',
    difficulty: 3,
    tags: ['gpu', 'xid', 'lspci'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      const f = injectFault(s.w, s.rng, dev, 'gpu_fell_off_bus');
      makeTicket(s.w, s.rng, dev, { priority: 'P2', type: 'Investigation', summary: `[GPU] Job failures on ${dev.hostname}`, description: 'Scheduler reports GPU jobs failing on this node.' });
      return linuxInst({
        world: s.w,
        title: 'GPU fell off the bus',
        briefing: `GPU jobs keep failing on ${dev.hostname}. Prove whether the GPU is the problem, and collect the identifiers the vendor will ask for.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          { id: 'smi', text: 'Run nvidia-smi', points: 5, required: true, done: (w) => !!w.flags[`viewed:${dev.id}:gpu`] },
          findingStep('xid', 'Xid error number in the kernel log', 15, 'Xid 79 = "GPU has fallen off the bus". It is almost always hardware: a seating, riser or GPU fault.'),
          findingStep('pci', 'PCI bus address of the GPU', 10),
          findingStep('rev', 'What does lspci show as the revision, and why does it matter?', 10),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: f.rootCause,
        expertPath: ['nvidia-smi → "No devices were found"', 'sudo dmesg -T | grep -i xid → Xid 79', 'lspci | grep -i nvidia → ca:00.0 … (rev ff)', 'rev ff = config space reads all 1s: the device is gone from the bus'],
        bench: {
          findings: [
            finding('xid', 'Xid number', ['79'], 'Xid 79'),
            finding('pci', 'PCI address', ['ca:00.0', '0000:ca:00.0', 'ca:00'], '0000:ca:00.0'),
            finding('rev', 'Revision', (x) => /ff/i.test(x), '"rev ff" means the device config space reads all 1s, so the card has dropped off the bus.'),
          ],
        },
      });
    },
  },
  {
    id: 'lx-rofs',
    module: 'linux',
    title: 'Read-only root filesystem',
    summary: 'Services are failing on a host. Find out why, and decide what DCO should do next.',
    difficulty: 3,
    tags: ['ext4', 'journal', 'escalation'],
    minutes: 6,
    build: (seed) => {
      const s = standardWorld(seed);
      const dev = pickServer(s, 'hx-2208c');
      dev.os = 'readonly_fs';
      dev.quirks.push('readonly_fs');
      const tk = makeTicket(s.w, s.rng, dev, { priority: 'P2', type: 'Investigation', summary: `[OS] services failing on ${dev.hostname}`, description: 'node-agent and journald failing on this host. Investigate.' });
      return linuxInst({
        world: s.w,
        title: 'Read-only root filesystem',
        briefing: `${tk.key}: services on ${dev.hostname} keep failing. Find the cause in the logs.`,
        steps: [
          sshStep(dev.id, dev.hostname),
          findingStep('fs', 'Which filesystem/device went read-only?', 15),
          findingStep('next', 'What is the right next step for DCO? (a) reboot it, (b) fsck it live, (c) check the boot disks/mirror and escalate to the OS/SRE owner with evidence', 15),
        ],
        focusDeviceId: dev.id,
        focusRackId: s.rackId,
        rootCause: 'The root filesystem (md1) hit journal errors and the kernel remounted it read-only to protect the data. That usually means an underlying disk or controller problem.',
        expertPath: ['touch /tmp/x → Read-only file system', 'sudo dmesg | grep -i ext4 → "Remounting filesystem read-only"', 'cat /proc/mdstat, smartctl on members', 'Escalate to the service/OS owner with evidence. Don\'t reboot a production host on your own.'],
        bench: {
          findings: [
            finding('fs', 'Filesystem', (x) => /md1|\/|root/i.test(x), 'md1, mounted at /'),
            finding('next', 'Next step (a/b/c)', (x) => /^c/i.test(x.trim()) || /escalat/i.test(x), '(c). Rebooting or a live fsck can destroy evidence or data. Gather facts and escalate.'),
          ],
        },
      });
    },
  },
];
