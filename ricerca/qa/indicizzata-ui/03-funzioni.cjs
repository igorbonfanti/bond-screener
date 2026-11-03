// QA funzioni e coerenza dei numeri della scheda «6 Affitto indicizzato».
// Ogni caso parte da una pagina nuova (impostazioni di default), applica le modifiche e controlla i numeri.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const URL = 'http://localhost:8790/#/indicizzata';

async function settle(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('#results[aria-busy]') && (document.querySelector('#results .kpis') || document.querySelector('#results .panel')), null, { timeout: 90000 });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('#results[aria-busy]'), null, { timeout: 90000 });
  await page.waitForTimeout(300);
}

// legge i numeri della vista e controlla la coerenza
const READ = () => {
  const num = s => { if (s == null) return NaN; const t = String(s).replace(/[€%\s]/g, '').replace(/\./g, '').replace(',', '.').replace('−', '-'); return t === '—' || t === '' ? NaN : parseFloat(t); };
  const out = { issues: [] };
  const kp = {};
  for (const k of document.querySelectorAll('#results .kpi')) kp[k.querySelector('.k').textContent.trim()] = { v: k.querySelector('.v').textContent.trim(), s: (k.querySelector('.s') || {}).textContent || '' };
  out.kpi = kp;
  out.lead = (document.querySelector('#results .lead') || {}).textContent || '';
  const panels = {};
  for (const p of document.querySelectorAll('#results .panel')) { const t = p.querySelector('h2').textContent.trim(); panels[t] = panels[t] ? panels[t] + '\n' + p.innerText : p.innerText; }
  out.notes = [...document.querySelectorAll('#results .srow')].map(r => r.innerText.replace(/\n/g, ' '));
  if (!document.querySelector('#results .kpis')) { out.empty = true; out.text = document.querySelector('#results').innerText.slice(0, 600); return out; }
  const tbl = label => { const t = document.querySelector(`#results table[aria-label="${label}"]`); if (!t) return null; return { rows: [...t.tBodies[0].rows].map(r => [...r.cells].map(c => c.innerText.trim())), foot: t.tFoot ? [...t.tFoot.rows[0].cells].map(c => c.innerText.trim()) : null }; };
  const cap = kp['Capitale da investire'] || kp['Capitale usato'];
  const capV = num(cap.v); const [inB, inC] = cap.s.split('·').map(x => num(x.replace('in titoli', '').replace('in liquidità', '')));
  out.cap = { capV, inB, inC };
  if (Math.abs(capV - inB - inC) > 1.01) out.issues.push(`KPI capitale ${capV} ≠ titoli ${inB} + liquidità ${inC}`);
  const list = tbl("Lista d'acquisto");
  const sumC = list.rows.reduce((s, r) => s + num(r[6]), 0), sumN = list.rows.reduce((s, r) => s + num(r[3]), 0);
  out.list = { n: list.rows.length, sumC, foot: list.foot };
  if (Math.abs(sumC - num(list.foot[6])) > list.rows.length) out.issues.push(`lista: somma controvalori ${sumC} ≠ totale ${list.foot[6]}`);
  if (Math.abs(sumN - num(list.foot[3])) > list.rows.length) out.issues.push(`lista: somma nominali ${sumN} ≠ totale ${list.foot[3]}`);
  if (Math.abs(num(list.foot[6]) - inB) > 1.01) out.issues.push(`lista totale ${list.foot[6]} ≠ KPI in titoli ${inB}`);
  const meta = document.querySelector('#results .panel .ph .meta') && [...document.querySelectorAll('#results .ph .meta')].map(m => m.textContent).find(t => t.includes('su XEON'));
  if (meta) { const m = meta.match(/più (.*?) su XEON/); if (m && Math.abs(num(m[1]) - inC) > 1.01) out.issues.push(`lista: «più ${m[1]} su XEON» ≠ KPI liquidità ${inC}`); }
  const linkC = list.rows.filter(r => r[1] !== 'nominale').reduce((s, r) => s + num(r[6]), 0);
  const q = kp['Quota indicizzata'];
  if (q) {
    const share = Math.round(linkC / sumC * 100);
    if (Math.abs(share - num(q.v)) > 1) out.issues.push(`quota indicizzata KPI ${q.v} ≠ lista ${share}%`);
    const m = q.s.match(/(\d+) indicizzati su (\d+)/);
    if (m && (+m[1] !== list.rows.filter(r => r[1] !== 'nominale').length || +m[2] !== list.rows.length)) out.issues.push(`KPI «${q.s}» ≠ lista (${list.rows.filter(r => r[1] !== 'nominale').length} su ${list.rows.length})`);
  }
  const rate = tbl("Rate dell'affitto e flussi della scala");
  out.rateMeta = [...document.querySelectorAll('#results .ph .meta')].map(m => m.textContent).find(t => t.startsWith('scenario'));
  out.rateFirst = rate.rows[0]; out.rateLast = rate.rows[rate.rows.length - 1]; out.nRate = rate.rows.length;
  const pr = kp['Prima e ultima rata'];
  if (pr && out.rateMeta && out.rateMeta.includes('Base') && out.rateMeta.includes('nominali')) {
    const [a, b] = pr.v.split('→').map(num);
    if (Math.abs(a - num(rate.rows[0][1])) > 1 || Math.abs(b - num(rate.rows.at(-1)[1])) > 1) out.issues.push(`KPI rate ${pr.v} ≠ tabella ${rate.rows[0][1]} → ${rate.rows.at(-1)[1]}`);
  }
  // ogni riga: liquidità dopo ≈ prima + rimborsi + cedole + tasse − affitto (con interessi XEON piccoli)
  let prev = inC;
  if (out.rateMeta && out.rateMeta.includes('Base') && out.rateMeta.includes('nominali')) rate.rows.forEach(r => {
    const exp = prev + num(r[2]) + num(r[3]) + num(r[4]) - num(r[1]);
    const got = num(r[5]);
    if (Math.abs(got - exp) > Math.max(30, Math.abs(prev) * 0.05)) out.issues.push(`riga ${r[0]}: liquidità ${got} lontana da ${Math.round(exp)} (prima ${prev} + flussi − affitto)`);
    prev = got;
  });
  const st = tbl("La scala in ogni scenario d'inflazione");
  out.stress = st.rows;
  const okN = st.rows.filter(r => r[2] === 'tutte pagate').length;
  const sc = kp['Scenari coperti'];
  if (sc && num(sc.v.split('/')[0]) !== okN) out.issues.push(`KPI scenari coperti ${sc.v} ≠ prova di stress ${okN} «tutte pagate»`);
  const baseRow = st.rows.find(r => r[0].startsWith('Base'));
  const m = out.lead.match(/restano (.*?) di liquidità/);
  if (m && baseRow && Math.abs(num(m[1]) - num(baseRow[3])) > 1) out.issues.push(`frase: restano ${m[1]} ≠ stress base ${baseRow[3]}`);
  if (rate.rows.length && out.rateMeta && out.rateMeta.includes('Base') && baseRow && Math.abs(num(rate.rows.at(-1)[5]) - num(baseRow[3])) > 1) out.issues.push(`liquidità finale tabella ${rate.rows.at(-1)[5]} ≠ stress ${baseRow[3]}`);
  if (baseRow && Math.abs(num(baseRow[1]) - num(rate.rows.at(-1)[1])) > 1 && out.rateMeta.includes('nominali') && out.rateMeta.includes('Base')) out.issues.push(`ultima rata stress ${baseRow[1]} ≠ tabella ${rate.rows.at(-1)[1]}`);
  // frase introduttiva vs KPI
  const lm = out.lead.match(/da ([\d.]+) € a ([\d.]+) €/);
  if (lm && pr) { const [a, b] = pr.v.split('→').map(num); if (num(lm[1]) !== a || num(lm[2]) !== b) out.issues.push(`frase ${lm[0]} ≠ KPI ${pr.v}`); }
  const lc = out.lead.match(/^Con ([\d.]+) €/);
  if (lc && num(lc[1]) !== capV) out.issues.push(`frase capitale ${lc[1]} ≠ KPI ${capV}`);
  const cov = kp['Coperto fino al'];
  const ly = out.lead.match(/dal (\d{4}) al (\d{4})/);
  if (cov && ly && ly[2] !== cov.v) out.issues.push(`frase «al ${ly[2]}» ≠ KPI coperto fino al ${cov.v}`);
  // scenari «da coprire» con esito negativo
  for (const r of st.rows) if (/DA COPRIRE/i.test(r[0]) && r[2] !== 'tutte pagate') out.issues.push(`scenario da coprire «${r[0].replace(/\s+/g, ' ')}» non pagato: ${r[2]}`);
  return out;
};

