#!/usr/bin/env python3
"""Prototipo (solo standard library) per scaricare le serie di inflazione e i
coefficienti di indicizzazione MEF usati dalla scala BTP€i / BTP Italia.

Scrive nella cartella dello script:
  hicp_xt.json  HICP area euro ex-tabacco (Eurostat), base 2025=100 + base 2015=100
  foi_xt.json   FOI senza tabacchi (ISTAT SDMX), base 2025=100 + base 2015=100
  estr.json     €STR giornaliero (BCE)
  ci_mef.json   coefficienti di indicizzazione ufficiali MEF (CSV mensili) + verifica

Uso:  python3 fetch_inflation_proto.py [--mesi-ci N] [--solo hicp,foi,estr,ci]
Note: ISTAT SDMX e' lento (2-50 s) e limita a ~5 richieste/minuto per IP:
      qui si fanno 2 sole richieste, con pause e retry.
"""
import argparse
import calendar
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.request
from decimal import Decimal as D, ROUND_DOWN, ROUND_HALF_UP

OUT = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (bond-screener data fetch)"}
NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
ISTAT = "https://esploradati.istat.it/SDMXWS/rest/data/"
ECB = "https://data-api.ecb.europa.eu/service/data/"
MEF = "https://www.dt.mef.gov.it"
MEF_IDX = {
    "BTPei": "/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btpei/",
    "BTPItalia": "/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btp_italia/",
}
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre"]
MESI_ABBR = {m[:3]: i + 1 for i, m in enumerate(MESI)}

# Chiavi di ribasamento ufficiali (fonti in note-fonti.md)
CRB_HICP = (D("100.61"), D("128.89"))   # MEF, nota ribasamento IAPC 2025=100
CR_FOI = D("1.214")                     # ISTAT, coefficiente di raccordo FOI 2015->2025

# ISIN negoziabili (codice "senza Premio Finale Extra") -> ISIN nei CSV MEF
BTPI_ALIAS = {"IT0005388175": "IT0005388167", "IT0005497000": "IT0005496994",
              "IT0005517195": "IT0005517187", "IT0005532723": "IT0005532715",
              "IT0005648255": "IT0005648248", "IT0005713547": "IT0005713539"}


def get(url, timeout=120, tries=3, pause=15):
    last = None
    for i in range(tries):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            print(f"  GET {url} -> {len(data)} B in {time.time()-t0:.1f}s", file=sys.stderr)
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  ERRORE {url} ({e}); tentativo {i+1}/{tries}", file=sys.stderr)
            time.sleep(pause)
    raise RuntimeError(f"download fallito: {url}: {last}")


def save(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=False)
    print(f"scritto {name}", file=sys.stderr)


def r5(x):
    """Troncamento alla 6a decimale e arrotondamento alla 5a (convenzione MEF)."""
    return x.quantize(D("0.000001"), ROUND_DOWN).quantize(D("0.00001"), ROUND_HALF_UP)


def ym_shift(y, m, k):
    m -= k
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


def ir(series, day):
    """IR(d,m) = I(m-3) + (d-1)/gg(m) * [I(m-2) - I(m-3)], troncato 6a / arrotondato 5a."""
    a = series[ym_shift(day.year, day.month, 3)]
    b = series[ym_shift(day.year, day.month, 2)]
    gg = calendar.monthrange(day.year, day.month)[1]
    return r5(a + D(day.day - 1) / D(gg) * (b - a))


# ---------------------------------------------------------------- Eurostat
def eurostat_series(dataset, **flt):
    q = "&".join(f"{k}={v}" for k, v in flt.items())
    url = f"{EUROSTAT}{dataset}?format=JSON&lang=EN&{q}"
    d = json.loads(get(url))
    t = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    n = len(t)
    if any(s != 1 for s in d["size"][:-1]):
        raise ValueError(f"filtro non univoco per {dataset}: size={d['size']}")
    vals = {t[int(k) % n]: v for k, v in d["value"].items()}
    return url, d.get("updated"), dict(sorted(vals.items()))


