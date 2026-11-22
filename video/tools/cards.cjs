// Title cards and scene labels (cards.html, in the app's own fonts) as
// transparent PNGs in video/work/cards/, one per element with an id; with
// --lang=da the Danish texts (data-da) go to video/work/cards-da/.
//   node video/tools/cards.cjs [--lang=da]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const LANG = (process.argv.find((a) => a.startsWith('--lang=')) || '--lang=en').slice(7);
const OUT = path.join(__dirname, '..', 'work', LANG === 'en' ? 'cards' : `cards-${LANG}`);
const exe = process.env.CHROME || execSync('ls ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | tail -1').toString().trim();
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: exe, args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + path.join(__dirname, 'cards.html') + (LANG === 'en' ? '' : `?lang=${LANG}`));
  await p.evaluate(() => document.fonts.ready);
  for (const id of await p.$$eval('[id]', (els) => els.map((e) => e.id).filter((id) => id !== 'labels')))
    await p.locator('#' + id).screenshot({ path: `${OUT}/${id}.png`, omitBackground: true });
  await b.close();
  console.log('cards in', OUT);
})();
