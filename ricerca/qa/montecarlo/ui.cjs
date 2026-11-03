// Controllo 5 (e tempi del controllo 4) nel browser. Server: python3 -m http.server 8791 dalla cartella del repository.
// Uso: node ui.cjs  → screenshot e out/ui.json
const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'http://localhost:8791/#/indicizzata';
const OUT = __dirname + '/out/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, { w, h, theme, tag }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  await page.addInitScript(t => { if (!sessionStorage.getItem('qa')) { localStorage.clear(); sessionStorage.setItem('qa', '1'); }
    localStorage.setItem('antigravity-theme', t); localStorage.setItem('bondladder.intro', '1'); }, theme);
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForSelector('#results .kpis', { timeout: 90000 });
  return { ctx, page, log, tLoad: Date.now() - t0, tag };
}
const mcPanel = page => page.locator('section.panel', { has: page.locator('h2', { hasText: 'Monte Carlo: scala + ETF' }) });
async function waitMc(page, t0) {
  await page.waitForFunction(() => [...document.querySelectorAll('#results section.panel h2')].some(x => /Monte Carlo/.test(x.textContent))
    && document.querySelectorAll('#results section.panel .chart svg').length >= 2 && !document.querySelector('#results.busy, #results .busy'), null, { timeout: 60000 });
  return Date.now() - t0;
}
async function inspect(page) {
  return page.evaluate(() => {
    const sec = [...document.querySelectorAll('#results section.panel')].find(s => /Monte Carlo/.test(s.querySelector('h2')?.textContent || ''));
    if (!sec) return { missing: true, warn: [...document.querySelectorAll('#results .insight, #results .note')].map(x => x.textContent).filter(t => /capitale/i.test(t)).slice(0, 3) };
    const svgs = [...sec.querySelectorAll('svg')].filter(s => s.closest('.chart'));
    const charts = svgs.map(s => {
      const r = s.getBoundingClientRect();
      const texts = [...s.querySelectorAll('text')].map(t => ({ t: t.textContent, x: +t.getAttribute('x'), y: +t.getAttribute('y'), bb: t.getBoundingClientRect() }));
      // sovrapposizioni fra etichette dell'asse x
      const xs = texts.filter(t => t.bb.top > r.top + r.height - 30).sort((a, b) => a.bb.left - b.bb.left);
      let overlap = 0; for (let i = 1; i < xs.length; i++) if (xs[i].bb.left < xs[i - 1].bb.right) overlap++;
      const paths = [...s.querySelectorAll('path')].map(p => ({ cls: p.getAttribute('class'), stroke: getComputedStyle(p).stroke, fill: getComputedStyle(p).fill, op: getComputedStyle(p).opacity, dash: getComputedStyle(p).strokeDasharray }));
      return { w: Math.round(r.width), h: Math.round(r.height), vb: s.getAttribute('viewBox'), labels: texts.map(t => t.t), xOverlap: overlap, paths,
        yLabelsClipped: texts.filter(t => t.bb.left < r.left - 1).length };
    });
    return {
      kpis: [...sec.querySelectorAll('.kpi')].map(k => k.innerText.replace(/\n+/g, ' | ')),
      headings: [...sec.querySelectorAll('h2, h3')].map(x => x.textContent), meta: sec.querySelector('.ph .meta')?.textContent,
      legend: sec.querySelector('.legend')?.innerText, note: sec.querySelector('p.note')?.textContent, charts,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      secOverflow: [...sec.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length,
      bodyBg: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.getAttribute('data-theme')
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const cfg of [{ w: 1440, h: 1000, theme: 'dark', tag: 'pc-scuro' }, { w: 1440, h: 1000, theme: 'light', tag: 'pc-chiaro' },
    { w: 390, h: 844, theme: 'light', tag: 'tel-chiaro' }, { w: 390, h: 844, theme: 'dark', tag: 'tel-scuro' }]) {
    const { ctx, page, log, tLoad } = await open(browser, cfg);
    const t0 = Date.now();
    await page.locator('[data-k="mcon"]').check();
    const tMc = await waitMc(page, t0);
    await sleep(300);
    const info = await inspect(page);
    await mcPanel(page).screenshot({ path: `${OUT}mc-${cfg.tag}.png` });
    // pannello impostazioni «Resto del capitale»
    const setp = page.locator('section.panel', { has: page.locator('h2', { hasText: 'Resto del capitale' }) });
    await setp.screenshot({ path: `${OUT}impostazioni-${cfg.tag}.png` });
    res[cfg.tag] = { tLoad, tMc, info, log: [...log] };
    console.log(cfg.tag, 'carico', tLoad, 'ms, MC', tMc, 'ms, errori', log.length);
    if (cfg.tag === 'pc-scuro') {
      // A) importo della spesa extra e poi anno: l'importo resta?
      await page.locator('[data-k="mcex"]').check();
      await page.waitForSelector('[data-k="mcexa"]');
      await page.locator('[data-k="mcexa"]').fill('35.000');
      await page.locator('[data-k="mcexa"]').dispatchEvent('input');
      await sleep(400);
      await page.getByRole('button', { name: 'Primo anno della spesa extra: anno successivo' }).click();
      await sleep(400);
      const after = await page.locator('[data-k="mcexa"]').inputValue();
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /settings|state|bondladder\.st|ladder/i.test(k) && localStorage.getItem(k).includes('"mc"')) || 'null')));
      res.extraStale = { typed: '35.000', afterYearClick: after, stored: stored && stored.indexed && stored.indexed.mc && stored.indexed.mc.extra };
      console.log('spesa extra dopo il clic sull\'anno:', JSON.stringify(res.extraStale));
      await page.locator('[data-k="mcex"]').uncheck();
      // B) capitale minore del costo della scala
      await page.locator('[data-k="mctot"]').fill('100.000'); await page.locator('[data-k="mctot"]').dispatchEvent('input');
      await sleep(500);
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 60000 }).catch(() => {});
      await sleep(8000);
      res.below = await page.evaluate(() => [...document.querySelectorAll('#results .insight')].map(x => x.textContent).filter(t => /capitale complessivo/i.test(t)));
      await page.screenshot({ path: `${OUT}capitale-minore-pc-scuro.png`, fullPage: false });
      console.log('capitale minore:', res.below);
      // C) tempo del caso pesante: rate semestrali fino al 2066, capitale 700.000
      await page.locator('[data-k="mctot"]').fill('700.000'); await page.locator('[data-k="mctot"]').dispatchEvent('input');
      await sleep(300);
      await page.locator('[data-k="xsched:semester"]').click();
      await sleep(300);
      await page.locator('[data-k="xto"]').fill('2066');
      const t1 = Date.now();
      await page.locator('[data-k="xto"]').dispatchEvent('change');
      await page.waitForFunction(() => [...document.querySelectorAll('#results section.panel h2')].some(x => /Monte Carlo/.test(x.textContent))
        && [...document.querySelectorAll('#results .kpi')].some(k => /2066/.test(k.textContent)), null, { timeout: 90000 }).catch(e => { res.heavyErr = String(e).slice(0, 200); });
      res.heavyMs = Date.now() - t1;
      res.heavyMsg = await page.evaluate(() => [...document.querySelectorAll('#results .insight, .toast, #results .error')].map(x => x.textContent).filter(t => /tempo|interrott|blocca/i.test(t)));
      console.log('caso pesante', res.heavyMs, 'ms', res.heavyErr || '', res.heavyMsg);
      res.heavyInfo = await inspect(page);
      await mcPanel(page).screenshot({ path: `${OUT}mc-pesante-pc-scuro.png` }).catch(() => {});
      res['pc-scuro'].log2 = [...log];
    }
    await ctx.close();
  }
  fs.writeFileSync(OUT + 'ui.json', JSON.stringify(res, null, 1));
  await browser.close();
})();