def fetch_hicp():
    base = dict(geo="EA", coicop18="TOT_X_TBC")
    u1, up1, prime25 = eurostat_series("prc_hicp_fpd", unit="I25", release="FIN",
                                       sinceTimePeriod="2015-01", **base)
    u2, up2, riv25 = eurostat_series("prc_hicp_minr", unit="I25", sinceTimePeriod="2015-01", **base)
    u3, up3, old15 = eurostat_series("prc_hicp_midx", unit="I15", geo="EA", coicop="TOT_X_TBC",
                                     sinceTimePeriod="2000-01")
    u4, up4, prime15 = eurostat_series("prc_hicp_fpd", unit="I15", release="FIN",
                                       sinceTimePeriod="2015-01", **base)
    diff = {k: [prime25[k], riv25.get(k)] for k in prime25 if riv25.get(k) != prime25[k]}
    obj = {
        "serie": "HICP area euro (EA, composizione variabile) - overall index excluding tobacco (TOT_X_TBC), indice mensile",
        "base": "2025=100",
        "fonte": u1,
        "nota": "valori = prime pubblicazioni 'Final' (prc_hicp_fpd, release=FIN): sono quelle che fanno fede per i BTP€i",
        "aggiornato_fonte": up1,
        "scaricato": NOW,
        "valori": prime25,
        "rivisti": {"fonte": u2, "aggiornato_fonte": up2,
                    "differenze_vs_prima_pubblicazione": diff},
        "base_2015": {
            "base": "2015=100",
            "fonte": u3,
            "nota": "serie ECOICOP 1 congelata a dic 2025 (dataset 1996-2025). Il MEF ha usato dic 2025 = 128,89 "
                    "(valore comunicato il 19/1/2026), oggi il dataset riporta 128,91.",
            "aggiornato_fonte": up3,
            "valori": old15,
            "prime_pubblicazioni_ecoicop2": {"fonte": u4, "valori": prime15},
        },
        "raccordo": {"CRB": "100.61 / 128.89", "valore": float(CRB_HICP[0] / CRB_HICP[1]),
                     "fonte": MEF + "/export/sites/sitodt/modules/documenti_it/debito_pubblico/"
                     "coefficienti_indicizzazione/BTPi-Nota-sul-ribasamento-dellIndice-IAPC-2025100.pdf"},
    }
    save("hicp_xt.json", obj)
    return obj


# ---------------------------------------------------------------- ISTAT
def istat_series(flow, key, start):
    url = f"{ISTAT}{flow}/{key}?startPeriod={start}"
    s = get(url, timeout=280, tries=4, pause=20).decode("utf-8")
    out = {}
    for t, v in re.findall(r'TIME_PERIOD" value="([^"]+)" />\s*<generic:ObsValue value="([^"]+)"', s):
        out[t] = float(v)
    if not out:
        raise ValueError(f"nessuna osservazione da {url}: {s[:200]}")
    return url, dict(sorted(out.items()))


def fetch_foi():
    u25, v25 = istat_series("169_748_DF_DCSP_FOI1B2025_1", "M.IT.101.4.00ST", "2026-01")
    time.sleep(13)  # limite ISTAT ~5 richieste/minuto
    u15, v15 = istat_series("169_748_DF_DCSP_FOI1B2025_2", "M.IT.55.4.00ST", "2015-01")
    # dic 2025 in base 2025 per il raccordo: FOI_b2015 / 1,214 (non arrotondato)
    dic25 = float(D(str(v15["2025-12"])) / CR_FOI)
    obj = {
        "serie": "FOI - indice dei prezzi al consumo per le famiglie di operai e impiegati, al netto dei tabacchi (ECOICOP_2=00ST), Italia, mensile",
        "base": "2025=100",
        "fonte": u25,
        "scaricato": NOW,
        "valori": v25,
        "dic_2025_base_2025_calcolato": dic25,
        "base_2015": {"base": "2015=100", "fonte": u15, "valori": v15},
        "raccordo": {"coefficiente": float(CR_FOI),
                     "regola": "FOI_base2025 = FOI_base2015 / 1,214",
                     "fonte": "https://www.istat.it/notizia/indice-dei-prezzi-per-le-rivalutazioni-monetarie/"},
    }
    save("foi_xt.json", obj)
    return obj


