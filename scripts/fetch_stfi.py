#!/usr/bin/env python3
"""Scarica il file giornaliero "Rendimenti e durate calcolati End of Day" di
simpletoolsforinvestors.eu e lo salva in data/ per l'app.

Il link del file cambia (…/data/export/<codice>), quindi lo si ricava ogni volta
dalla pagina documentivari.php, come fa un visitatore. Un solo download al giorno.

Uso:
  python3 scripts/fetch_stfi.py --out data            # scarica e aggiorna se è un giorno nuovo
  python3 scripts/fetch_stfi.py --out data --dry-run  # scarica e valida senza scrivere
Solo libreria standard: gira su GitHub Actions senza installare nulla.
"""
import argparse
import collections
import datetime as dt
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

PAGE = "https://www.simpletoolsforinvestors.eu/documentivari.php"
UA = "Mozilla/5.0 (compatible; bond-screener/3.0; +https://github.com/igorbonfanti/bond-screener)"
REQUIRED = ["isincode", "description", "redemptiondate", "issuercode", "price",
            "grossytm", "netytm", "currentcouponrate", "couponmonths", "referencedate"]
MIN_ROWS = 300


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def get(url, referer=None):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def text_of(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip().lower()


def find_link(page):
    """Link del file End of Day: nella riga della tabella che lo descrive."""
    for row in re.findall(r"<tr\b.*?</tr>", page, flags=re.S | re.I):
        t = text_of(row)
        if "end of day" in t and "rendimenti" in t:
            hrefs = re.findall(r"href\s*=\s*[\"']([^\"']+)[\"']", row, flags=re.I)
            for h in hrefs:
                if "data/export" in h or h.lower().endswith((".csv", ".zip")):
                    return urllib.parse.urljoin(PAGE, html.unescape(h))
            if hrefs:
                return urllib.parse.urljoin(PAGE, html.unescape(hrefs[0]))
    m = re.search(r"end of day.{0,800}?href\s*=\s*[\"']([^\"']*data/export[^\"']*)[\"']", page, flags=re.S | re.I)
    return urllib.parse.urljoin(PAGE, html.unescape(m.group(1))) if m else None


def to_text(blob):
    if blob[:2] == b"PK":                       # a volte il file è compresso
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".csv")] or z.namelist()
            blob = z.read(names[0])
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return blob.decode(enc)
        except UnicodeDecodeError:
            continue
    fail("Codifica del file non riconosciuta.")


def validate(text):
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        fail("File vuoto.")
    header = [h.strip().lower() for h in lines[0].split(";")]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        fail(f"Intestazione inattesa, mancano: {', '.join(missing)}")
    if len(lines) - 1 < MIN_ROWS:
        fail(f"Troppe poche righe ({len(lines) - 1}): file incompleto?")
    i_ref = header.index("referencedate")
    counts = collections.Counter(l.split(";")[i_ref].strip() for l in lines[1:] if len(l.split(";")) > i_ref)
    ref, _ = counts.most_common(1)[0]
    try:
        d, m, y = (int(x) for x in ref.split("/"))
        ref_iso = dt.date(y, m, d).isoformat()
    except Exception:
        fail(f"Data di riferimento non valida: {ref!r}")
    return {"refDate": ref_iso, "rows": len(lines) - 1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    page = get(PAGE).decode("utf-8", "replace")
    link = find_link(page)
    if not link:
        fail("Link al file End of Day non trovato in documentivari.php (la pagina è cambiata?).")
    print(f"Link trovato: {link}")
    text = to_text(get(link, referer=PAGE))
    meta = validate(text)
    print(f"File valido: {meta['rows']} titoli, dati del {meta['refDate']}")
    if args.dry_run:
        print("Prova a vuoto: nessun file scritto.")
        return

    os.makedirs(args.out, exist_ok=True)
    meta_path = os.path.join(args.out, "stfi-latest.json")
    if os.path.exists(meta_path) and not args.force:
        with open(meta_path, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("refDate") == meta["refDate"]:
            print("Stessa data del file già salvato: nessun aggiornamento.")
            return
    with open(os.path.join(args.out, "stfi-latest.csv"), "w", encoding="utf-8", newline="") as f:
        f.write(text.replace("\r\n", "\n"))
    meta.update({
        "fetchedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": PAGE,
        "note": "Dati di simpletoolsforinvestors.eu, scaricati automaticamente una volta al giorno."
    })
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Salvato {args.out}/stfi-latest.csv")


if __name__ == "__main__":
    main()
