"""Controllo 2: percorsi rifatti a mano. Uso: python3 check_walk.py out/<nome>.json
Indipendente dal codice JS: ricalcola dall'inflazione del percorso l'affitto, il deflatore, il tasso netto XEON,
i flussi a scadenza di due BTP€i (CI con il metodo MEF), poi rifà il conto giorno per giorno (eventi ordinati:
flussi, spese extra, rata, misura al 1/1) con ETF pro rata, bollo 0,2% al 31/12, vendite al 26% sulla plusvalenza a
costo medio, e confronta fallimento, patrimonio e venduto con walk()."""
import json, sys, math
from datetime import date
import numpy as np

fn = sys.argv[1] if len(sys.argv) > 1 else 'out/base.json'
d = json.load(open(fn))
E0 = date(1970, 1, 1)
day = lambda y, m, dd: (date(y, m, dd) - E0).days
ymd = lambda n: date.fromordinal(E0.toordinal() + n)
infl_json = json.load(open('/home/user/bond-screener/data/inflazione/inflazione.json'))
MU = 0.023 if 'inflMean' not in d['mc'].get('params', {}) else d['mc']['params']['inflMean']
cfg = d['cfg']; lam = d['plan']['lam']
bad = []
def chk(name, a, b, tol):
    if not (abs(a - b) <= tol): bad.append(f'{name}: atteso {a:.6f}, modello {b:.6f}')

def t6r5(x):
    t = math.trunc(x * 1e6 + (1e-7 if x >= 0 else -1e-7)) / 1e6
    return round(t * 1e5 + (1e-9 if t >= 0 else -1e-9)) / 1e5

def series(known, rate):
    """indice mensile proiettato: I(m) = I(m-1)*(1+pi_anno(m))^(1/12) dopo l'ultimo mese pubblicato"""
    ks = sorted(known); out = dict(known); y, m = map(int, ks[-1].split('-'))
    def get(yy, mm):
        nonlocal y, m
        key = f'{yy}-{mm:02d}'
        while key not in out:
            v = out[f'{y}-{m:02d}']; m += 1
            if m > 12: y, m = y + 1, 1
            out[f'{y}-{m:02d}'] = v * (1 + rate(y)) ** (1 / 12)
        return out[key]
    return get

