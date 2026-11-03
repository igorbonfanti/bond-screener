"""Prove di stress: valori imposti e continuazione dell'AR(1) dopo la stagflazione; crollo: anni e TER."""
import json, numpy as np
s = json.load(open('out/stagfl.json'))['paths']; c = json.load(open('out/crollo.json'))['paths']; b = json.load(open('out/base.json'))['paths']
I = lambda P, y: np.array([q['infl'][str(y)] for q in P]); E = lambda P, y: np.array([q['eq'][str(y)] for q in P])
print('stagflazione infl 2027-2031:', [np.unique(I(s, y)).round(4).tolist() for y in range(2027, 2032)])
print('stagflazione eq 2027-2031 max:', [round(E(s, y).max(), 4) for y in range(2027, 2032)], ' quota anni a 0:', round(np.mean([np.mean(E(s, y) == 0) for y in range(2027, 2032)]), 3))
print('infl 2032 dopo stagflazione: media %.4f (se l AR ripartisse dal 5%%: %.4f; percorso base 2032: %.4f)' % (I(s, 2032).mean(), 0.023 + 0.6 * (0.05 - 0.023), I(b, 2032).mean()))
print('identico al percorso casuale senza stress dal 2032:', np.allclose(I(s, 2032), I(b, 2032)))
print('crollo eq 2026/2027/2028:', np.unique(E(c, 2027)), np.unique(E(c, 2028)), ' 2026 casuale?', E(c, 2026).std() > 0)
