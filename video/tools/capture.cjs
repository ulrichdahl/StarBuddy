// Screenshots for the videos, from the local dev stack with demo data in it:
// website pages as the demo user, the desktop client and its overlays through
// the preview server (preview-server.cjs, port 8767). All at 2x, so pans and
// zooms stay sharp. Writes video/work/hi/ (English UI) or, with --lang=da,
// video/work/hi-da/ with every page and window in Danish.
//   node video/tools/capture.cjs [--lang=da] [web|client|overlays ...]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const WORK = path.join(__dirname, '..', 'work');
const seed = JSON.parse(fs.readFileSync(path.join(WORK, 'seed.json'), 'utf8'));
const exe = process.env.CHROME || execSync('ls ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1').toString().trim();
const args = process.argv.slice(2);
const LANG = (args.find((a) => a.startsWith('--lang=')) || '--lang=en').slice(7);
const OUT = path.join(WORK, LANG === 'en' ? 'hi' : `hi-${LANG}`);
const parts = args.filter((a) => !a.startsWith('--'));
const want = new Set(parts.length ? parts : ['web', 'client', 'overlays']);
const opts = { colorScheme: 'dark', locale: LANG === 'da' ? 'da-DK' : 'en-GB', timezoneId: 'Europe/Copenhagen', deviceScaleFactor: 2 };
// The dev DB's user and name come from the container's own environment.
const sql = (q) => execSync(`docker exec starbuddy-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$0"' "${q}"`);

// Org presence counts as "playing" only while fresh: touch it right before shooting.
const freshPresence = () => sql("update user_presence set updated_at = now() - (random()*60||' seconds')::interval where running and user_id in (select id from users where discord_id like 'demo-%')");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: exe });
  const errors = (p) => p.on('pageerror', (e) => console.log('pageerror', p.url(), e.message));
  if (want.has('web')) {
    // The website takes the language from the profile: the demo pilots' for
    // the shoot, set back to English afterwards.
    sql(`update users set locale = '${LANG}' where discord_id like 'demo-%'`);
    const ctx = await b.newContext({ ...opts, viewport: { width: 1920, height: 1080 } });
    await ctx.addCookies([{ name: seed.cookie, value: seed.value, domain: 'localhost', path: '/' }]);
    const p = await ctx.newPage(); errors(p);
    for (const [route, name] of [['/', 'dash'], ['/craft', 'craft'], ['/gathering', 'gathering'], ['/blueprints', 'blueprints'], ['/refinery', 'refinery'], ['/items', 'items']]) {
      await p.goto('http://localhost:8090' + route); await p.waitForTimeout(3000);
      await p.mouse.move(1900, 1070);
      await p.screenshot({ path: `${OUT}/web_${name}.png` });
      if (name === 'dash') await p.screenshot({ path: `${OUT}/web_dash_full.png`, fullPage: true });
    }
    sql("update users set locale = 'en' where discord_id like 'demo-%'");
  }
  if (want.has('client')) {
    freshPresence();
    const c = await (await b.newContext({ ...opts, viewport: { width: 1280, height: 800 } })).newPage(); errors(c);
    for (const s of ['home', 'org', 'craft', 'blueprints', 'gathering', 'refinery', 'stash', 'tools']) {
      await c.goto(`http://localhost:8767/?lang=${LANG}&s=${s}`); await c.waitForTimeout(2500);
      await c.screenshot({ path: `${OUT}/client_${s}.png` });
    }
  }
  if (want.has('overlays')) {
    const o = await (await b.newContext({ ...opts, viewport: { width: 460, height: 760 } })).newPage(); errors(o);
    for (const w of ['status', 'refinery', 'pools', 'gathering', 'orders', 'points']) {
      await o.goto(`http://localhost:8767/?lang=${LANG}&window=${w}`); await o.waitForTimeout(2500);
      await o.screenshot({ path: `${OUT}/ov_${w}.png`, omitBackground: true });
    }
  }
  await b.close();
  console.log('shots in', OUT);
})();
