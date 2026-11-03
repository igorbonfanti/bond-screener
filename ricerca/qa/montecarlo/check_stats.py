"""Controllo 3: statistiche dai risultati per percorso (fail, w, sold) esportati, con numpy; e il patrimonio
all'inizio. Uso: python3 check_stats.py out/<nome>.json"""
import json, sys
import numpy as np
fn = sys.argv[1] if len(sys.argv) > 1 else 'out/base.json'
d = json.load(open(fn)); mc = d['mc']; A = d['allRes']; K = len(mc['dues'])
bad = []
def close(n, a, b, tol=1e-9):
    if not np.allclose(a, b, rtol=tol, atol=1e-9): bad.append(f'{n}: {np.round(a, 4)[:6]} vs {np.round(b, 4)[:6]}')
for lab, key in (('mix', 'mix'), ('etf', 'allEtf')):
    R = [r[lab] for r in A]; S = mc[key]
    fail = np.array([K if r['fail'] is None else r['fail'] for r in R])
    paid = np.array([(fail > k).mean() for k in range(K)])
    close(f'{lab} paidTo', paid, S['paidTo']); close(f'{lab} pAll', paid[-1], S['pAll'])
    W = np.array([r['w'] for r in R])
    for q, nm in ((0.1, 'p10'), (0.5, 'p50'), (0.9, 'p90')):
        close(f'{lab} {nm}', np.quantile(W, q, axis=0), [w[nm] for w in S['wealth']])
    sold = np.array([r['sold'] for r in R])
    close(f'{lab} soldShare', (sold > 1).mean(), S['soldShare']); close(f'{lab} soldMedian', np.median(sold), S['soldMedian'])
    print(f"{lab}: pAll {paid[-1]:.4f}  fallimenti {np.sum(fail < K)}  vendono {(sold > 1).mean():.4f}  "
          f"patrimonio 1° anno p10/p50/p90 {np.quantile(W[:, 0], [.1, .5, .9]).round(0)}  ultimo {np.quantile(W[:, -1], [.1, .5, .9]).round(0)}  "
          f"percorsi con patrimonio 0 all'ultimo anno {(W[:, -1] == 0).mean():.4f}")
    if np.any(np.diff(paid) > 1e-12): bad.append(f'{lab} paidTo non decrescente')
print('controlli statistiche:', 'OK' if not bad else bad)
p = d['plan']
b0 = np.array([r['bond0'] for r in A]); im = np.array([r['inflMean'] for r in A])
print(f"titoli al regolamento, flussi del percorso scontati all'irr {p['irr']:.4%}: mediana {np.median(b0):.0f}, p10 {np.quantile(b0, .1):.0f}, "
      f"p90 {np.quantile(b0, .9):.0f}; costo titoli {p['bondCost']:.0f}; corr. con inflazione media del percorso {np.corrcoef(b0, im)[0, 1]:.3f}")
first = mc['mix']['wealth'][0]['year']
print(f"capitale {mc['total']:.0f}; patrimonio mediano al 1/1/{first} scala+ETF {mc['mix']['wealth'][0]['p50']:.0f}, tutto ETF {mc['allEtf']['wealth'][0]['p50']:.0f} "
      f"(dopo la prima rata del {d['cfg']['yearFrom']}: {d['cfg']['L0'] * p['lam']:.0f})")
# ampiezza della fascia del primo anno: quanto dipende dall'inflazione futura (look-ahead) nella parte titoli
Wm = np.array([r['mix']['w'][0] for r in A]); print('corr. patrimonio scala+ETF al primo 1/1 con inflazione media futura:', round(np.corrcoef(Wm, im)[0, 1], 3))
