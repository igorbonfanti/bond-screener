// QA interazioni: scenari e unità, ordinamento, CSV, Copia ISIN, guida, comandi, timeout, mobile bar.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const URL = 'http://localhost:8790/#/indicizzata';
const out = {};

async function settle(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('#results[aria-busy]'), null, { timeout: 90000 });
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { localStorage.setItem('bondladder.intro', '1'); });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(URL);
  await page.waitForSelector('#results .kpis', { timeout: 60000 });
  await page.waitForTimeout(600);

  // 1. scenari × unità: tabella e grafico
  const seg = page.locator('#results .panel').filter({ has: page.locator('h2', { hasText: 'Da dove arriva' }) });
  const grab = () => page.evaluate(() => {
    const t = document.querySelector('#results table[aria-label="Rate dell\'affitto e flussi della scala"]');
    const rows = [...t.tBodies[0].rows].map(r => [...r.cells].map(c => c.innerText.trim()));
    const meta = [...document.querySelectorAll('#results .ph .meta')].map(m => m.textContent).find(x => x.startsWith('scenario'));
    const pressed = [...document.querySelectorAll('#results .ph-end .seg button[aria-pressed="true"]')].map(b => b.textContent);
    const chartLabel = (document.querySelector('#results svg[aria-label]') || {}).getAttribute ? document.querySelector('#results svg[aria-label]').getAttribute('aria-label') : null;
    return { meta, pressed, first: rows[0], last: rows.at(-1), chartLabel };
  });
  out.scen = {};
  for (const s of ['Base', 'Alto 3,5%', 'Basso 1%', 'Shock 8→5%', 'FOI +0,5% su HICP']) for (const u of ['€ nominali', '€ di oggi']) {
    await seg.getByRole('button', { name: s, exact: true }).click();
    await seg.getByRole('button', { name: u, exact: true }).click();
    await page.waitForTimeout(150);
    out.scen[`${s} | ${u}`] = await grab();
  }
  await seg.screenshot({ path: `${OUT}/i-grafico-shock-oggi.png` });
  // tooltip del grafico
  const bars = page.locator('#results .panel svg rect');
  out.nRects = await bars.count();
  const box = await seg.locator('svg').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/i-tooltip.png`, clip: { x: box.x - 20, y: box.y - 40, width: box.width + 40, height: box.height + 80 } });
  out.tooltip = await page.evaluate(() => { const t = document.querySelector('.tip, .tooltip, [role=tooltip]'); return t ? t.innerText : null; });

  // 2. scelta dello scenario sopravvive a un ricalcolo?
  await page.click('[data-k="xsched:semester"]'); await settle(page);
  out.dopoRicalcolo = await grab();
  await page.click('[data-k="xsched:yearly"]'); await settle(page);
  await seg.getByRole('button', { name: 'Base', exact: true }).click();
  await seg.getByRole('button', { name: '€ nominali', exact: true }).click();

  // 3. ordinamento in € di oggi
  await seg.getByRole('button', { name: '€ di oggi', exact: true }).click();
  const rp = page.locator('#results .panel').filter({ has: page.locator('h2', { hasText: 'Rata per rata' }) });
  await rp.getByRole('button', { name: /Affitto/ }).click();
  out.sortOggi = await rp.evaluate(p => [...p.querySelectorAll('tbody tr')].map(r => r.cells[1].innerText).join(' '));
  await seg.getByRole('button', { name: '€ nominali', exact: true }).click();

  // 4. CSV
  const lp = page.locator('#results .panel').filter({ has: page.locator('h2', { hasText: "Lista d'acquisto" }) });
  const [dl] = await Promise.all([page.waitForEvent('download'), lp.getByRole('button', { name: 'Scarica CSV' }).click()]);
  const csvPath = `${OUT}/scala-affitto.csv`;
  await dl.saveAs(csvPath);
  out.csvName = dl.suggestedFilename();
  out.csv = fs.readFileSync(csvPath, 'utf8').split('\r\n').slice(0, 4);
  // 5. Copia ISIN
  await lp.getByRole('button', { name: /Copia ISIN/ }).click();
  await page.waitForTimeout(300);
  out.toastCopia = await page.evaluate(() => (document.getElementById('toast') || {}).textContent);
  out.clip = (await page.evaluate(() => navigator.clipboard.readText())).split('\n').slice(0, 3);
  // 6. Copia ISIN da una cella (codice cliccabile?)
  out.isinCells = await lp.locator('.sym').count();

  // 7. mobile bar & azioni Salva / Condividi
  out.azioni = await page.evaluate(() => [...document.querySelectorAll('#results > .actions button')].map(b => b.textContent));
  await page.getByRole('button', { name: 'Condividi il link' }).click(); await page.waitForTimeout(400);
  out.toastCondividi = await page.evaluate(() => (document.getElementById('toast') || {}).textContent);
  out.urlCondividi = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.getByRole('button', { name: 'Salva la scala' }).click(); await page.waitForTimeout(600);
  out.dopoSalva = await page.evaluate(() => ({ toast: (document.getElementById('toast') || {}).textContent, dialog: (document.querySelector('dialog[open]') || {}).innerText }));
  await page.screenshot({ path: `${OUT}/i-salva.png` });
  await page.getByRole('button', { name: 'Annulla' }).click().catch(() => {}); await page.waitForTimeout(300);
  // link condiviso: si apre sulla scheda 6?
  if (out.urlCondividi && out.urlCondividi.includes('#/s/')) {
    const p2 = await ctx.newPage(); await p2.goto(out.urlCondividi); await p2.waitForTimeout(9000);
    out.linkAperto = await p2.evaluate(() => ({ hash: location.hash, tab: (document.querySelector('#tabs [aria-selected="true"]') || {}).textContent, kpi: (document.querySelector('#results .kpi') || {}).innerText }));
    await p2.screenshot({ path: `${OUT}/i-link-condiviso.png` }); await p2.close();
  }

  // 8. guida
  await page.click('#helpBtn'); await page.waitForTimeout(400);
  out.guida = await page.evaluate(() => (document.querySelector('dialog[open]') || document.querySelector('.sheet') || {}).innerText);
  await page.screenshot({ path: `${OUT}/i-guida.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // 9. comandi
  for (const c of ['IND', 'AFFITTO', 'CAP', '6']) {
    await page.fill('#cmdInput', c); await page.press('#cmdInput', 'Enter'); await page.waitForTimeout(500);
    out['cmd_' + c] = await page.evaluate(() => location.hash);
  }
  await page.fill('#cmdInput', 'IT0004545890'); await page.press('#cmdInput', 'Enter'); await page.waitForTimeout(800);
  out.cmdIsin = await page.evaluate(() => ({ hash: location.hash, hint: document.querySelector('#cmdInput').placeholder, toast: (document.getElementById('toast') || {}).textContent, status: document.querySelector('#cmdStatus').textContent }));
  await page.screenshot({ path: `${OUT}/i-cmd-isin.png` });

  // 10. tetto per titolo 1%: timeout?
  await page.goto(URL); await page.waitForSelector('#results .kpis');
  const before = await page.evaluate(() => document.querySelector('#results .kpi .v').textContent);
  await page.fill('[data-k="xtcap"]', '1'); await page.locator('[data-k="xtcap"]').blur();
  const toasts = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) { const t = await page.evaluate(() => { const e = document.getElementById('toast'); return e && !e.hidden ? e.textContent : null; }); if (t && !toasts.includes(t)) toasts.push(t); await page.waitForTimeout(500); }
  out.tetto1 = { before, after: await page.evaluate(() => document.querySelector('#results .kpi .v').textContent), toasts, input: await page.inputValue('[data-k="xtcap"]'), busy: await page.evaluate(() => !!document.querySelector('#results[aria-busy]')) };
  await page.screenshot({ path: `${OUT}/i-tetto-titolo-1.png` });

  // 11. mobile: barra in basso
  out.logs = logs;
  fs.writeFileSync(`${OUT}/04-interazioni.json`, JSON.stringify(out, null, 1));
  await browser.close();
})();
