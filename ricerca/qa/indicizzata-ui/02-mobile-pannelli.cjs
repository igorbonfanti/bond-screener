// Ritagli dei pannelli al telefono (e al computer per il campo dell'inflazione).
const { chromium } = require('playwright');
const OUT = __dirname;
(async () => {
  const browser = await chromium.launch();
  for (const [w, hgt, name] of [[390, 844, 'tel390'], [360, 740, 'tel360'], [1440, 900, 'desk1440']]) for (const theme of ['dark', 'light']) {
    const mobile = w < 600;
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(t => { localStorage.setItem('antigravity-theme', t); localStorage.setItem('bondladder.intro', '1'); }, theme);
    const page = await ctx.newPage();
    await page.goto('http://localhost:8790/#/indicizzata');
    await page.waitForSelector('#results .kpis', { timeout: 60000 });
    await page.waitForTimeout(800);
    const tag = `${name}-${theme}`;
    const fieldInfl = page.locator('.field', { hasText: 'Inflazione attesa' }).first();
    await fieldInfl.screenshot({ path: `${OUT}/${tag}-campo-inflazione.png` });
    if (!mobile) { await ctx.close(); continue; }
    await page.locator('#tabs').screenshot({ path: `${OUT}/${tag}-schede.png` });
    await page.locator('#panel .panel').first().screenshot({ path: `${OUT}/${tag}-pannello-affitto.png` });
    await page.locator('#results .kpis').screenshot({ path: `${OUT}/${tag}-kpi.png` });
    const pan = t => page.locator('#results .panel', { has: page.locator('h2', { hasText: t }) }).first();
    for (const [t, f] of [['Da dove arriva', 'grafico'], ['Prova di stress', 'stress'], ['Rata per rata', 'rate'], ["Lista d'acquisto", 'lista'], ['Composizione', 'composizione'], ['Liquidità', 'liquidita']])
      await pan(t).screenshot({ path: `${OUT}/${tag}-${f}.png` });
    await page.screenshot({ path: `${OUT}/${tag}-barra-mobile.png` });
    await ctx.close();
  }
  await browser.close();
})();
