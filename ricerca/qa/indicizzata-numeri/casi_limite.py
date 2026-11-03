#!/usr/bin/env python3
"""Casi limite: esegue piano_app.mjs con varie impostazioni e controlla vincoli, budget, lotti, tempi, coperture."""
import json, subprocess, sys
CASES = {
 'mincost': {},
 'maxscale200k': {'alm': {'mode': 'maxscale', 'budget': 200000}},
 'maxhorizon200k': {'alm': {'mode': 'maxhorizon', 'budget': 200000}},
 'maxhorizon_stretto': {'alm': {'mode': 'maxhorizon', 'budget': 120000}},
 'semestrale': {'alm': {'schedule': 'semester'}},
 'minLinker50': {'alm': {'minLinker': 0.5}},
 'titleCap20': {'alm': {'titleCap': 0.2}},
 'minLinker50_titleCap20_maxscale': {'alm': {'minLinker': 0.5, 'titleCap': 0.2, 'mode': 'maxscale', 'budget': 200000}},
 'hicp': {'alm': {'liabIndex': 'HICP'}},
 'pochi_titoli_AAA': {'basket': {'minRating': 'AAA'}},
 'pochi_titoli_AAA_minLinker': {'basket': {'minRating': 'AAA'}, 'alm': {'minLinker': 0.5}},
 'solo_indicizzati_IT': {'basket': {'minRating': 'BBB-', 'groups': {'euro': True, 'extra': False, 'sov': False}}},
 'anno_da_2027_a_2027': {'alm': {'yearFrom': 2027, 'yearTo': 2027}},
 'anno_da_oggi_2026': {'alm': {'yearFrom': 2026, 'yearTo': 2035}},
 'tutti_robusti': {'alm': {'robust': ['base', 'alto', 'basso', 'shock', 'basis']}},
 'mip_1s': {'alm': {'mipSeconds': 0.05, 'titleCap': 0.2, 'minLinker': 0.5}},
 'maxhorizon_190320': {'alm': {'mode': 'maxhorizon', 'budget': 190320}},
 'mincost_2040': {'alm': {'yearTo': 2040}},
 'mincost_2034': {'alm': {'yearTo': 2034}},
 'paniere_vuoto': {'basket': {'groups': {'euro': False, 'extra': False, 'sov': False}}},
 'paniere_vuoto_maxscale': {'basket': {'groups': {'euro': False, 'extra': False, 'sov': False}}, 'alm': {'mode': 'maxscale'}},
 'robust_vuoto': {'alm': {'robust': []}},
 'maxhorizon_budget_minimo': {'alm': {'mode': 'maxhorizon', 'budget': 1000}},
 'maxscale_semestrale_cap': {'alm': {'mode': 'maxscale', 'budget': 250000, 'schedule': 'semester', 'titleCap': 0.2}},
}
only = sys.argv[1:]
rows = []
for tag, ov in CASES.items():
    if only and tag not in only: continue
    out = subprocess.run(['node', 'piano_app.mjs', json.dumps(ov), tag], capture_output=True, text=True, timeout=300)
    try: r = json.loads(out.stdout.strip().splitlines()[-1])
    except Exception: rows.append({'tag': tag, 'ERRORE': out.stderr[-800:]}); continue
    if r.get('crash') or r.get('empty'): rows.append(r); continue
    P = json.load(open(f'piano_{tag}.json')); cfg = P['cfg']; prob = []
    if r['secs'] > 20: prob.append(f"tempo {r['secs']}s")
    for p in P['positions']:
        if abs(p['lots'] - round(p['lots'])) > 1e-6: prob.append(f"lotti non interi {p['isin']} {p['lots']}")
    if cfg['mode'] in ('maxscale', 'maxhorizon') and P['totalCost'] > cfg['budget'] + 0.5: prob.append(f"costo {P['totalCost']:.2f} > budget {cfg['budget']}")
    if cfg['minLinker'] and P['linkerShare'] < cfg['minLinker'] - 1e-6: prob.append(f"quota indicizzata {P['linkerShare']:.4f} < {cfg['minLinker']}")
    if cfg['titleCap']:
        for p in P['positions']:
            if p['cost'] > cfg['titleCap'] * P['bondCost'] + 0.5: prob.append(f"tetto titolo {p['isin']} {p['cost']/P['bondCost']:.4f}")
    for s in cfg['robust']:
        if s in P['sims'] and P['sims'][s]['first']: prob.append(f"scenario robusto {s} scoperto dal {P['sims'][s]['first']}")
        if s in P['byScen'] and min(x['bal'] for x in P['byScen'][s]) < -0.5: prob.append(f"saldo negativo in {s}: {min(x['bal'] for x in P['byScen'][s]):.2f}")
    # prima rata: deve essere dopo il regolamento
    if P['byScen']['base'][0]['due'] <= P['settle']: prob.append(f"prima rata {P['byScen']['base'][0]['due']} non dopo il regolamento {P['settle']}")
    r['problemi'] = prob; r['flat'] = P.get('flat'); rows.append(r)
for r in rows: print(json.dumps(r, ensure_ascii=False))
