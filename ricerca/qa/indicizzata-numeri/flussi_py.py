#!/usr/bin/env python3
"""Ricalcolo indipendente (Decimal, datetime) dei flussi di 3 indicizzati in uno scenario costante del 2%,
confrontato con flussi_app.json (prodotto da flussi_app.mjs). Uso: python3 flussi_py.py"""
import json, calendar, datetime as dt
from decimal import Decimal as D, ROUND_DOWN, ROUND_HALF_UP, getcontext
getcontext().prec = 40
J = json.load(open('../../../data/inflazione/inflazione.json'))
APP = json.load(open('flussi_app.json'))
SETTLE = dt.date.fromisoformat(APP['settle'])
T = D('0.125'); BOLLO = D('0.002'); PI = D('0.02')

def r5(x): return x.quantize(D('0.000001'), ROUND_DOWN).quantize(D('0.00001'), ROUND_HALF_UP)

def mkser(known):
    s = {k: D(str(v)) for k, v in known.items()}
    last = max(s)
    def get(y, m):
        k = f"{y}-{m:02d}"
        if k in s: return s[k]
        py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
        v = get(py, pm) * D(float((1 + PI) ** (D(1) / 12)))  # proiezione mensile (1+π)^(1/12)
        s[k] = v; return v
    return get
def back(y, m, k):
    i = y * 12 + m - 1 - k; return i // 12, i % 12 + 1
def IR(get, d):
    a = get(*back(d.year, d.month, 3)); b = get(*back(d.year, d.month, 2))
    return r5(a + D(d.day - 1) / D(calendar.monthrange(d.year, d.month)[1]) * (b - a))
HICP = mkser(J['hicp']['valori']); FOI = mkser(J['foi']['valori'])
def CI(get, d, base): return r5(IR(get, d) / D(str(base)))

def cdates(mat, months, frm, to):
    out = []
    for y in range(frm.year - 1, to.year + 1):
        for m in months:
            d = dt.date(y, m, min(mat.day, calendar.monthrange(y, m)[1]))
            if frm < d <= min(to, mat): out.append(d)
    return sorted(out)
def prev_next(mat, months, d):
    ds = cdates(mat, months, d - dt.timedelta(800), d + dt.timedelta(400))
    nx = [x for x in ds if x > d][0]; pv = [x for x in ds if x <= d][-1]
    return pv, nx
def bollo(mat, mv):  # pro rata giorni, al 31/12 o a scadenza
    out = []
    for y in range(SETTLE.year, mat.year + 1):
        a = max(SETTLE, dt.date(y, 1, 1)); b = min(mat, dt.date(y + 1, 1, 1))
        if b <= a: continue
        at = min(dt.date(y, 12, 31), mat)
        out.append((at, 'bollo', -BOLLO * mv(at) * D((b - a).days) / 365))
    return out
def lin_price(p, mat):
    Tt = (mat - SETTLE).days
    return lambda d: D(str(p)) + (100 - D(str(p))) * D(min(1, max(0, (d - SETTLE).days / Tt)))

res = {}
# --- BTP€i 15/05/2039 2,40%
t = J['titoli']['IT0005547812']; mat = dt.date(2039, 5, 15); p = D('98.44'); cr = D('2.4'); base = t['irBase']; issue = D('99.674')
ci = lambda d: CI(HICP, d, base)
pv, nx = prev_next(mat, [5, 11], SETTLE)
acc = cr / 2 * D((SETTLE - pv).days) / D((nx - pv).days)
cis = ci(SETTLE)
cost = (p + acc) * cis - acc * cis * T
fl = [(c, 'coupon', cr / 2 * ci(c) * (1 - T)) for c in cdates(mat, [5, 11], SETTLE, mat)]
ciT = max(D(1), ci(mat))
fl.append((mat, 'redemption', 100 * ciT - max(D(0), 100 * ciT - issue) * T))
lp = lin_price(p, mat); fl += bollo(mat, lambda d: lp(d) * ci(d))
res['IT0005547812'] = (cost, cis, fl)

