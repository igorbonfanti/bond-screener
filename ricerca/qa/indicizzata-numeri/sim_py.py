#!/usr/bin/env python3
"""Simulazione di cassa indipendente del piano (piano_<tag>.json, da piano_app.mjs).
 - ricalcola in Python i flussi dei BTP€i e BTP Italia del piano nello scenario base (CI MEF, regola del massimo, Italia Sì);
 - ricalcola le rate dell'affitto, la crescita XEON e il deflatore;
 - simula la cassa evento per evento e confronta il saldo dopo ogni rata con byScen[s][k].bal.
Uso: python3 sim_py.py <tag> [scenario]"""
import json, sys, calendar, math, datetime as dt
from decimal import Decimal as D, ROUND_DOWN, ROUND_HALF_UP
tag = sys.argv[1] if len(sys.argv) > 1 else 'base'
P = json.load(open(f'piano_{tag}.json'))
J = json.load(open('../../../data/inflazione/inflazione.json'))
CSV = {l.split(';')[0]: l.split(';') for l in open('../../../data/stfi-latest.csv', encoding='utf-8')}
cfg = P['cfg']; SETTLE = dt.date.fromisoformat(P['settle'])
T = D('0.125'); BOLLO = D('0.002')
infl = {int(k): v for k, v in cfg['inflBase'].items()}
y0 = min(infl); tail = infl[max(infl)]
SCEN = {'base': (infl, 0), 'alto': ({y0: .035}, 0), 'basso': ({y0: .01}, 0),
        'shock': ({y0: .08, y0+1: .08, y0+2: .07, y0+3: .06, y0+4: .05, y0+5: tail}, 0), 'basis': (infl, .005)}
def rate(r, y):
    ks = sorted(r); v = r[ks[0]]
    for k in ks:
        if k <= y: v = r[k]
    return v
def r5(x): return x.quantize(D('0.000001'), ROUND_DOWN).quantize(D('0.00001'), ROUND_HALF_UP)
def mkser(known, f):
    s = {k: D(str(v)) for k, v in known.items()}
    def get(y, m):
        k = f"{y}-{m:02d}"
        if k in s: return s[k]
        py, pm = (y, m-1) if m > 1 else (y-1, 12)
        v = get(py, pm) * D(repr((1 + f(y)) ** (1/12))); s[k] = v; return v
    return get