const CASES = [
  ['default', async p => {}],
  ['semestrali', async p => { await p.click('[data-k="xsched:semester"]'); }],
  ['fino-a-quando-200k', async p => { await p.click('[data-k="xmode:maxhorizon"]'); await settle(p); await p.fill('[data-k="xbudget"]', '200.000'); await p.locator('[data-k="xbudget"]').blur(); }],
  ['quanto-affitto-200k', async p => { await p.click('[data-k="xmode:maxscale"]'); await settle(p); await p.fill('[data-k="xbudget"]', '200.000'); await p.locator('[data-k="xbudget"]').blur(); }],
  ['quanto-affitto-500k', async p => { await p.click('[data-k="xmode:maxscale"]'); await settle(p); await p.fill('[data-k="xbudget"]', '500.000'); await p.locator('[data-k="xbudget"]').blur(); }],
  ['fino-a-quando-1000', async p => { await p.click('[data-k="xmode:maxhorizon"]'); await settle(p); await p.fill('[data-k="xbudget"]', '1.000'); await p.locator('[data-k="xbudget"]').blur(); }],
  ['quanto-affitto-1000', async p => { await p.click('[data-k="xmode:maxscale"]'); await settle(p); await p.fill('[data-k="xbudget"]', '1.000'); await p.locator('[data-k="xbudget"]').blur(); }],
  ['copri-tutti', async p => { await p.click('[data-k="rob:basso"]'); await settle(p); await p.click('[data-k="rob:basis"]'); }],
  ['solo-base', async p => { await p.click('[data-k="rob:alto"]'); await settle(p); await p.click('[data-k="rob:shock"]'); }],
  ['min-indicizzati-100', async p => { await p.fill('[data-k="xmin"]', '100'); await p.press('[data-k="xmin"]', 'Enter'); await p.locator('[data-k="xmin"]').blur(); }],
  ['incompatibili-min100-italia30', async p => { await p.fill('[data-k="xmin"]', '100'); await p.locator('[data-k="xmin"]').blur(); await settle(p); await p.fill('[data-k="xcapit"]', '30'); await p.locator('[data-k="xcapit"]').blur(); }],
  ['tetto-italia-0', async p => { await p.fill('[data-k="xcapit"]', '0'); await p.locator('[data-k="xcapit"]').blur(); }],
  ['tetto-titolo-5', async p => { await p.fill('[data-k="xtcap"]', '5'); await p.locator('[data-k="xtcap"]').blur(); }],
  ['tetto-titolo-1', async p => { await p.fill('[data-k="xtcap"]', '1'); await p.locator('[data-k="xtcap"]').blur(); }],
  ['fisco-annuale-acquisto-credito', async p => { await p.click('details.adv summary'); await p.click('[data-k="xtax:annuale"]'); await settle(p); await p.click('[data-k="xbase:acquisto"]'); await settle(p); await p.click('[data-k="xriv:credito"]'); }],
  ['senza-indicizzati', async p => { await p.click('details.adv summary'); await p.uncheck('[data-k="infl"]'); }],
  ['hicp', async p => { await p.click('[data-k="xidx:HICP"]'); }],
  ['primo-anno-2026', async p => { await p.fill('[data-k="xfrom"]', '2026'); await p.press('[data-k="xfrom"]', 'Enter'); }],
  ['ultimo-anno-2080', async p => { await p.fill('[data-k="xto"]', '2080'); await p.press('[data-k="xto"]', 'Enter'); }],
  ['un-anno-2027', async p => { await p.fill('[data-k="xto"]', '2027'); await p.press('[data-k="xto"]', 'Enter'); }],
  ['spread-10', async p => { await p.fill('[data-k="xspread"]', '10'); await p.locator('[data-k="xspread"]').blur(); }],
  ['inflazione-0', async p => { for (const k of ['xi1', 'xi2', 'xi3']) { await p.fill(`[data-k="${k}"]`, '0'); await p.locator(`[data-k="${k}"]`).blur(); await settle(p); } }],
  ['nessun-emittente', async p => { await p.click('[data-k="area:euro"]'); await settle(p); await p.click('[data-k="area:sov"]'); }],
  ['rating-AA', async p => { await p.click('[data-k="rating:AA-"]'); }],
  ['affitto-1000', async p => { await p.fill('[data-k="xl0"]', '1.000'); await p.locator('[data-k="xl0"]').blur(); }],
];

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  const res = {};
  for (const [name, act] of CASES) {
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.addInitScript(() => { localStorage.setItem('bondladder.intro', '1'); });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    await page.goto(URL);
    await page.waitForSelector('#results .kpis', { timeout: 60000 });
    const t0 = Date.now();
    try { await act(page); await settle(page); } catch (e) { logs.push('script: ' + e.message.split('\n')[0]); }
    const r = await page.evaluate(READ);
    r.secs = (Date.now() - t0) / 1000; r.logs = logs;
    res[name] = r;
    await page.screenshot({ path: `${OUT}/f-${name}.png` });
    console.log(name, r.empty ? 'VUOTO' : '', r.issues.length, 'rilievi', logs.length, 'log', r.secs + 's');
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/03-funzioni${only ? '-' + only : ''}.json`, JSON.stringify(res, null, 1));
  await browser.close();
})();
