#!/usr/bin/env python3
"""Prove offline delle funzioni di scripts/fetch_inflation.py (append-only, avanzamento base BTP Italia)."""
import importlib.util, json, datetime as dt
spec = importlib.util.spec_from_file_location('fi', '../../../scripts/fetch_inflation.py'); fi = importlib.util.module_from_spec(spec); spec.loader.exec_module(fi)
J = json.load(open('../../../data/inflazione/inflazione.json')); cfg = json.load(open('../../../data/inflazione/titoli.json'))
# 1) append-only: un mese rivisto non sovrascrive, viene segnalato; un mese nuovo si aggiunge
s, rev = fi.merge_append_only({'2026-08': 103.66}, {'2026-08': 103.70, '2026-09': 104.29})
print('append-only:', s, rev)
# 2) avanzamento della base: 22/11/2026 (cedola del BTP Italia 2028 nov) con FOI fino a set 2026
for g in ('2026-11-21', '2026-11-22', '2026-12-23', '2027-03-14'):
    t = fi.roll_bases(cfg['titoli'], J['foi']['valori'], dt.date.fromisoformat(g))
    print(g, {k: (v['irBase'], v['baseDal'], v.get('avviso')) for k, v in t.items() if v['tipo'] == 'BTPITALIA'})
# 3) Italia Sì in deflazione: la base segue l'indice anche verso il basso; i classici tengono il massimo
foi = dict(J['foi']['valori']); foi.update({'2026-10': 104.0, '2026-11': 103.5, '2026-12': 103.0, '2027-01': 102.9})
t = fi.roll_bases(cfg['titoli'], foi, dt.date(2027, 3, 15))
print('deflazione:', {k: (v['irBase'], v['baseDal']) for k, v in t.items() if v['tipo'] == 'BTPITALIA'})