# ---------------------------------------------------------------- BCE €STR
def fetch_estr(n=60):
    url = f"{ECB}EST/B.EU000A2X2A25.WT?lastNObservations={n}&format=csvdata"
    rows = list(csv.DictReader(io.StringIO(get(url).decode("utf-8"))))
    vals = {r["TIME_PERIOD"]: float(r["OBS_VALUE"]) for r in rows}
    obj = {"serie": "€STR - Euro short-term rate, volume-weighted trimmed mean rate (%)",
           "base": "% annuo", "fonte": url, "scaricato": NOW, "valori": dict(sorted(vals.items()))}
    save("estr.json", obj)
    return obj


# ---------------------------------------------------------------- MEF CI
def parse_ci_csv(raw):
    txt = raw.decode("utf-8-sig").replace("\r", "")
    lines = [l.split(";") for l in txt.split("\n")]
    isin = re.search(r"(IT\d{10})", txt).group(1)
    title = next(l[0] for l in lines if isin in l[0])
    hdr = next(l for l in lines if len(l) > 1 and l[1].strip().upper() == "DATA")
    bases = [h.strip() for h in hdr[2:]]
    out = {}
    for l in lines:
        if len(l) < 3 or not re.match(r"\d", l[1].strip()):
            continue
        s = l[1].strip()
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})$", s) or re.match(r"(\d{2})-(\w{3})-(\d{2})$", s)
        if "/" in s:
            day = dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        else:
            day = dt.date(2000 + int(m.group(3)), MESI_ABBR[m.group(2).lower()], int(m.group(1)))
        for b, v in zip(bases, l[2:]):
            v = v.strip()
            if b and v:
                out.setdefault(b, {})[day.isoformat()] = v.replace(",", ".")
    return isin, title, out