def ci_fn(get, irbase):
    def ci(n):
        dt = ymd(n); y, m = dt.year, dt.month
        a = (y * 12 + m - 1 - 3); b = a + 1
        Ia, Ib = get(a // 12, a % 12 + 1), get(b // 12, b % 12 + 1)
        nd = (date(y + (m == 12), m % 12 + 1, 1) - date(y, m, 1)).days
        return t6r5(t6r5(Ia + (dt.day - 1) / nd * (Ib - Ia)) / irbase)
    return ci

nwalk = 0
FAILS = []; lab_now = ['']
for key, P in d['detail'].items():
    infl = {int(k): v for k, v in P['infl'].items()}
    ys = sorted(infl); rate = lambda y: infl.get(y, infl[ys[-1]]) if y >= ys[0] else infl[ys[0]]
    eq = {int(k): v for k, v in P['eq'].items()}
    settle = P['settle']; bollo = P['bollo']; tax = P['taxEq']
    # affitto: L(Y) = L0 * prod (1 + pi_{k} + spread), k = primo anno .. Y-1; rate semestrali metà al 1/1 e metà al 1/7
    L = []; Lv = cfg['L0']
    for y in range(cfg['yearFrom'], d['plan']['horizon'] + 1):
        if y > cfg['yearFrom']: Lv *= 1 + rate(y - 1) + cfg['realSpread']
        if cfg['schedule'] == 'semester': L += [(day(y, 1, 1), Lv / 2 * lam), (day(y, 7, 1), Lv / 2 * lam)]
        else: L.append((day(y, 1, 1), Lv * lam))
    for (dd, a), l in zip(L, P['L']):
        chk(f'p{key} rata {ymd(dd)}', a, l['amount'], 1e-6 * a); chk(f'p{key} data rata', dd, l['day'], 0)
    assert len(L) == len(P['L']), (len(L), len(P['L']))
    # deflatore FOI (= HICP nel modello) e tasso XEON netto
    def defl(n):
        f, t = 1.0, settle
        while t < n:
            y = ymd(t).year; end = min(n, day(y + 1, 1, 1)); f *= (1 + rate(y)) ** ((end - t) / 365.25); t = end
        return f
    for y, v in P['deflYear'].items(): chk(f'p{key} deflatore {y}', defl(day(int(y), 1, 1)), v, 1e-9)
    xe = lambda y: (max(0, d['estrBase'] + 0.5 * (rate(y) - MU)) + 0.00085 - 0.001) * (1 - 0.26) - 0.002
    for y, v in P['gYear'].items(): chk(f'p{key} XEON {y}', math.log(1 + xe(int(y))), v, 1e-12)
    # flussi a scadenza di due BTP€i con il CI del percorso (HICP proiettato dall'ultimo mese pubblicato)
    get = series(infl_json['hicp']['valori'], rate)
    for pos in d['plan']['positions']:
        if pos['isin'] not in ('IT0004545890', 'IT0005482994'): continue
        tj = infl_json['titoli'][pos['isin']]; ci = ci_fn(get, tj['irBase']); mat = pos['maturity']
        c = ci(mat); red = 100 * max(1, c); net = red - 0.125 * max(0, red - (pos['issuePrice'] or 100)) + tj['cedolaReale'] / 2 * c * 0.875
        model = sum(f['net'] for f in P['flows'] if f['day'] == mat and f['isin'] == pos['isin'] and f['kind'] != 'bollo') / (pos['nominal'] / 100)
        chk(f"p{key} flusso a scadenza {pos['isin']} (CI {c})", net, model, 1e-6)
    # conto, ETF, vendite
    def run(flows, cash0, etf0):
        ev = [(f['day'], 0, f['net'], None) for f in flows] + [(x['day'], 1, x['amount'] * defl(x['day']), None) for x in P['extras']] \
           + [(dd, 2, a, k) for k, (dd, a) in enumerate(L)] + [(day(y, 1, 1), 3, None, j) for j, y in enumerate(P['years'])]
        ev.sort(key=lambda e: (e[0], e[1]))
        cash, Ev, basis, now, fail, sold = cash0, etf0, etf0, settle, None, 0.0
        w = [0.0] * len(P['years'])
        def advance(to):
            nonlocal cash, Ev, now
            t = now
            while t < to:  # conto: tasso continuo dell'anno; ETF: rendimento dell'anno pro rata, bollo al passaggio d'anno
                y = ymd(t).year; ye = day(y + 1, 1, 1); end = min(to, ye)
                cash *= math.exp(math.log(1 + xe(y)) * (end - t) / 365.25)
                Ev *= (1 + eq[y]) ** ((end - t) / (ye - day(y, 1, 1)))
                if end == ye: Ev *= 1 - bollo
                t = end
            now = to
        def sell(need):
            nonlocal Ev, basis, sold
            if Ev <= 0 or need <= 0: return 0.0
            gain_share = max(0.0, (Ev - basis) / Ev)
            gross = min(need / (1 - tax * gain_share), Ev)
            basis -= basis * gross / Ev; Ev -= gross; sold += gross
            return gross * (1 - tax * gain_share)
        for (dd, t, v, k) in ev:
            if fail is not None and t != 3: continue
            if dd > now: advance(dd)
            if t == 0: cash += v
            elif t == 1:
                got = sell(v); cash -= v - got
                if cash < -0.5:
                    cash += sell(-cash)
                    if cash < -0.5: fail = next((i for i, (ld, _) in enumerate(L) if ld >= dd), len(L) - 1)
            elif t == 2:
                cash -= v
                if cash < -0.5:
                    cash += sell(-cash)
                    if cash < -0.5:
                        fail = k
                        rem = sum(f['net'] / (1 + P['disc']) ** ((f['day'] - dd) / 365.25) for f in flows if f['day'] > dd)
                        FAILS.append((lab_now[0], -cash, v, rem / defl(dd), ymd(dd).year))
            else:
                bonds = sum(f['net'] / (1 + P['disc']) ** ((f['day'] - dd) / 365.25) for f in flows if f['day'] > dd)
                w[k] = 0.0 if fail is not None else (max(0, cash) + bonds + Ev - tax * max(0, Ev - basis)) / defl(dd)
        return fail, w, sold
    for lab, args, res in (('mix', (P['flows'], P['cash0'], P['etf0']), P['res']), ('etf', ([], 0, P['total']), P['resEtf'])):
        lab_now[0] = lab; fail, w, sold = run(*args); nwalk += 1
        if fail != res['fail']: bad.append(f'p{key} {lab} fallimento {fail} vs {res["fail"]}')
        chk(f'p{key} {lab} venduto', sold, res['sold'], 1e-6 * max(1, sold))
        for j, (a, b) in enumerate(zip(w, res['w'])): chk(f'p{key} {lab} patrimonio {P["years"][j]}', a, b, 1e-6 * max(1, a))
print(f'{fn}: {len(d["detail"])} percorsi, {nwalk} simulazioni rifatte; differenze: {len(bad)}')
for b in bad[:25]: print('  ', b)

for lab in ('mix', 'etf'):
    F = [x for x in FAILS if x[0] == lab]
    if not F: continue
    dfc = np.array([x[1] for x in F]); rent = np.array([x[2] for x in F]); rem = np.array([x[3] for x in F])
    print(f"{lab}: {len(F)} fallimenti per la rata (non per le spese extra); scoperto mediano {np.median(dfc):.0f} € ({np.median(dfc / rent):.1%} della rata), "
          f"min {dfc.min():.2f} €, quota con scoperto < 1% della rata {(dfc / rent < 0.01).mean():.0%}, < 10% {(dfc / rent < 0.10).mean():.0%}; "
          f"titoli ancora in mano (euro di oggi) mediana {np.median(rem):.0f} €; anni {sorted(set(x[4] for x in F))[:8]}")
