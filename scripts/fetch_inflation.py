#!/usr/bin/env python3
"""Dati d'inflazione per la modalità «Affitto indicizzato» (solo standard library).

Scrive data/inflazione/inflazione.json con:
  hicp   HICP area euro senza tabacchi (Eurostat prc_hicp_fpd, prime pubblicazioni «Final»), base 2025=100
  foi    FOI senza tabacchi (ISTAT SDMX), base 2025=100
  estr   ultimo €STR (BCE)
  titoli regole e indice base di ogni BTP€i / BTP Italia (da data/inflazione/titoli.json), con la base dei
         BTP Italia fatta avanzare a ogni cedola (regola del massimo; Italia Sì: indice alla cedola precedente)
  controlli  CI ricalcolati contro i CI ufficiali MEF del giorno (5ª decimale) e continuità della base 2025

Regole sui dati:
  - storico append-only: un mese già salvato non si sovrascrive mai (fa fede la prima pubblicazione);
  - se una fonte non risponde si tengono i valori già salvati e l'errore finisce in «controlli»;
  - le serie sono già in base 2025=100 (raccordo fatto dalle fonti: MEF per gli indici base dei titoli).

Uso: python3 scripts/fetch_inflation.py [--out data/inflazione] [--dry-run] [--no-mef]
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

UA = {"User-Agent": "Mozilla/5.0 (bond-screener data fetch)"}
EUROSTAT = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_fpd"
            "?format=JSON&lang=EN&geo=EA&coicop18=TOT_X_TBC&unit=I25&release=FIN&sinceTimePeriod=2015-01")
ISTAT = "https://esploradati.istat.it/SDMXWS/rest/data/169_748_DF_DCSP_FOI1B2025_1/M.IT.101.4.00ST?startPeriod=2025-01"
ECB = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=10&format=csvdata"
MEF = "https://www.dt.mef.gov.it"
MEF_IDX = {"BTPEI": "/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btpei/",
           "BTPITALIA": "/it/debito_pubblico/dati_statistici/coefficienti_di_indicizzazione_btp_italia/"}
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre",
        "ottobre", "novembre", "dicembre"]
MESI_ABBR = {m[:3]: i + 1 for i, m in enumerate(MESI)}


def log(*a):
    print(*a, file=sys.stderr)


def get(url, timeout=120, tries=3, pause=15):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            log(f"  errore {url} ({e}); tentativo {i + 1}/{tries}")
            if i + 1 < tries:
                time.sleep(pause)
    raise RuntimeError(f"download fallito: {url}: {last}")


def r5(x):
    """Troncamento alla 6ª decimale e arrotondamento alla 5ª (convenzione MEF)."""
    return x.quantize(D("0.000001"), ROUND_DOWN).quantize(D("0.00001"), ROUND_HALF_UP)


def ym(y, m, back):
    m -= back
    while m <= 0:
        m, y = m + 12, y - 1
    return f"{y}-{m:02d}"


def ref_index(series, day):
    """IR(d,m) = I(m−3) + (d−1)/gg(m)·[I(m−2) − I(m−3)], troncato alla 6ª e arrotondato alla 5ª. None se manca un mese."""
    a, b = series.get(ym(day.year, day.month, 3)), series.get(ym(day.year, day.month, 2))
    if a is None or b is None:
        return None
    a, b = D(str(a)), D(str(b))
    return r5(a + D(day.day - 1) / D(calendar.monthrange(day.year, day.month)[1]) * (b - a))


# ------------------------------------------------------------------ fonti
def fetch_hicp():
    d = json.loads(get(EUROSTAT))
    t = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    if any(s != 1 for s in d["size"][:-1]):
        raise ValueError(f"filtro Eurostat non univoco: {d['size']}")
    return {t[int(k) % len(t)]: v for k, v in d["value"].items()}


def fetch_foi():
    s = get(ISTAT, timeout=280, tries=4, pause=20).decode("utf-8")
    out = {t: float(v) for t, v in re.findall(r'TIME_PERIOD" value="([^"]+)" />\s*<generic:ObsValue value="([^"]+)"', s)}
    if not out:
        raise ValueError("ISTAT: nessuna osservazione")
    return out


def fetch_estr():
    rows = list(csv.DictReader(io.StringIO(get(ECB).decode("utf-8"))))
    last = max(rows, key=lambda r: r["TIME_PERIOD"])
    return {"valore": float(last["OBS_VALUE"]) / 100, "data": last["TIME_PERIOD"], "fonte": ECB}


def parse_ci_csv(raw):
    txt = raw.decode("utf-8-sig").replace("\r", "")
    lines = [l.split(";") for l in txt.split("\n")]
    isin = re.search(r"(IT\d{10})", txt).group(1)
    hdr = next(l for l in lines if len(l) > 1 and l[1].strip().upper() == "DATA")
    bases = [h.strip() for h in hdr[2:]]
    out = {}
    for l in lines:
        if len(l) < 3 or not re.match(r"\d", l[1].strip()):
            continue
        s = l[1].strip()
        if "/" in s:
            m = re.match(r"(\d{2})/(\d{2})/(\d{4})$", s)
            day = dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        else:
            m = re.match(r"(\d{2})-(\w{3})-(\d{2})$", s)
            day = dt.date(2000 + int(m.group(3)), MESI_ABBR[m.group(2).lower()], int(m.group(1)))
        for b, v in zip(bases, l[2:]):
            if b and v.strip():
                out.setdefault(b, {})[day.isoformat()] = v.strip().replace(",", ".")
    return isin, out


def fetch_mef_ci(today):
    """CI ufficiali MEF del mese corrente: {isin_mef: {colonna_base: {giorno: ci}}}."""
    want = f"{MESI[today.month - 1]}-{today.year}"
    res = {}
    for idx in MEF_IDX.values():
        page = get(MEF + idx).decode("utf-8", "replace")
        for sp in sorted(set(re.findall(r'href="(' + re.escape(idx) + r'[^"]*[Cc]oeff[^"]*)"', page))):
            if "esempi" in sp or "archivio" in sp:
                continue
            for c in sorted(set(re.findall(r'href="([^"]+\.csv)"', get(MEF + sp).decode("utf-8", "replace")))):
                if want in c:
                    isin, data = parse_ci_csv(get(MEF + c))
                    for b, vals in data.items():
                        res.setdefault(isin, {}).setdefault(b, {}).update(vals)
    return res


# ------------------------------------------------------------------ titoli
def coupon_dates(t, upto):
    """Date cedola dal godimento fino a upto (incluso), dal giorno della scadenza."""
    g, s = dt.date.fromisoformat(t["godimento"]), dt.date.fromisoformat(t["scadenza"])
    out = []
    for y in range(g.year, upto.year + 1):
        for m in t["mesiCedola"]:
            d = dt.date(y, m, min(s.day, calendar.monthrange(y, m)[1]))
            if g < d <= min(upto, s):
                out.append(d)
    return sorted(out)


def roll_bases(titoli, foi, today):
    """BTP Italia: fa avanzare la base a ogni cedola già passata (dopo baseDal)."""
    out = {}
    for isin, t in titoli.items():
        e = dict(t)
        if t["tipo"] == "BTPITALIA":
            base, since = D(str(t["irBase"])), dt.date.fromisoformat(t["baseDal"])
            for d in coupon_dates(t, today):
                if d <= since:
                    continue
                ni = ref_index(foi, d)
                if ni is None:
                    e["avviso"] = f"FOI mancante per la cedola del {d}: base non aggiornata"
                    break
                base = ni if t.get("sottotipo") == "BTP_ITALIA_SI" else max(base, ni)
                since = d
            e["irBase"], e["baseDal"] = float(base), since.isoformat()
        out[isin] = e
    return out


def check_ci(titoli, hicp, foi, mef, today):
    """CI ricalcolato oggi contro il CI ufficiale MEF (colonna con la base più recente). Tolleranza: 5ª decimale."""
    rows = []
    for isin, t in titoli.items():
        cols = mef.get(t.get("isinMef") or isin)
        if not cols:
            if t.get("sottotipo") != "BTP_ITALIA_SI":   # il MEF non pubblica CI per il BTP Italia Sì
                rows.append({"isin": isin, "esito": "manca il CI MEF"})
            continue
        def bdate(b):
            m = re.search(r"(\d{2})[/.](\d{2})[/.](\d{4})", b)
            return (m.group(3), m.group(2), m.group(1)) if m else ("", "", "")
        withday = [b for b in cols if today.isoformat() in cols[b]]
        off = cols[max(withday, key=bdate)][today.isoformat()] if withday else None
        ir = ref_index(hicp if t["indice"] == "HICP" else foi, today)
        if off is None or ir is None:
            rows.append({"isin": isin, "esito": "dato del giorno non disponibile"})
            continue
        ci = r5(ir / D(str(t["irBase"])))
        diff = ci - D(off)
        rows.append({"isin": isin, "ci": str(ci), "mef": off, "diff": float(diff), "esito": "ok" if diff == 0 else "diverso"})
    return rows


# ------------------------------------------------------------------ main
def merge_append_only(old, new):
    """Aggiunge i mesi nuovi; quelli già salvati restano (prima pubblicazione). Restituisce (serie, mesi rivisti)."""
    out, revised = dict(old), []
    for k, v in sorted(new.items()):
        if k not in out:
            out[k] = v
        elif out[k] != v:
            revised.append({"mese": k, "salvato": out[k], "fonte_oggi": v})
    return dict(sorted(out.items())), revised


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/inflazione")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-mef", action="store_true")
    ap.add_argument("--giorno", default=None)
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.giorno) if a.giorno else dt.date.today()
    path = os.path.join(a.out, "inflazione.json")
    old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    cfg = json.load(open(os.path.join(a.out, "titoli.json"), encoding="utf-8"))
    errors, controls = [], {}

    def series(name, fetch):
        prev = (old.get(name) or {}).get("valori", {})
        try:
            vals, rev = merge_append_only(prev, fetch())
            if rev:
                controls[f"{name}_revisioni"] = rev
            return vals
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
            return prev

    hicp = series("hicp", fetch_hicp)
    foi = series("foi", fetch_foi)
    try:
        estr = fetch_estr()
    except Exception as e:  # noqa: BLE001
        errors.append(f"estr: {e}")
        estr = old.get("estr")
    if not hicp or not foi or not estr:
        log("dati insufficienti:", errors)
        return 1

    # continuità della base 2025: la media 2025 delle due serie deve essere 100 (± arrotondamenti)
    for name, s in (("hicp", hicp), ("foi", foi)):
        y25 = [s[k] for k in s if k.startswith("2025-")]
        if len(y25) == 12:
            mean = sum(y25) / 12
            controls[f"{name}_media_2025"] = round(mean, 4)
            if abs(mean - 100) > 0.06:
                errors.append(f"{name}: media 2025 = {mean:.3f}, non 100: base cambiata?")

    titoli = roll_bases(cfg["titoli"], foi, today)
    if not a.no_mef:
        try:
            rows = check_ci(titoli, hicp, foi, fetch_mef_ci(today), today)
            controls["ci"] = {"giorno": today.isoformat(), "righe": rows,
                              "ok": all(r["esito"] in ("ok", "dato del giorno non disponibile") for r in rows)}
            bad = [r for r in rows if r["esito"] == "diverso"]
            if bad:
                errors.append(f"CI diverso dal MEF per {len(bad)} titoli: " + ", ".join(r["isin"] for r in bad))
        except Exception as e:  # noqa: BLE001
            errors.append(f"mef: {e}")

    out = {
        "aggiornato": today.isoformat(),
        "hicp": {"serie": "HICP area euro senza tabacchi, prime pubblicazioni", "base": "2025=100", "fonte": EUROSTAT,
                 "ultimo": max(hicp), "valori": hicp},
        "foi": {"serie": "FOI senza tabacchi", "base": "2025=100", "fonte": ISTAT, "ultimo": max(foi), "valori": foi},
        "estr": estr,
        "titoli": titoli,
        "controlli": {**controls, "errori": errors, "ok": not errors},
    }
    log(f"HICP fino a {max(hicp)}, FOI fino a {max(foi)}, €STR {estr['valore']:.5f} del {estr['data']}; errori: {errors or 'nessuno'}")
    if a.dry_run:
        log("prova a vuoto: nessun file scritto")
        return 0
    os.makedirs(a.out, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
