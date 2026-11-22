// Screenshots for the help (src/help/content), in English and Danish, from
// the local dev stack with the video's demo data in it, so no real player is
// shown. Writes public/help/screens/<lang>/.
//
// Before: the dev stack on :8090, the demo data seeded, and the client's
// preview server on :8767 (see video/README.md, steps 1 and 2):
//   video/tools/demo-data.sh seed
//   npm --prefix client run build && node video/tools/preview-server.cjs &
// Then, from the repo root:
//   node frontend/scripts/help-screens.cjs [--lang=en|da] [web|client ...]
// After: video/tools/demo-data.sh unseed, and stop the preview server.
//
// Re-run it whenever a page or a client screen the help shows changes, and
// check the text still matches: `npm --prefix frontend run help:check`.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const repo = path.join(__dirname, '..', '..');
const { chromium } = require(path.join(repo, 'video/node_modules/playwright-core'));
const seed = JSON.parse(fs.readFileSync(path.join(repo, 'video/work/seed.json'), 'utf8'));
const exe = process.env.CHROME || execSync('ls ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1').toString().trim();
const sql = (q) => execSync(`docker exec starbuddy-db-1 psql -U starmaker -d starmaker -Atc "${q}"`).toString().trim();

const args = process.argv.slice(2);
const langArg = args.find((a) => a.startsWith('--lang='));
const LANGS = langArg ? [langArg.slice(7)] : ['en', 'da'];
const parts = args.filter((a) => !a.startsWith('--'));
const want = new Set(parts.length ? parts : ['web', 'client']);
const WEB = 'http://localhost:8090';
const CLIENT = 'http://localhost:8767';
const DEMO = "discord_id like 'demo-%'";

const settle = (p, ms = 2500) => p.waitForTimeout(ms);
const jpg = (p, file, opts = {}) => p.screenshot({ path: file, type: 'jpeg', quality: 82, ...opts });

async function web(browser, lang, out) {
  // A Windows browser, like most players': the client download offers the Windows installer.
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const opts = { colorScheme: 'dark', locale: lang === 'da' ? 'da-DK' : 'en-GB', timezoneId: 'Europe/Copenhagen', viewport: { width: 1600, height: 900 }, userAgent: windows };

  // The sign-in page, as a stranger sees it: the language comes from the browser.
  const guest = await browser.newContext(opts);
  const g = await guest.newPage();
  await g.addInitScript((l) => localStorage.setItem('starbuddy.locale', l), lang);
  await g.goto(WEB + '/');
  await settle(g);
  await jpg(g, `${out}/web-login.jpg`);
  await guest.close();

  // Signed in as the demo pilot, who manages a demo org and is a tester. The
  // website takes its language from the profile.
  sql(`update users set locale = '${lang}' where ${DEMO}`);
  const role = process.env.STARBUDDY_TESTER_ROLE_ID || execSync('docker exec starbuddy-app-1 printenv STARBUDDY_TESTER_ROLE_ID || true').toString().trim();
  if (role) sql(`update users set discord_role_ids = '[\\"${role}\\"]' where ${DEMO} and handle = 'Kestrel'`);
  // The first-login guide, as a new member sees it: no handle, no
  // org, no client. The demo pilot's answers are swapped for a newcomer's.
  const fresh = await browser.newContext(opts);
  await fresh.addCookies([{ name: seed.cookie, value: seed.value, domain: 'localhost', path: '/' }]);
  const f = await fresh.newPage();
  await f.route('**/api/me', async (r) => {
    const res = await r.fetch();
    await r.fulfill({ response: res, json: { ...(await res.json()), handle: null, orgs: [], main_org_id: null } });
  });
  await f.route('**/api/devices', (r) => r.fulfill({ json: [] }));
  await f.goto(WEB + '/');
  await settle(f, 3500);
  await jpg(f, `${out}/web-get-started.jpg`);
  await fresh.close();

  const ctx = await browser.newContext(opts);
  await ctx.addCookies([{ name: seed.cookie, value: seed.value, domain: 'localhost', path: '/' }]);
  // The rest shows the pages themselves: the guide is hidden.
  await ctx.addInitScript((id) => localStorage.setItem(`starbuddy.getStarted.hidden.${id}`, '1'), seed.me);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', p.url(), e.message));
  const page = async (route, name) => {
    await p.goto(WEB + route);
    await settle(p);
    await p.mouse.move(1590, 890);
    await jpg(p, `${out}/${name}.jpg`);
  };
  // Opens the first row's details: the row itself, or the cell that opens them.
  const firstRow = async (name, cell = 'main tbody tr') => {
    await p.locator(cell).first().click();
    await settle(p, 2000);
    await jpg(p, `${out}/${name}.jpg`);
    await p.keyboard.press('Escape');
    await settle(p, 500);
  };
  const menu = async (index, name) => {
    await p.goto(WEB + '/');
    await settle(p);
    await p.locator('[aria-haspopup="menu"]').first().click();
    await settle(p, 400);
    await p.getByRole('menuitem').nth(index).click();
    await settle(p, 1500);
    await jpg(p, `${out}/${name}.jpg`);
    await p.keyboard.press('Escape');
  };

  await page('/', 'web-dashboard');
  await page('/resources', 'web-materials');
  await p.getByRole('button', { name: /^(Add materials|Tilføj materialer)$/ }).click();
  await settle(p, 1500);
  // A location for the batch, then a material being typed in the first line.
  await p.keyboard.type('Port Tress', { delay: 40 });
  await settle(p, 800);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await settle(p, 500);
  await p.locator('[role=dialog]').getByText('—', { exact: true }).first().dispatchEvent('mousedown');
  await p.keyboard.type('Quantain', { delay: 40 });
  await settle(p, 1200);
  await jpg(p, `${out}/web-materials-add.jpg`);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await page('/items', 'web-items');
  await page('/blueprints', 'web-blueprints');
  await firstRow('web-blueprint-info', 'main tbody tr td:nth-child(2)');
  await page('/craft', 'web-craft');
  await firstRow('web-craft-detail');
  await page('/gathering', 'web-gathering');
  await page('/refinery', 'web-refinery');
  await firstRow('web-refinery-order');
  await page('/import', 'web-import');
  await page('/admin', 'web-admin');
  await page('/training', 'web-training');
  await menu(0, 'web-profile');
  await menu(1, 'web-organizations');
  await ctx.close();
  sql(`update users set locale = 'en', discord_role_ids = null where ${DEMO}`);
}

