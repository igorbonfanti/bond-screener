// Tempi nel browser (Web Worker, limite 30 s) con impostazioni salvate: node ui_heavy.cjs
const { chromium } = require('playwright');
const cases = {
  base: { alm: {}, mc: { on: true } },
  semestrali: { alm: { schedule: 'semester' }, mc: { on: true } },
  semestrali2056: { alm: { schedule: 'semester', yearTo: 2056 }, mc: { on: true, total: 600000 } },
  pesante2066: { alm: { schedule: 'semester', yearTo: 2066, L0: 12000 }, mc: { on: true, total: 700000 } },
  pesante2066_senzaMC: { alm: { schedule: 'semester', yearTo: 2066, L0: 12000 }, mc: { on: false, total: 700000 } }
};
(async () => {
  const browser = await chromium.launch();
  for (const [k, c] of Object.entries(cases)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.addInitScript(s => { localStorage.setItem('bondladder.intro', '1'); localStorage.setItem('bondladder.v3.settings', s); },
      JSON.stringify({ goal: 'indexed', indexed: c }));
    const t0 = Date.now();
    await page.goto('http://localhost:8791/#/indicizzata');
    let out = '';
    try {
      await page.waitForFunction(on => {
        const err = [...document.querySelectorAll('#results *')].find(e => e.children.length === 0 && /troppo tempo|si blocca/.test(e.textContent));
        if (err) return true;
        const k = document.querySelector('#results .kpis'); if (!k) return false;
        return !on || [...document.querySelectorAll('#results section.panel h2')].some(x => /Monte Carlo/.test(x.textContent));
      }, c.mc.on, { timeout: 120000 });
      out = await page.evaluate(() => { const e = [...document.querySelectorAll('#results *')].find(e => e.children.length === 0 && /troppo tempo|si blocca/.test(e.textContent)); return e ? e.textContent : 'ok'; });
    } catch (e) { out = 'timeout playwright'; }
    console.log(k, Date.now() - t0, 'ms', out);
    await ctx.close();
  }
  await browser.close();
})();
