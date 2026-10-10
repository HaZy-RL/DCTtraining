// Headless smoke test of the production build.
// Usage: npm run build && node scripts/smoke.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const port = 4319;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));

const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const base = `http://localhost:${port}/DCTtraining/`;

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await shot('01-menu');
  await page.getByText('Hardware Replacement').first().click();
  await shot('02-module');
  // DIMM drill, learn mode
  await page.getByRole('button', { name: /Learn/ }).click();
  const card = page.locator('.card.scenario', { hasText: 'Replace a DIMM' });
  await card.getByRole('button', { name: /Start/ }).click();
  await page.waitForSelector('.modal');
  await shot('03-briefing');
  await page.getByRole('button', { name: /Clock in/ }).click();
  await page.waitForTimeout(3500);
  await shot('04-rack-scene');
  // open terminal and run some commands
  await page.locator('.dock button', { hasText: 'Terminal' }).click();
  await page.waitForTimeout(500);
  await page.locator('.term-body').click();
  const host = await page.evaluate(() => {
    const t = document.querySelector('.tk b')?.textContent;
    return t;
  });
  await page.keyboard.type('help\r', { delay: 5 });
  await page.waitForTimeout(300);
  await shot('05-terminal-help');
  // BMC tool
  await page.locator('.dock button', { hasText: 'BMC' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Event Log' }).click();
  await page.waitForTimeout(400);
  await shot('06-bmc-sel');
  await page.getByRole('button', { name: 'Inventory' }).click();
  await page.waitForTimeout(300);
  await shot('07-bmc-inventory');
  // ticket
  await page.locator('.dock button', { hasText: 'Tickets' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '→ In Progress' }).click();
  await shot('08-ticket');
  // click the focus server in 3D: use the "Rack view" then walk
  await page.locator('.dock button', { hasText: 'Tickets' }).click();
  await page.getByRole('button', { name: /Walk here/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot('09-walked');
  await page.getByRole('button', { name: /Rear/ }).click();
  await page.waitForTimeout(2000);
  await shot('10-rear');
  // finish -> review
  await page.getByRole('button', { name: /End & review|Finish/ }).click();
  await page.waitForTimeout(800);
  await shot('11-review');
  void host;

  // Other scenes
  for (const [mod, title, name] of [
    ['Cabling', 'Terminate an RJ45', 'rj45'],
    ['Cabling', 'Fiber: inspect', 'fiber'],
    ['Safety', 'Spot the hazards', 'hazard'],
    ['Floor Navigation', 'Find the rack', 'floor'],
    ['Rack & Stack', 'Rails, U boundaries', 'rackbuild'],
    ['Ticketing', 'Triage the queue', 'triage'],
    ['Safety', 'Safety & security knowledge', 'quiz'],
    ['Out-of-Band', 'PXE boot loop', 'oob-pxe'],
  ]) {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.zone', { hasText: mod }).first().click();
    await page.locator('.card.scenario', { hasText: title }).getByRole('button', { name: /Start/ }).click();
    await page.getByRole('button', { name: /Clock in/ }).click();
    await page.waitForTimeout(3000);
    await shot(`20-${name}`);
  }
} catch (e) {
  errors.push('SCRIPT: ' + e.message);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'NO CONSOLE ERRORS');
process.exit(errors.length ? 1 : 0);