async function client(browser, lang, out) {
  // Game status counts as "playing" only while fresh: touch it right before shooting.
  sql(`update user_presence set updated_at = now() - (random()*60||' seconds')::interval where running and user_id in (select id from users where ${DEMO})`);
  const opts = { colorScheme: 'dark', locale: lang === 'da' ? 'da-DK' : 'en-GB', timezoneId: 'Europe/Copenhagen' };
  const ctx = await browser.newContext({ ...opts, viewport: { width: 1280, height: 800 } });
  const c = await ctx.newPage();
  c.on('pageerror', (e) => console.log('pageerror', c.url(), e.message));
  const shot = async (query, name) => {
    await c.goto(`${CLIENT}/?lang=${lang}&${query}`);
    await settle(c);
    await jpg(c, `${out}/${name}.jpg`);
  };
  await shot('s=home', 'client-home');
  await shot('s=craft', 'client-craft');
  await shot('s=org', 'client-org');
  for (const tab of ['general', 'hotkeys', 'game', 'reading']) await shot(`s=settings&t=${tab}`, `client-settings-${tab}`);
  await ctx.close();

  // Single overlay windows, on a transparent background.
  const o = await (await browser.newContext({ ...opts, viewport: { width: 460, height: 760 } })).newPage();
  for (const [w, name] of [['scan', 'client-scan'], ['refinery', 'client-refinery-order']]) {
    await o.goto(`${CLIENT}/?lang=${lang}&window=${w}`);
    await settle(o);
    // Cut the transparent space below the window.
    const height = await o.evaluate(() => Math.ceil(Math.max(...[...document.querySelectorAll('body *')].map((e) => e.getBoundingClientRect().bottom))));
    await o.screenshot({ path: `${out}/${name}.png`, omitBackground: true, clip: { x: 0, y: 0, width: 460, height: Math.min(760, height + 4) } });
  }

  // Several overlay windows side by side, as they sit over the game.
  const strip = await (await browser.newContext({ ...opts, viewport: { width: 1960, height: 420 } })).newPage();
  const windows = ['status', 'orders', 'gathering', 'points'];
  await strip.setContent(`<body style="margin:0;background:radial-gradient(circle at 30% 30%,#1d2a33,#070b0e);display:flex;gap:20px;padding:20px;box-sizing:border-box;height:100vh">
    ${windows.map((w) => `<iframe src="${CLIENT}/?lang=${lang}&window=${w}" style="width:460px;flex:none;border:0;background:transparent;height:100%" allowtransparency="true"></iframe>`).join('')}</body>`);
  await settle(strip, 3500);
  await jpg(strip, `${out}/client-overlays.jpg`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: exe });
  for (const lang of LANGS) {
    const out = path.join(repo, 'frontend/public/help/screens', lang);
    fs.mkdirSync(out, { recursive: true });
    if (want.has('web')) await web(browser, lang, out);
    if (want.has('client')) await client(browser, lang, out);
    console.log('help screenshots in', out);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  try {
    sql(`update users set locale = 'en', discord_role_ids = null where ${DEMO}`);
  } catch {}
  process.exit(1);
});
