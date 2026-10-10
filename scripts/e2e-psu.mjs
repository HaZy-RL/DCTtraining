// End-to-end: complete a PSU hot-swap through the real UI, and render a server interior.
// Usage: npm run build && node scripts/e2e-psu.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const port = 4320;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const S = (fn, arg) => page.evaluate(fn, arg);
const click = async (name) => {
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(250);
};
let result = 'unknown';
try {
  await page.goto(`http://localhost:${port}/DCTtraining/`, { waitUntil: 'networkidle' });
  await S(() => window.__DCT__.getState().start('hw-psu', 'practice', 4242));
  await click(/Clock in/);
  // ticket → In Progress
  await click('→ In Progress');
  await page.locator('.side-head button').click();
  const info = await S(() => {
    const st = window.__DCT__.getState();
    const d = st.world.devices[st.inst.focusDeviceId];
    const slot = Object.entries(d.slots).find(([, c]) => c && c.failure)[0];
    return { slot, dev: d.id, rack: d.rackId, pn: d.slots[slot].partNumber };
  });
  console.log('fault', info);
  await click(/Walk to/);
  await click(/Scan asset tag/);
  await click(/Rear \(hot aisle\)/);
  // select failed PSU via the "jump to a part" dropdown
  await page.locator('.inspector select').last().selectOption(info.slot);
  await page.waitForTimeout(1500);
  await shot('30-psu-selected');
  // From the rear: flip the cord bail, unplug, press the release tab, pull
  await click(/Bail on · flip off/);
  await click('Unplug');
  await page.locator('.inspector .fastener', { hasText: 'Green release tab' }).getByRole('button', { name: 'Release' }).click();
  await page.waitForTimeout(250);
  await click(/Pull PSU out/);
  // install the matching spare
  const row = page.locator('.inspector .row', { hasText: info.pn }).first();
  await row.getByRole('button', { name: 'Install' }).click();
  await page.waitForTimeout(300);
  // plug the cord into the right PDU side
  const side = info.slot === 'PSU1' ? 'A' : 'B';
  const sel = page.locator('.inspector select', { hasText: 'choose outlet' }).first();
  const opt = await sel.locator('option', { hasText: `PDU-${side}` }).first().getAttribute('value');
  await sel.selectOption(opt);
  await click('Plug in');
  await click(/Bail OFF · snap on/);
  await page.waitForTimeout(800);
  await shot('31-psu-replaced');
  // verify via BMC, clear SEL, bag/tag/RMA, worklog, resolve
  await page.locator('.dock button', { hasText: 'BMC' }).click();
  await click('Sensors');
  await click('Event Log');
  await click(/Clear log/);
  await page.locator('.dock button', { hasText: 'Parts' }).click();
  await click('ESD bag');
  await click('Defect tag');
  await click('→ RMA bin');
  const old = await S(() => window.__DCT__.getState().world.bins.rma[0]?.serial);
  const neu = await S((slot) => { const st = window.__DCT__.getState(); return st.world.devices[st.inst.focusDeviceId].slots[slot].serial; }, info.slot);
  await page.locator('.dock button', { hasText: 'Tickets' }).click();
  await page.locator('textarea').first().fill(`Replaced ${info.slot}. Old S/N ${old}, new S/N ${neu}, PN ${info.pn}. Verified PS redundancy restored in BMC; SEL reviewed and cleared. Old PSU bagged/tagged to RMA.`);
  await click(/Add worklog/);
  await click('→ Resolved');
  await shot('32-ticket-resolved');
  await click(/Finish & review/);
  await page.waitForTimeout(600);
  await shot('33-review');
  result = await S(() => { const r = window.__DCT__.getState().result; return `${r.rating} ${r.pct}% penalties=${r.penaltyPoints} missed=${r.steps.filter((s) => !s.done).map((s) => s.id).join(',')}`; });

  // Interior render: DIMM scenario, fast-forward state via actions
  await S(() => window.__DCT__.getState().start('hw-dimm', 'learn', 777));
  await click(/Clock in/);
  await S(() => {
    const st = window.__DCT__.getState();
    const id = st.inst.focusDeviceId;
    const d = st.world.devices[id];
    const key = Object.keys(st.world.tickets)[0];
    const A = (a) => window.__DCT__.getState().dispatch(a);
    A({ type: 'ticketTransition', key, to: 'In Progress' });
    A({ type: 'walk', to: d.rackId });
    A({ type: 'scanAsset', deviceId: id });
    A({ type: 'esd', on: true });
    A({ type: 'fastener', deviceId: id, target: 'chassis', id: 'earL', secure: false });
    A({ type: 'fastener', deviceId: id, target: 'chassis', id: 'earR', secure: false });
    A({ type: 'servicePosition', deviceId: id, out: true });
    A({ type: 'fastener', deviceId: id, target: 'lid', id: 'screw', secure: false });
    A({ type: 'fastener', deviceId: id, target: 'lid', id: 'latch', secure: false });
    A({ type: 'layer', deviceId: id, layer: 'lid', install: false });
    st.setPanel(null);
    st.select({ deviceId: id, rackId: d.rackId });
  });
  await page.waitForTimeout(2500);
  await shot('34-interior-shroud');
  await S(() => {
    const st = window.__DCT__.getState();
    st.dispatch({ type: 'layer', deviceId: st.inst.focusDeviceId, layer: 'shroud', install: false });
  });
  await page.waitForTimeout(1200);
  await shot('35-interior-dimms');
  // CPU heatsink screws close-up
  await S(() => {
    const st = window.__DCT__.getState();
    st.select({ deviceId: st.inst.focusDeviceId, slot: 'heatsink:CPU0', rackId: st.world.devices[st.inst.focusDeviceId].rackId });
  });
  await page.waitForTimeout(1200);
  await shot('36-heatsink');
  // Walk mode
  await click(/Walk mode/);
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  await shot('37-walk-mode');
  // Main menu (bright theme)
  await S(() => window.__DCT__.getState().quit());
  await S(() => window.__DCT__.getState().go({ name: 'menu' }));
  await page.waitForTimeout(600);
  await shot('38-menu');
} catch (e) {
  errors.push('SCRIPT: ' + e.message);
  await shot('98-e2e-failure').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log('RESULT:', result);
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'NO CONSOLE ERRORS');
process.exit(errors.length ? 1 : 0);