# --- BTP Italia 14/03/2028 2% (classico, regola del massimo)
t = J['titoli']['IT0005532723']; mat = dt.date(2028, 3, 14); p = D('102.26'); cr = D('2'); base = D(str(t['irBase']))
NI = lambda d: IR(FOI, d)
pv, nx = prev_next(mat, [3, 9], SETTLE)
acc = cr / 2 * D((SETTLE - pv).days) / D((nx - pv).days)
cis = r5(NI(SETTLE) / base)
cost = (p + acc) * cis - acc * cis * T
fl = []; b = base; bases = {}
for c in cdates(mat, [3, 9], SETTLE, mat):
    k = r5(NI(c) / b); bases[c] = b
    fl.append((c, 'coupon', cr / 2 * max(k, D(1)) * (1 - T)))
    if k > 1: fl.append((c, 'rivalutazione', 100 * (k - 1) * (1 - T)))
    b = max(b, NI(c))
fl.append((mat, 'redemption', 100 - max(D(0), 100 - p) * T))
lp = lin_price(p, mat)
# bollo "corretto": prezzo reale × CI rispetto alla base del semestre in corso (non alla base iniziale)
def ci_cur(d):
    bb = base
    for c in cdates(mat, [3, 9], SETTLE, mat):
        if c <= d: bb = max(bb, NI(c))
    return r5(NI(d) / bb)
bol_app = bollo(mat, lambda d: lp(d) * r5(NI(d) / base)); bol_ok = bollo(mat, lambda d: lp(d) * ci_cur(d))
res['IT0005532723'] = (cost, cis, fl + bol_app, bol_ok)

# --- BTP Italia Sì 23/06/2031 1,6%
t = J['titoli']['IT0005713547']; mat = dt.date(2031, 6, 23); p = D('100.54'); cr = D('1.6'); base = D(str(t['irBase']))
pv, nx = prev_next(mat, [6, 12], SETTLE)
frac = D((SETTLE - pv).days) / D((nx - pv).days)
acc = cr / 2 * frac
cinf = max(D(0), r5(NI(SETTLE) / base) - 1) * 100
cost_lit = p + acc + cinf * frac - (acc + cinf * frac) * T          # lettura letterale (convenzione BTP sulla somma)
cost_full = p + acc + cinf - (acc + cinf) * T                       # lettura alternativa: componente inflazione intera
fl = []; prevNI = base
for c in cdates(mat, [6, 12], SETTLE, mat):
    n = NI(c); g = cr / 2 + 100 * max(D(0), r5(n / prevNI) - 1)
    fl.append((c, 'coupon', g * (1 - T))); prevNI = n
fl.append((mat, 'redemption', 100 - max(D(0), 100 - p) * T))
lp = lin_price(p, mat); fl += bollo(mat, lp)
res['IT0005713547'] = (cost_lit, D(1), fl, cost_full)

rep = {}
for it in APP['items']:
    r = res[it['isin']]; cost, cis, fl = r[0], r[1], r[2]
    mine = sorted([(d.isoformat(), k, float(v)) for d, k, v in fl])
    app = sorted([(f['day'], f['kind'], f['net']) for f in it['flows']])
    dmax = max(abs(a[2] - b[2]) for a, b in zip(mine, app)) if len(mine) == len(app) and all(a[:2] == b[:2] for a, b in zip(mine, app)) else 'STRUTTURA DIVERSA'
    row = {'n_flussi': (len(mine), len(app)), 'costo_py': float(cost), 'costo_app': it['cost'], 'ci_py': float(cis), 'ci_app': it['ciSettle'],
           'max_diff_flussi': dmax, 'somma_py': sum(x[2] for x in mine), 'somma_app': sum(x[2] for x in app)}
    if it['isin'] == 'IT0005532723':
        row['bollo_app'] = sum(float(x[2]) for x in r[2] if x[1] == 'bollo'); row['bollo_base_corrente'] = sum(float(x[2]) for x in r[3])
    if it['isin'] == 'IT0005713547': row['costo_py_componente_intera'] = float(r[3])
    rep[it['isin']] = row
print(json.dumps(rep, indent=1))
for isin in ('IT0005532723',):
    print(isin, [(d.isoformat(), k, round(float(v), 6)) for d, k, v in res[isin][2] if k != 'bollo'])
