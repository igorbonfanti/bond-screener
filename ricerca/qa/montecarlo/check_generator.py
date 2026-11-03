"""Controllo 1: il generatore. Legge i percorsi esportati da gen.mjs (50.000) e da export.mjs (i 2.000 del motore).
Stime indipendenti: media e deviazione stazionaria dell'AR(1), persistenza (regressione), rendimento composto
mediano, volatilità del log, curtosi e quantili della t di Student normalizzata (scipy), TER."""
import json, sys
import numpy as np
from scipy import stats

m = json.load(open('out/gen_meta.json')); N, T, p = m['N'], m['T'], m['p']
I = np.fromfile('out/gen_infl.bin').reshape(N, T); E = np.fromfile('out/gen_eq.bin').reshape(N, T)
ok = lambda c: 'OK' if c else 'NO'
print('--- inflazione AR(1), 50.000 percorsi ---')
print('anno0 = infl0', I[:, 0].min(), I[:, 0].max())
# media per anno: E[pi_t] = mu + phi^t (pi0 - mu)
for t in [1, 2, 5, 10, 20]:
    th = p['inflMean'] + p['inflAr'] ** t * (p['infl0'] - p['inflMean'])
    sdth = p['inflSd'] * np.sqrt(1 - p['inflAr'] ** (2 * t))
    print(f't={t:2d} media {I[:, t].mean():.5f} (teoria {th:.5f})  sd {I[:, t].std():.5f} (teoria {sdth:.5f})')
late = I[:, 10:]
print('stazionaria: media', round(late.mean(), 5), 'sd', round(late.std(), 5), '-> attese', p['inflMean'], p['inflSd'])
x, y = I[:, 5:-1].ravel(), I[:, 6:].ravel()
phi = np.cov(x, y)[0, 1] / x.var()
res = y - (p['inflMean'] + p['inflAr'] * (x - p['inflMean']))
print('persistenza stimata', round(phi, 4), 'sd innovazione', round(res.std(), 5), 'teoria', round(p['inflSd'] * np.sqrt(1 - p['inflAr'] ** 2), 5),
      'normalita innov. (curtosi in eccesso)', round(stats.kurtosis(res), 3))
print('quota anni con inflazione < 0:', round((late < 0).mean(), 4))

print('--- ETF ---')
g = np.log(1 + E + p['eqTer'])                           # log del lordo prima del TER
z = (g - np.log(1 + p['eqMu'])) / p['eqSd']
print('mediana del rendimento lordo (pre-TER)', round(np.median(E + p['eqTer']), 5), 'atteso', p['eqMu'])
print('media del log lordo -> composto', round(np.exp(g.mean()) - 1, 5), 'atteso', p['eqMu'])
print('mediana netta (dopo TER)', round(np.median(E), 5), 'atteso', round(p['eqMu'] - p['eqTer'], 5))
print('sd di z', round(z.std(), 4), '(1)', ' sd log', round(g.std(), 4), 'atteso', p['eqSd'])
print('curtosi in eccesso di z', round(stats.kurtosis(z.ravel()), 3), 'teoria t5 = 6 (stima rumorosa)')
tq = stats.t(df=5, scale=np.sqrt(3 / 5))
for q in [0.001, 0.01, 0.05, 0.5, 0.95, 0.99]:
    print(f'  quantile {q}: campione {np.quantile(z, q):+.4f}  t5 normalizzata {tq.ppf(q):+.4f}  normale {stats.norm.ppf(q):+.4f}')
ks = stats.kstest(z.ravel()[:200000], tq.cdf)
print('KS contro t5 normalizzata: stat', round(ks.statistic, 5), 'p', round(ks.pvalue, 3))
ks2 = stats.kstest(z.ravel()[:200000], 'norm')
print('KS contro normale: stat', round(ks2.statistic, 5), 'p', ks2.pvalue)
print('media aritmetica netta annua', round(E.mean(), 5), ' anno peggiore 1/1000', round(np.quantile(E, 0.001), 4),
      ' quota anni < -30%', round((E < -0.3).mean(), 5))
print('correlazione eq-inflazione stesso anno', round(np.corrcoef(E[:, 1:].ravel(), I[:, 1:].ravel())[0, 1], 4))
print('autocorrelazione eq', round(np.corrcoef(E[:, 1:-1].ravel(), E[:, 2:].ravel())[0, 1], 4))

# i 2.000 percorsi effettivamente usati dal motore nel caso base
d = json.load(open('out/base.json'))
P = d['paths']; ys = sorted(P[0]['infl'], key=int)
I2 = np.array([[q['infl'][y] for y in ys] for q in P]); E2 = np.array([[q['eq'][y] for y in ys] for q in P])
print('--- motore, caso base: %d percorsi, anni %s-%s ---' % (len(P), ys[0], ys[-1]))
print('infl anno0', np.unique(I2[:, 0]), ' inflBase', d['inflBase'])
print('infl media anni 10+', round(I2[:, 10:].mean(), 5), 'sd', round(I2[:, 10:].std(), 5))
print('eq mediana', round(np.median(E2), 5), 'sd log', round(np.log(1 + E2 + 0.0015).std(), 4))
