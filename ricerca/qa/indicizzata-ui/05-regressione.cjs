// Regressione schede 1–5: versione del ramo (:8790) contro il commit prima della funzione (bfaa1a6, :8791, stessi dati).
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const TABS = [['capitale', '#results .kpis'], ['rendita', '#results .kpis'], ['portafoglio', '#view .panel'], ['scale', '#view'], ['titolo', '#view table, #view .panel']];
(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const [port, tag] of [[8790, 'ramo'], [8791, 'prima']]) for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 600, hasTouch: w < 600 });
    await ctx.addInitScript(() => { localStorage.setItem('bondladder.intro', '1'); });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    for (const [t, sel] of TABS) {
      await page.goto(`http://localhost:${port}/#/${t}`);
      await page.waitForSelector(sel, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const txt = await page.evaluate(() => ({ kpis: [...document.querySelectorAll('#results .kpi')].map(k => k.innerText.replace(/\n/g, ' | ')), panels: [...document.querySelectorAll('#view .panel h2')].map(x => x.textContent), settings: (document.querySelector('#panel') || {}).innerText || '', sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      res[`${tag}-${w}-${t}`] = { ...txt, settings: txt.settings.length };
      if (tag === 'ramo') await page.screenshot({ path: `${OUT}/r-${w}-${t}.png` });
    }
    res[`${tag}-${w}-logs`] = logs;
    await ctx.close();
  }
  // confronto
  const diff = [];
  for (const k of Object.keys(res).filter(k => k.startsWith('ramo'))) {
    const p = res[k.replace('ramo', 'prima')];
    if (JSON.stringify(res[k]) !== JSON.stringify(p)) diff.push({ k, ramo: res[k], prima: p });
  }
  fs.writeFileSync(`${OUT}/05-regressione.json`, JSON.stringify({ res, diff }, null, 1));
  console.log(JSON.stringify(diff, null, 1));
  await browser.close();
})();