def IR(get, d):
    i3 = d.year*12 + d.month - 1 - 3; i2 = i3 + 1
    a = get(i3//12, i3 % 12 + 1); b = get(i2//12, i2 % 12 + 1)
    return r5(a + D(d.day-1) / D(calendar.monthrange(d.year, d.month)[1]) * (b - a))
def cdates(mat, months, frm, to):
    return sorted(dt.date(y, m, min(mat.day, calendar.monthrange(y, m)[1])) for y in range(frm.year-1, to.year+1) for m in months
                  if frm < dt.date(y, m, min(mat.day, calendar.monthrange(y, m)[1])) <= min(to, mat))
def bollo(mat, mv):
    out = []
    for y in range(SETTLE.year, mat.year+1):
        a = max(SETTLE, dt.date(y, 1, 1)); b = min(mat, dt.date(y+1, 1, 1))
        if b > a: at = min(dt.date(y, 12, 31), mat); out.append((at, 'bollo', -BOLLO * mv(at) * D((b-a).days) / 365))
    return out
def lin(p, mat):
    Tt = (mat - SETTLE).days
    return lambda d: p + (100 - p) * D(min(1, max(0, (d - SETTLE).days / Tt)))

def flows_linker(isin, sid):
    r, basis = SCEN[sid]
    hicp = mkser(J['hicp']['valori'], lambda y: rate(r, y)); foi = mkser(J['foi']['valori'], lambda y: rate(r, y) + basis)
    t = J['titoli'][isin]; mat = dt.date.fromisoformat(t['scadenza']); row = CSV[isin]
    p = D(row[13].replace(',', '.')); cr = D(str(t['cedolaReale'])); months = t['mesiCedola']; base = D(str(t['irBase']))
    issue = D(row[27].replace(',', '.')) if row[27] else D(100)
    out = []
    if t['tipo'] == 'BTPEI':
        ci = lambda d: r5(IR(hicp, d) / base)
        for c in cdates(mat, months, SETTLE, mat): out.append((c, 'coupon', cr/2*ci(c)*(1-T)))
        ciT = max(D(1), ci(mat)); out.append((mat, 'redemption', 100*ciT - max(D(0), 100*ciT - issue)*T))
        lp = lin(p, mat); out += bollo(mat, lambda d: lp(d)*ci(d))
    elif t.get('sottotipo') == 'BTP_ITALIA_SI':
        prev = base
        for c in cdates(mat, months, SETTLE, mat):
            n = IR(foi, c); out.append((c, 'coupon', (cr/2 + 100*max(D(0), r5(n/prev) - 1))*(1-T))); prev = n
        out.append((mat, 'redemption', 100 - max(D(0), 100-p)*T)); lp = lin(p, mat); out += bollo(mat, lp)
    else:
        b = base
        for c in cdates(mat, months, SETTLE, mat):
            k = r5(IR(foi, c)/b); out.append((c, 'coupon', cr/2*max(k, D(1))*(1-T)))
            if k > 1: out.append((c, 'rivalutazione', 100*(k-1)*(1-T)))
            b = max(b, IR(foi, c))
        out.append((mat, 'redemption', 100 - max(D(0), 100-p)*T))
        lp = lin(p, mat); out += bollo(mat, lambda d: lp(d)*r5(IR(foi, d)/base))   # come l'app (vedi rilievo sul bollo)
    return [(d, k, float(v)) for d, k, v in out]

def run(sid):
    r, basis = SCEN[sid]; pi = (lambda y: rate(r, y) + basis) if cfg['liabIndex'] == 'FOI' else (lambda y: rate(r, y))
    estr = lambda y: max(0, cfg['estr'] + 0.5*(rate(r, y) - rate(infl, y)))
    net = lambda y: (estr(y) + 0.00085 - 0.001)*0.74 - 0.002
    # rate dell'affitto
    L, amt = [], cfg['L0']
    for y in range(cfg['yearFrom'], P['horizon']+1):
        if y > cfg['yearFrom'] and not cfg.get('flat'): amt *= 1 + pi(y-1) + cfg['realSpread']
        if cfg['schedule'] == 'semester': L += [(dt.date(y, 1, 1), amt/2), (dt.date(y, 7, 1), amt/2)]
        else: L.append((dt.date(y, 1, 1), amt))
    L = [(d, a*P['lam']) for d, a in L]
    ev, maxdiff = [], 0.0
    for pos in P['positions']:
        k = pos['nominal']/100
        app = [(dt.date.fromisoformat(d), kd, v) for d, kd, v in P['flows'][pos['isin']][sid]]
        if pos['type'] != 'NOM':
            mine = flows_linker(pos['isin'], sid)
            a = sorted(app); m = sorted(mine)
            if len(a) != len(m) or any(x[:2] != y[:2] for x, y in zip(a, m)): print('STRUTTURA DIVERSA', pos['isin'], len(a), len(m)); fl = app
            else: maxdiff = max(maxdiff, max(abs(x[2]-y[2])*k for x, y in zip(a, m))); fl = mine
        else: fl = app
        ev += [(d, kd, v*k) for d, kd, v in fl]
    # cassa evento per evento: (A) convenzione dell'app (tasso continuo ln(1+r)/365,25 al giorno);
    # (B) capitalizzazione annua «naturale» (1+r)^(giorni/giorni dell'anno)
    def sim(mode):
        cash, t, bals = P['cash0'], SETTLE, []
        evs = sorted([(d, 0 if kd != 'bollo' else 1, v) for d, kd, v in ev] + [(d, 2, -a) for d, a in L])  # rata dopo i flussi dello stesso giorno, il bollo dello stesso giorno dopo la rata
        evs = sorted([(d, (0 if o == 0 else (2 if o == 1 else 1)), v) for d, o, v in evs])
        for d, o, v in evs:
            while t < d:
                ye = min(d, dt.date(t.year+1, 1, 1)); n = (ye - t).days; ylen = 366 if calendar.isleap(t.year) else 365
                cash *= math.exp(math.log(1+net(t.year))*n/365.25) if mode == 'A' else (1+net(t.year))**(n/ylen); t = ye
            cash += v
            if o == 1: bals.append(cash)
        return bals
    A, B = sim('A'), sim('B')
    app_bal = [x['bal'] for x in P['byScen'][sid]]
    dA = max(abs(a-b) for a, b in zip(A, app_bal)); dB = max(abs(a-b) for a, b in zip(B, app_bal))
    # deflatore
    def defl(d):
        f, t = 1.0, SETTLE
        while t < d:
            e = min(d, dt.date(t.year+1, 1, 1)); f *= (1+pi(t.year))**((e-t).days/365.25); t = e
        return f
    dd = max(abs(defl(dt.date.fromisoformat(x['due'])) - x['defl']) for x in P['byScen'][sid])
    need_ok = max(abs(a - x['need']) for (_, a), x in zip(L, P['byScen'][sid]))
    return {'scen': sid, 'n_rate': len(L), 'diff_flussi_linker_eur': maxdiff, 'diff_saldo_convApp': dA, 'diff_saldo_annua': dB, 'saldo_min_py': min(A),
            'anno_saldo_min': L[A.index(min(A))][0].isoformat(), 'diff_rate': need_ok, 'diff_deflatore': dd}

sids = sys.argv[2:] or [s['id'] for s in P['scen']]
for s in sids: print(json.dumps(run(s)))
