// Screenshots for the videos, from the local dev stack with demo data in it:
// website pages as the demo user, the desktop client and its overlays through
// the preview server (preview-server.cjs, port 8767). All at 2x, so pans and
// zooms stay sharp. Writes video/work/hi/.
//   node video/tools/capture.cjs [web|client|overlays ...]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const WORK = path.join(__dirname, '..', 'work');
const OUT = path.join(WORK, 'hi');
const seed = JSON.parse(fs.readFileSync(path.join(WORK, 'seed.json'), 'utf8'));
const exe = process.env.CHROME || execSync('ls ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1').toString().trim();
const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['web', 'client', 'overlays']);
const opts = { colorScheme: 'dark', locale: 'en-GB', timezoneId: 'Europe/Copenhagen', deviceScaleFactor: 2 };

// Org presence counts as "playing" only while fresh: touch it right before shooting.
const freshPresence = () => execSync(`docker exec starbuddy-db-1 psql -U starmaker -d starmaker -Atc "update user_presence set updated_at = now() - (random()*60||' seconds')::interval where running and user_id in (select id from users where discord_id like 'demo-%')"`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: exe });
  const errors = (p) => p.on('pageerror', (e) => console.log('pageerror', p.url(), e.message));
  if (want.has('web')) {
    const ctx = await b.newContext({ ...opts, viewport: { width: 1920, height: 1080 } });
    await ctx.addCookies([{ name: seed.cookie, value: seed.value, domain: 'localhost', path: '/' }]);
    const p = await ctx.newPage(); errors(p);
    for (const [route, name] of [['/', 'dash'], ['/craft', 'craft'], ['/gathering', 'gathering'], ['/blueprints', 'blueprints'], ['/refinery', 'refinery'], ['/items', 'items']]) {
      await p.goto('http://localhost:8090' + route); await p.waitForTimeout(3000);
      await p.mouse.move(1900, 1070);
      await p.screenshot({ path: `${OUT}/web_${name}.png` });
      if (name === 'dash') await p.screenshot({ path: `${OUT}/web_dash_full.png`, fullPage: true });
    }
  }
  if (want.has('client')) {
    freshPresence();
    const c = await (await b.newContext({ ...opts, viewport: { width: 1280, height: 800 } })).newPage(); errors(c);
    for (const s of ['home', 'org', 'craft', 'blueprints', 'gathering', 'refinery', 'stash', 'tools']) {
      await c.goto('http://localhost:8767/?s=' + s); await c.waitForTimeout(2500);
      await c.screenshot({ path: `${OUT}/client_${s}.png` });
    }
  }
  if (want.has('overlays')) {
    const o = await (await b.newContext({ ...opts, viewport: { width: 460, height: 760 } })).newPage(); errors(o);
    for (const w of ['status', 'refinery', 'pools', 'gathering', 'orders', 'points']) {
      await o.goto('http://localhost:8767/?window=' + w); await o.waitForTimeout(2500);
      await o.screenshot({ path: `${OUT}/ov_${w}.png`, omitBackground: true });
    }
  }
  await b.close();
  console.log('shots in', OUT);
})();