def fetch_ci(n_mesi=3):
    # mese successivo (spesso gia' pubblicato verso il 19 del mese) + n_mesi precedenti
    oggi = dt.date.today()
    target = []
    y, m = oggi.year, oggi.month + 1
    if m > 12:
        y, m = y + 1, 1
    for _ in range(n_mesi + 1):
        target.append(f"{MESI[m-1]}-{y}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    titoli = {}
    for tipo, idx in MEF_IDX.items():
        page = get(MEF + idx).decode("utf-8", "replace")
        subs = sorted(set(re.findall(r'href="(' + re.escape(idx) + r'[^"]*[Cc]oeff[^"]*)"', page)))
        for sp in subs:
            if "esempi" in sp or "archivio" in sp:
                continue
            h = get(MEF + sp).decode("utf-8", "replace")
            csvs = sorted(set(re.findall(r'href="([^"]+\.csv)"', h)))
            for c in csvs:
                if not any(t in c for t in target):
                    continue
                isin, title, data = parse_ci_csv(get(MEF + c))
                t = titoli.setdefault(isin, {"tipo": tipo, "descrizione": title, "pagina": MEF + sp,
                                             "csv": [], "ci": {}})
                t["csv"].append(MEF + c)
                for b, vals in data.items():
                    t["ci"].setdefault(b, {}).update(vals)
    for t in titoli.values():
        t["ci"] = {b: dict(sorted(v.items())) for b, v in sorted(t["ci"].items())}
    obj = {"serie": "Coefficienti di indicizzazione giornalieri ufficiali MEF (BTP€i e BTP Italia)",
           "base": "CI rispetto alla data base indicata in ogni colonna",
           "fonte": MEF + MEF_IDX["BTPei"] + " ; " + MEF + MEF_IDX["BTPItalia"],
           "scaricato": NOW, "mesi_richiesti": target,
           "alias_isin_btp_italia": BTPI_ALIAS, "valori": titoli}
    return obj


def implied_base(ci_by_day, series):
    """Intervallo dell'IR base (base 2025) compatibile con tutti i CI ufficiali giornalieri."""
    lo, hi = D("0"), D("1e9")
    half = D("0.000005")
    for day, c in ci_by_day.items():
        d = dt.date.fromisoformat(day)
        if d < dt.date(2026, 5, 1):
            # i CI di mar-apr 2026 usano gen 2026 = 100,01 (valore della prima diffusione),
            # mentre Eurostat oggi riporta 100,02 anche in prc_hicp_fpd: li escludiamo
            continue
        try:
            x = ir(series, d)
        except KeyError:
            continue
        c = D(c)
        lo = max(lo, x / (c + half))
        hi = min(hi, x / (c - half))
    return lo, hi


def verify(ci_obj, hicp, foi, giorno):
    h25 = {k: D(str(v)) for k, v in hicp["valori"].items()}
    f25 = {k: D(str(v)) for k, v in foi["valori"].items()}
    tab = []
    for isin, t in ci_obj["valori"].items():
        series = h25 if t["tipo"] == "BTPei" else f25
        for b, vals in t["ci"].items():
            if giorno not in vals:
                continue
            off = D(vals[giorno])
            row = {"isin": isin, "tipo": t["tipo"], "colonna": b, "giorno": giorno, "ci_ufficiale": str(off)}
            ird = ir(series, dt.date.fromisoformat(giorno))
            row["ir_giorno"] = str(ird)
            mb = re.search(r"(\d{2})[/.](\d{2})[/.](\d{4})", b)
            bdate = dt.date(int(mb.group(3)), int(mb.group(2)), int(mb.group(1)))
            if bdate >= dt.date(2026, 3, 1):
                irb = ir(series, bdate)  # IR base calcolabile direttamente in base 2025
                row["ir_base"] = str(irb)
                row["ir_base_origine"] = "calcolato da serie base 2025 (prime pubblicazioni)"
            elif t["tipo"] == "BTPei":
                # IR base in base 2015 dalla serie ECOICOP1 (con dic 2025 = 128,89 come MEF), poi x CRB
                s15 = {k: D(str(v)) for k, v in hicp["base_2015"]["valori"].items()}
                s15["2025-12"] = CRB_HICP[1]
                b15 = ir(s15, bdate)
                irb = r5(b15 * CRB_HICP[0] / CRB_HICP[1])
                # nota: per titoli con godimento <= 2016 l'IR base fu fissato in base 2005 e poi
                # ribasato dal MEF nel 2016: il ricalcolo da serie base 2015 non coincide.
                row["ir_base_b2015"] = str(b15)
                row["ir_base"] = str(irb)
                row["ir_base_origine"] = "calcolato: serie Eurostat base 2015 attuale x CRB (100,61/128,89)"
                lo, hi = implied_base(vals, series)
                row["ir_base_implicito_mef"] = [f"{lo:.5f}", f"{hi:.5f}"]
            else:
                lo, hi = implied_base(vals, series)
                irb = r5((lo + hi) / 2)
                row["ir_base"] = str(irb)
                row["ir_base_origine"] = f"implicito dai CI MEF [{lo:.5f}, {hi:.5f}]"
            ci = r5(ird / irb)
            row["ci_calcolato"] = str(ci)
            row["differenza"] = str(ci - off)
            tab.append(row)
    return tab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesi-ci", type=int, default=3)
    ap.add_argument("--solo", default="hicp,foi,estr,ci")
    ap.add_argument("--giorno", default=dt.date.today().isoformat())
    a = ap.parse_args()
    todo = set(a.solo.split(","))
    hicp = fetch_hicp() if "hicp" in todo else json.load(open(os.path.join(OUT, "hicp_xt.json")))
    foi = fetch_foi() if "foi" in todo else json.load(open(os.path.join(OUT, "foi_xt.json")))
    if "estr" in todo:
        fetch_estr()
    if "ci" in todo:
        ci = fetch_ci(a.mesi_ci)
        ci["verifica"] = verify(ci, hicp, foi, a.giorno)
        save("ci_mef.json", ci)
        print(f"{'ISIN':14} {'base':22} {'IR giorno':>10} {'IR base':>10} {'CI calc':>8} {'CI MEF':>8} diff")
        for r in ci["verifica"]:
            print(f"{r['isin']:14} {r['colonna']:22} {r['ir_giorno']:>10} {r['ir_base']:>10} "
                  f"{r['ci_calcolato']:>8} {r['ci_ufficiale']:>8} {r['differenza']}")


if __name__ == "__main__":
    main()
