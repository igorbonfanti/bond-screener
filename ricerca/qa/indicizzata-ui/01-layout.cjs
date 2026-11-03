// QA layout della scheda «6 Affitto indicizzato»: 4 larghezze × 2 temi.
// Uso: node ricerca/qa/indicizzata-ui/01-layout.js  (server su :8790)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const URL = 'http://localhost:8790/#/indicizzata';
const SIZES = [[1440, 900, 'desk1440'], [1280, 800, 'desk1280'], [390, 844, 'tel390'], [360, 740, 'tel360']];

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const theme of ['dark', 'light']) for (const [w, hgt, name] of SIZES) {
    const mobile = w < 600;
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(t => { localStorage.setItem('antigravity-theme', t); localStorage.setItem('bondladder.intro', '1'); }, theme);
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    const t0 = Date.now();
    await page.goto(URL);
    await page.waitForSelector('#results .kpis', { timeout: 60000 });
    await page.waitForTimeout(800);
    const secs = (Date.now() - t0) / 1000;
    const tag = `${name}-${theme}`;
    await page.screenshot({ path: `${OUT}/${tag}-full.png`, fullPage: true });
    await page.screenshot({ path: `${OUT}/${tag}-top.png` });
    const m = await page.evaluate((mobile) => {
      const de = document.documentElement;
      const res = { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowers: [], clipped: [], smallTargets: [], overlaps: [] };
      const vw = de.clientWidth;
      for (const el of document.querySelectorAll('#view *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const inScroll = el.closest('.tscroll');
        if (!inScroll && r.right > vw + 1) res.overflowers.push(`${el.tagName}.${el.className} right=${Math.round(r.right)} «${(el.textContent || '').trim().slice(0, 40)}»`);
        const cs = getComputedStyle(el);
        if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0)
          res.clipped.push(`${el.tagName}.${el.className} ${el.scrollWidth}>${el.clientWidth} «${el.textContent.trim().slice(0, 50)}»`);
      }
      // testo dei KPI che esce dalla sua casella
      for (const k of document.querySelectorAll('.kpi')) {
        const kr = k.getBoundingClientRect();
        for (const c of k.querySelectorAll('span')) { const r = c.getBoundingClientRect(); if (r.right > kr.right + 1 || c.scrollWidth > c.clientWidth + 1) res.clipped.push(`KPI «${k.querySelector('.k').textContent}» parte «${c.textContent.slice(0, 50)}» ${Math.round(r.right)}>${Math.round(kr.right)} sw=${c.scrollWidth} cw=${c.clientWidth}`); }
      }
      if (mobile) for (const b of document.querySelectorAll('#view button, #view input, #view [role=button], #view summary, #view a')) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(b).visibility === 'hidden') continue;
        if (r.height < 32 || r.width < 32) res.smallTargets.push(`${b.tagName}${b.dataset.k ? '[' + b.dataset.k + ']' : ''} ${Math.round(r.width)}×${Math.round(r.height)} «${(b.textContent || b.value || b.getAttribute('aria-label') || '').trim().slice(0, 30)}»`);
      }
      // pulsanti scenario/unità nell'intestazione del grafico: sovrapposizione col titolo
      const ph = [...document.querySelectorAll('.panel .ph')].find(p => p.textContent.includes('Da dove arriva'));
      if (ph) { const t = ph.querySelector('h2').getBoundingClientRect(); for (const b of ph.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top) res.overlaps.push('pulsante sopra il titolo: ' + b.textContent); } res.phHeight = Math.round(ph.getBoundingClientRect().height); }
      res.tables = [...document.querySelectorAll('#results .tscroll')].map(s => ({ label: (s.querySelector('table') || {}).getAttribute ? s.querySelector('table').getAttribute('aria-label') : '', sw: s.scrollWidth, cw: s.clientWidth }));
      return res;
    }, mobile);
    m.secs = secs; m.logs = logs;
    m.overflowers = m.overflowers.slice(0, 15); m.clipped = [...new Set(m.clipped)].slice(0, 25); m.smallTargets = m.smallTargets.slice(0, 60);
    report[tag] = m;
    if (name === 'desk1440' && theme === 'dark') {
      const txt = await page.evaluate(() => ({
        kpis: [...document.querySelectorAll('#results .kpi')].map(k => k.innerText.replace(/\n/g, ' | ')),
        lead: document.querySelector('#results .lead').innerText,
        panels: [...document.querySelectorAll('#results .panel')].map(p => p.innerText),
        side: document.querySelector('#panel').innerText,
        mobileBar: document.querySelector('#mobileBar') ? document.querySelector('#mobileBar').innerText : ''
      }));
      fs.writeFileSync(`${OUT}/testo-default.json`, JSON.stringify(txt, null, 1));
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/01-layout.json`, JSON.stringify(report, null, 1));
  await browser.close();
})();
