// Happy path through the real web UI: register → import ZIP → build → follow status → download debug APK.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const L = require('./lib.cjs');
const { WEB, OUT, check, sha256 } = L;

(async () => {
  const fx = L.fixtures();
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `ui-${n}.png`), fullPage: true });

  // register
  const email = `ui-${Date.now()}@example.test`;
  await page.goto(`${WEB}/auth/register`);
  await page.fill('input[type=text]', 'UI Tester');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', `Pw-${Date.now()}-x`);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  check('registration lands on the dashboard', true);

  // import the ZIP through the modal
  await page.getByRole('button', { name: /new project/i }).first().click();
  await page.locator('input[type=file]').setInputFiles(fx.ok);
  await page.getByPlaceholder('My Android App').first().fill('Reference App');
  await page.getByRole('button', { name: /upload & import/i }).click();
  await page.waitForSelector('text=Reference App', { timeout: 60000 });
  check('ZIP imported from the UI', true);
  await shot('dashboard');

  // open the project and build (debug only)
  await page.getByText('Reference App').first().click();
  await page.waitForURL('**/projects/*', { timeout: 30000 });
  const projectId = page.url().split('/projects/')[1].split(/[?#]/)[0];
  await shot('project');
  check('build type is limited to debug APK', await page.getByText(/Debug APK/).first().isVisible() && !(await page.getByRole('button', { name: /^AAB$/ }).count()));
  await page.getByRole('button', { name: /build apk/i }).click();
  await page.waitForURL('**/builds/*', { timeout: 60000 });
  const buildId = page.url().split('/builds/')[1].split(/[?#]/)[0];

  // follow states until a terminal one
  const seen = new Set();
  const labels = ['Queued', 'Building', 'Build Successful', 'Build Failed', 'Pending'];
  const end = Date.now() + Number(process.env.E2E_TIMEOUT_MS || 1500000);
  let final = '';
  while (Date.now() < end) {
    for (const l of labels) if (await page.getByText(l, { exact: false }).first().isVisible().catch(() => false)) seen.add(l);
    if (seen.has('Build Successful')) { final = 'SUCCESS'; break; }
    if (seen.has('Build Failed')) { final = 'FAILED'; break; }
    await page.waitForTimeout(2000);
  }
  await shot('build');
  check('UI showed an in-progress state before the result', seen.has('Building') || seen.has('Queued') || seen.has('Pending'), [...seen].join(','));
  check('UI reports the build as successful', final === 'SUCCESS', [...seen].join(','));
  if (final !== 'SUCCESS') { fs.writeFileSync(path.join(OUT, 'ui-failure.html'), await page.content()); await browser.close(); return L.finish('ui'); }

  // artifact card + authenticated download
  await page.waitForSelector('[data-testid=artifact-row]', { timeout: 30000 });
  const name = (await page.locator('[data-testid=artifact-name]').first().innerText()).trim();
  const shaShown = (await page.locator('[data-testid=artifact-sha256]').first().innerText()).trim();
  const sizeShown = (await page.locator('[data-testid=artifact-size]').first().innerText()).trim();
  check('artifact shows file name, size and SHA-256', name.endsWith('.apk') && /^[a-f0-9]{64}$/.test(shaShown) && /(KB|MB)$/.test(sizeShown), `${name} ${sizeShown} ${shaShown}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=artifact-download]').first().click()]);
  const apkPath = path.join(OUT, 'app-debug.apk');
  await dl.saveAs(apkPath);
  const bytes = fs.readFileSync(apkPath);
  check('downloaded APK matches the SHA-256 shown in the UI', sha256(bytes) === shaShown, sha256(bytes));
  if (process.env.E2E_STUB !== '1') check('APK is a ZIP container (PK header)', bytes.subarray(0, 2).toString() === 'PK');
  check('no unexpected browser errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  const token = await page.evaluate(() => localStorage.getItem('apk_factory_token'));
  const detail = await (await fetch(`${L.API}/api/v1/projects/${projectId}/builds/${buildId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  fs.writeFileSync(path.join(OUT, 'ui-report.json'), JSON.stringify({
    token, projectId, buildId, artifactId: detail.artifacts[0].id, fileName: name, sha256: shaShown, size: bytes.length, apk: apkPath,
  }, null, 2));
  await browser.close();
  L.finish('ui');
})().catch((e) => { console.error(e); process.exit(1); });
