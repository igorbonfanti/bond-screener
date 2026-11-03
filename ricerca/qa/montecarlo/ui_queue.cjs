// Due modifiche ravvicinate con il Monte Carlo acceso: la seconda richiesta aspetta la prima nel worker e il
// guardiano di 30 s conta anche l'attesa. node ui_queue.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  for (const quick of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.addInitScript(s => { localStorage.setItem('bondladder.intro', '1'); localStorage.setItem('bondladder.v3.settings', s); },
      JSON.stringify({ goal: 'indexed', indexed: { alm: { yearTo: 2056 }, mc: { on: true, total: 700000 } } }));
    await page.goto('http://localhost:8791/#/indicizzata');
    await page.waitForFunction(() => [...document.querySelectorAll('#results section.panel h2')].some(x => /Monte Carlo/.test(x.textContent)), null, { timeout: 120000 });
    const t0 = Date.now();
    await page.locator('[data-k="xsched:semester"]').click();
    if (!quick) await page.waitForFunction(() => [...document.querySelectorAll('#results .kpi')].length && !document.querySelector('[aria-busy="true"]'), null, { timeout: 120000 }).then(() => new Promise(r => setTimeout(r, 15000)));
    else await new Promise(r => setTimeout(r, 1500));
    await page.locator('[data-k="xto"]').fill('2066');
    await page.locator('[data-k="xto"]').dispatchEvent('change');
    const r = await page.waitForFunction(() => {
      const err = [...document.querySelectorAll('#results *, .toast')].find(e => e.children.length === 0 && /troppo tempo|si blocca|interrott/.test(e.textContent));
      if (err) return err.textContent;
      return [...document.querySelectorAll('#results .kpi')].some(k => /fino al 2066/i.test(k.textContent)) ? 'ok' : false;
    }, null, { timeout: 150000 }).then(h => h.jsonValue()).catch(() => 'timeout playwright');
    console.log(quick ? 'modifiche ravvicinate' : 'modifiche distanziate', Date.now() - t0, 'ms:', r);
    await ctx.close();
  }
  await browser.close();
})();
